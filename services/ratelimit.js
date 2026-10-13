// Limite de pedidos por IP.
// - Com Redis REST (Upstash, via integração da Vercel): contador partilhado entre todas as instâncias serverless.
// - Sem Redis configurado (ou se falhar): fallback em memória, por instância (best-effort, NÃO garante limite global).
// Variáveis lidas (nomes definidos pelo Upstash / integração Vercel): UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN,
// ou KV_REST_API_URL + KV_REST_API_TOKEN. Nenhuma outra dependência.
import { createHmac } from 'node:crypto';
import { log } from './log.js';

const strip = v => String(v || '').trim().replace(/^["']|["']$/g, '').trim();
const mem = new Map(); // chave -> { count, resetAt }
let lastStoreWarn = 0;

export function redisConfig(env = process.env) {
  const url = strip(env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL).replace(/\/+$/, '');
  const token = strip(env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN);
  return /^https:\/\//.test(url) && token ? { url, token } : null;
}
export const backendName = () => (redisConfig() ? 'redis' : 'memory');
export function _resetMemoryForTests() { mem.clear(); lastStoreWarn = 0; }

// IP -> identificador pseudonimizado (HMAC), para não guardar IPs em claro no Redis.
export function clientKey(req) {
  const h = req.headers || {};
  const ip = String(h['x-vercel-forwarded-for'] || h['x-real-ip'] || h['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  return createHmac('sha256', process.env.AI_API_KEY || 'copilot-rl').update(ip).digest('hex').slice(0, 32);
}

function prune(now) {
  if (mem.size < 5000) return;
  for (const [k, e] of mem) if (e.resetAt <= now) mem.delete(k);
  if (mem.size >= 5000) mem.clear(); // último recurso: nunca crescer sem limite
}
function memHit(key, windowSec, now = Date.now()) {
  prune(now);
  let e = mem.get(key);
  if (!e || e.resetAt <= now) { e = { count: 0, resetAt: now + windowSec * 1000 }; mem.set(key, e); }
  e.count++;
  return { count: e.count, retryAfter: Math.max(1, Math.ceil((e.resetAt - now) / 1000)) };
}
function memPeek(key, now = Date.now()) {
  const e = mem.get(key);
  return e && e.resetAt > now ? { count: e.count, retryAfter: Math.max(1, Math.ceil((e.resetAt - now) / 1000)) } : { count: 0, retryAfter: 0 };
}

async function pipeline(cmds) {
  const c = redisConfig();
  const r = await fetch(c.url + '/pipeline', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + c.token, 'content-type': 'application/json' },
    body: JSON.stringify(cmds),
    signal: AbortSignal.timeout(1500),
  });
  if (!r.ok) throw new Error('REDIS_HTTP_' + r.status);
  const j = await r.json();
  if (!Array.isArray(j) || j.some(x => x && x.error)) throw new Error('REDIS_BAD_RESPONSE');
  return j.map(x => x.result);
}
function storeFailed(e) {
  const now = Date.now();
  if (now - lastStoreWarn > 60000) { lastStoreWarn = now; log('warn', 'ratelimit_store_error', { reason: String(e?.message || e.name || 'unknown') }); }
}

// Regista um pedido. Devolve { allowed, retryAfter, backend }.
export async function hit(key, max, windowSec) {
  const k = 'rl:v1:' + key;
  if (redisConfig()) {
    try {
      const [, count, ttl] = await pipeline([['SET', k, '0', 'EX', String(windowSec), 'NX'], ['INCR', k], ['TTL', k]]);
      if (typeof ttl === 'number' && ttl < 0) await pipeline([['EXPIRE', k, String(windowSec)]]).catch(() => {});
      return { allowed: count <= max, retryAfter: ttl > 0 ? ttl : windowSec, backend: 'redis' };
    } catch (e) { storeFailed(e); }
  }
  const m = memHit(k, windowSec);
  return { allowed: m.count <= max, retryAfter: m.retryAfter, backend: 'memory' };
}

// Consulta sem incrementar. Devolve { blocked, retryAfter }.
export async function peek(key, max) {
  const k = 'rl:v1:' + key;
  if (redisConfig()) {
    try {
      const [count, ttl] = await pipeline([['GET', k], ['TTL', k]]);
      const n = Number(count) || 0;
      return { blocked: n >= max, retryAfter: ttl > 0 ? ttl : 1 };
    } catch (e) { storeFailed(e); }
  }
  const m = memPeek(k);
  return { blocked: m.count >= max, retryAfter: m.retryAfter };
}
