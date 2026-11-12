// Estado operacional grosseiro. Sem chamadas externas, sem segredos, sem nomes de fornecedores nem versões.
// 200 = a aplicação serve pedidos (ok ou degraded). 503 = as rotas de IA não conseguem funcionar (down).
import { aiConfigured } from '../services/ai.js';
import { enabledProviders } from '../services/jobs/providers/index.js';
import { storeHealth, sharedStoreRequired } from '../services/ratelimit.js';

export function computeHealth(env = process.env) {
  const ai = aiConfigured(env) ? 'ok' : 'not_configured';
  const jobs = enabledProviders(env).length ? 'ok' : 'not_configured';
  const store = storeHealth().status; // shared | memory | degraded
  const storeBlocks = sharedStoreRequired(env) && store !== 'shared'; // as rotas de IA recusam pedidos nesta situação
  const status = ai !== 'ok' || storeBlocks ? 'down' : jobs !== 'ok' || store !== 'shared' ? 'degraded' : 'ok';
  return { status, checks: { ai, jobs, rateLimitStore: store } };
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return res.status(405).json({ error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' }); }
  const h = computeHealth();
  return res.status(h.status === 'down' ? 503 : 200).json(h);
}
