import { generateJSON, AIError, DEFAULT_TIMEOUT_MS } from '../services/ai.js';
import { systemPrompt, buildUserMessage } from '../data/prompts.js';
import { validateRequest, TASKS, LIMITS } from '../services/validate.js';
import { normalizeResult, gateAnalysis, groundCv } from '../services/schema.js';
import { matchPremiumCode, premiumConfigured, dailyLimit } from '../services/premium.js';
import { hit, peek, clientKey, backendName } from '../services/ratelimit.js';
import { log } from '../services/log.js';

// Pedidos com IA: 12 / 10 min por IP (igual ao original). Tentativas falhadas de código Premium: 10 / hora por IP.
export const RATE = { requests: { max: 12, windowSec: 600 }, failedCodes: { max: 10, windowSec: 3600 } };
let warnedPremium = false;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const send = (status, code, error, extra = {}) => res.status(status).json({ error, code, ...extra });
  const rid = String(req.headers?.['x-vercel-id'] || '').slice(0, 60);

  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.'); }
  if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) return send(415, 'UNSUPPORTED_MEDIA_TYPE', 'Pedido inválido.');
  const len = Number(req.headers?.['content-length']);
  if (Number.isFinite(len) && len > LIMITS.MAX_BODY_BYTES) return send(413, 'TOO_LARGE', 'O texto é demasiado longo.');

  const ipKey = clientKey(req);
  const rawTask = req.body && typeof req.body === 'object' ? req.body.task : undefined;
  if (rawTask !== 'verify') { // 'verify' não chama a IA; fica protegido pelo limite de tentativas falhadas
    const rl = await hit('req:' + ipKey, RATE.requests.max, RATE.requests.windowSec);
    if (!rl.allowed) { res.setHeader('Retry-After', String(rl.retryAfter)); return send(429, 'RATE_LIMITED', 'Muitos pedidos. Tenta novamente dentro de alguns minutos.'); }
  }

  const v = validateRequest(req.body);
  if (!v.ok) return send(v.status, v.code, v.message);
  const { task, cv, vacancy, code, lang } = v.value;

  // Autorização Premium: só o servidor decide. Código vazio/ausente nunca autoriza.
  let premium = false, pid = '';
  if (code) {
    const failKey = 'code:' + ipKey;
    const b = await peek(failKey, RATE.failedCodes.max);
    if (b.blocked) { res.setHeader('Retry-After', String(b.retryAfter)); return send(429, 'RATE_LIMITED', 'Demasiadas tentativas. Tenta novamente mais tarde.'); }
    const m = matchPremiumCode(code);
    premium = m.ok; pid = m.id;
    if (!premium) {
      await hit(failKey, RATE.failedCodes.max, RATE.failedCodes.windowSec);
      if (!premiumConfigured() && !warnedPremium) { warnedPremium = true; log('warn', 'premium_not_configured'); }
      return send(402, 'INVALID_CODE', 'Código Premium inválido.');
    }
  } else if (TASKS[task].premium) {
    return send(402, 'PREMIUM_REQUIRED', 'Conteúdo Premium.');
  }
  if (task === 'verify') return res.status(200).json({ ok: true });

  // Limite diário por código Premium (trava a partilha de um código por muitas pessoas). Não se aplica a 'verify'.
  const cap = premium ? dailyLimit() : 0;
  if (cap > 0) {
    const u = await hit('pc:' + pid, cap, 86400);
    if (!u.allowed) { res.setHeader('Retry-After', String(u.retryAfter)); log('warn', 'premium_code_limit', { id: pid }); return send(429, 'CODE_LIMIT', 'Este código atingiu o limite diário de utilização. Tenta novamente amanhã ou contacta o suporte.'); }
  }
  if (premium) log('info', 'premium_use', { id: pid, task }); // só a etiqueta/identificador anónimo, nunca o código

  try {
    const data = await generateJSON(systemPrompt(task, lang), buildUserMessage(cv, vacancy), {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      validate: raw => normalizeResult(task, raw, lang),
    });
    const out = task === 'analyze' ? gateAnalysis(data, premium) : task === 'cv' ? groundCv(data, cv) : data;
    return res.status(200).json({ data: out, premium });
  } catch (e) {
    // Log técnico no servidor: só códigos estáveis. Nunca CV, vaga, código Premium, chaves, IPs nem texto do fornecedor.
    const kind = e instanceof AIError ? e.kind : 'UNEXPECTED';
    log('error', 'ai_error', { task, kind, status: e?.status || 0, provider_code: e?.providerCode || '', note: e?.note || '', backend: backendName(), rid, err: e instanceof AIError ? '' : String(e?.name || 'Error') });
    if (kind === 'NOT_CONFIGURED') return send(503, 'AI_NOT_CONFIGURED', 'Serviço de IA não configurado. Contacta o suporte.');
    if (kind === 'TIMEOUT') return send(504, 'AI_TIMEOUT', 'A análise demorou demasiado. Tenta novamente.');
    if (kind === 'UPSTREAM' && e.status === 429) return send(503, 'AI_BUSY', 'O serviço de IA está com muito tráfego. Tenta novamente dentro de 1 minuto.');
    if (kind === 'INVALID_JSON' || kind === 'INVALID_SCHEMA' || kind === 'EMPTY_RESPONSE') return send(502, 'AI_BAD_RESPONSE', 'A IA devolveu uma resposta num formato inesperado. Tenta novamente.');
    return send(502, 'AI_UNAVAILABLE', 'Não foi possível concluir a análise agora. Tenta novamente dentro de alguns instantes.');
  }
}
