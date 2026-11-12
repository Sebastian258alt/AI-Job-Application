import { validateQuery, runSearch } from '../services/jobs/search.js';
import { hit, clientKey } from '../services/ratelimit.js';
import { enabledProviders } from '../services/jobs/providers/index.js';
import { normalizeProfile } from '../services/schema.js';
import { log } from '../services/log.js';

// Pesquisa de vagas: 30 pedidos / 10 min por IP (limite próprio, separado do da IA).
export const RATE = { max: 30, windowSec: 600 };
const MAX_BODY_BYTES = 30000;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const send = (status, code, error, extra = {}) => res.status(status).json({ error, code, ...extra });
  // GET = pesquisa simples. POST = pesquisa + perfil (SmartMatch); o perfil vai no corpo, nunca na URL/logs.
  const isPost = req.method === 'POST';
  if (!isPost && req.method !== 'GET') { res.setHeader('Allow', 'GET, POST'); return send(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.'); }
  if (isPost) {
    if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) return send(415, 'UNSUPPORTED_MEDIA_TYPE', 'Pedido inválido.');
    const len = Number(req.headers?.['content-length']);
    if (Number.isFinite(len) && len > MAX_BODY_BYTES) return send(413, 'TOO_LARGE', 'Pedido demasiado grande.');
  }

  const rl = await hit('jobs:' + clientKey(req), RATE.max, RATE.windowSec);
  if (!rl.allowed) { res.setHeader('Retry-After', String(rl.retryAfter)); return send(429, 'RATE_LIMITED', 'Muitos pedidos. Tenta novamente dentro de alguns minutos.'); }

  let rawQuery = req.query || {}, profile = null;
  if (isPost) {
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return send(400, 'INVALID_REQUEST', 'Pedido inválido.');
    rawQuery = b.query ?? {};
    if (!rawQuery || typeof rawQuery !== 'object' || Array.isArray(rawQuery)) return send(400, 'INVALID_REQUEST', 'Pedido inválido.');
    if (b.profile != null) { try { profile = normalizeProfile(b.profile); } catch { return send(400, 'INVALID_PROFILE', 'Perfil inválido.'); } } // descarta tudo o que não seja perfil profissional
  }
  const v = validateQuery(rawQuery);
  if (!v.ok) return send(v.status, v.code, v.message);
  if (v.value.sort === 'match' && !profile) return send(400, 'PROFILE_REQUIRED', 'A ordenação por compatibilidade precisa do perfil.');

  const providers = enabledProviders();
  if (!providers.length) return send(503, 'JOBS_NOT_CONFIGURED', 'A pesquisa de vagas não está configurada.');
  try {
    const out = await runSearch(v.value, providers, { profile });
    // Se nenhum fornecedor respondeu, é erro (nunca se inventam vagas nem se esconde a falha).
    if (!out.providers.some(p => p.status === 'ok')) {
      const code = out.providers.every(p => p.status === 'not_configured') ? 'JOBS_NOT_CONFIGURED' : out.providers.every(p => p.status === 'skipped') ? 'FILTER_UNSUPPORTED' : 'JOBS_UNAVAILABLE';
      return send(code === 'FILTER_UNSUPPORTED' ? 200 : 503, code, code === 'FILTER_UNSUPPORTED' ? 'Nenhuma fonte activa suporta estes filtros.' : 'Não foi possível obter vagas agora. Tenta novamente mais tarde.', { providers: out.providers, jobs: [], total: 0 });
    }
    return res.status(200).json(out);
  } catch (e) {
    log('error', 'jobs_unexpected', { err: String(e?.name || 'Error') });
    return send(500, 'JOBS_ERROR', 'Não foi possível concluir a pesquisa.');
  }
}
