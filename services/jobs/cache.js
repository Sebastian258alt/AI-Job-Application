// Cache com TTL: memória por instância + Redis REST partilhado (se configurado). Protege as quotas dos fornecedores
// (ex.: Remotive pede no máximo ~4 pedidos/dia e bloqueia >2/min). Em falha devolve a última cópia (stale) e faz
// "cooldown" (memória + Redis) para nenhuma instância voltar a insistir. O erro pode trazer cooldownSec (ex.: HTTP 429).
import { redisConfig } from '../ratelimit.js';
import { log } from '../log.js';
let warnedNoStore = false;
const mem = new Map(), inflight = new Map(), failed = new Map();
export const _resetCacheForTests = () => { mem.clear(); inflight.clear(); failed.clear(); strikes.clear(); warnedNoStore = false; };

async function redis(cmds) {
  const c = redisConfig(); if (!c) return null;
  try {
    const r = await fetch(c.url + '/pipeline', { method: 'POST', headers: { authorization: 'Bearer ' + c.token, 'content-type': 'application/json' }, body: JSON.stringify(cmds), signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) ? j.map(x => (x && !x.error ? x.result : null)) : null;
  } catch { return null; }
}
const parse = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const mkErr = c => Object.assign(new Error(c.kind), { kind: c.kind, status: c.status, cooldownSec: c.cooldownSec });
const strikes = new Map(); // chave -> falhas consecutivas nesta instância (recuo exponencial: failSec, 2x, 4x... até ao máximo)
const MAX_COOL = 3600;

// loader() devolve o valor; lança em erro. Resultado: { value, cache: 'hit'|'redis'|'miss'|'stale' }
export async function cached(key, ttlSec, loader, { staleSec = 86400, failSec = 60 } = {}) {
  const now = Date.now(), k = 'jobs:v1:' + key;
  let e = mem.get(k);
  if (e && e.at + ttlSec * 1000 > now) return { value: e.value, cache: 'hit' };

  // Cópia local ausente ou velha: ver sempre o Redis (outra instância pode ter renovado, ou ter posto o fornecedor em cooldown).
  const r = await redis([['GET', k], ['GET', k + ':cool'], ['PTTL', k + ':cool']]);
  if (r) {
    const o = parse(r[0]); if (o && o.at && (!e || o.at > e.at)) { e = o; mem.set(k, o); }
    const c = parse(r[1]), left = Number(r[2]);
    if (c && c.kind && left > 0 && !failed.has(k)) failed.set(k, { until: now + left, err: mkErr(c) });
  }
  if (e && e.at + ttlSec * 1000 > now) return { value: e.value, cache: 'redis' };

  const f = failed.get(k);
  if (f && f.until > now) { if (e) return { value: e.value, cache: 'stale' }; throw f.err; }
  if (!redisConfig() && !warnedNoStore) { warnedNoStore = true; log('warn', 'jobs_cache_no_shared_store', {}); } // sem Redis cada instância faz o seu pedido: pode exceder a quota
  if (inflight.has(k)) return inflight.get(k);
  const p = (async () => {
    try {
      const value = await loader();
      const o = { value, at: Date.now() };
      mem.set(k, o); failed.delete(k); strikes.delete(k);
      const s = JSON.stringify(o);
      if (s.length < 900000) await redis([['SET', k, s, 'EX', String(ttlSec + staleSec)]]);
      return { value, cache: 'miss' };
    } catch (err) {
      // Um cooldown explícito do fornecedor (ex.: Retry-After do HTTP 429) prevalece. Caso contrário, recuo exponencial a partir de failSec.
      const n = (strikes.get(k) || 0) + 1; strikes.set(k, n);
      const backoff = Math.min(failSec * 2 ** (n - 1), MAX_COOL);
      const cool = Math.max(1, Math.min(Number(err?.cooldownSec) || backoff, MAX_COOL));
      failed.set(k, { until: Date.now() + cool * 1000, err });
      await redis([['SET', k + ':cool', JSON.stringify({ kind: err?.kind || 'UPSTREAM', status: err?.status, cooldownSec: cool }), 'EX', String(cool)]]);
      if (e && e.at + (ttlSec + staleSec) * 1000 > Date.now()) return { value: e.value, cache: 'stale' };
      throw err;
    } finally { inflight.delete(k); }
  })();
  inflight.set(k, p);
  return p;
}
