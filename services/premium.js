// Validação de códigos Premium (apenas no servidor). Env existente: PREMIUM_CODES (separados por vírgula).
//
// Formatos aceites em PREMIUM_CODES (podem misturar-se):
//   CODIGO                 código simples (formato original; continua a funcionar)
//   maria=CODIGO           código pessoal com etiqueta ("maria"): identifica o cliente nos contadores e nos registos
// Apagar a entrada e voltar a publicar na Vercel revoga o código. A etiqueta nunca é enviada ao navegador.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const CODE_MAX_LENGTH = 128;
export const DEFAULT_DAILY_LIMIT = 30; // pedidos de IA por código e por 24 h (PREMIUM_DAILY_LIMIT; 0 = sem limite)
const sha = s => createHash('sha256').update(s).digest();
const strip = v => String(v || '').trim().replace(/^["']|["']$/g, '').trim();
const LABELED = /^([A-Za-z0-9_-]{1,32})=(.{8,})$/;

export function configuredEntries(env = process.env) {
  return strip(env.PREMIUM_CODES).split(',').map(s => s.trim()).filter(Boolean).map(raw => {
    const m = LABELED.exec(raw);
    // Compatibilidade: a entrada inteira continua a ser um código válido (um código antigo que contenha "=" não deixa de funcionar).
    return m ? { label: m[1], secrets: [raw, m[2]] } : { label: '', secrets: [raw] };
  });
}
export const configuredCodes = (env = process.env) => configuredEntries(env).map(e => e.secrets[e.secrets.length - 1]);
export const premiumConfigured = (env = process.env) => configuredEntries(env).length > 0;

// Identificador não reversível e não secreto de um código (etiqueta, ou prefixo de um HMAC do código).
const anonId = (code, env) => 'c' + createHmac('sha256', env.AI_API_KEY || 'applypro-premium').update(code).digest('hex').slice(0, 10);

// { ok, id }: `id` é a etiqueta (ou um identificador anónimo) da entrada que coincidiu. Compara hashes em tempo constante
// e percorre todas as entradas (sem saída antecipada). Vazio, ausente, não-string ou por configurar => { ok: false }.
export function matchPremiumCode(input, env = process.env) {
  if (typeof input !== 'string') return { ok: false, id: '' };
  const c = input.trim();
  if (!c || c.length > CODE_MAX_LENGTH) return { ok: false, id: '' };
  const entries = configuredEntries(env);
  if (!entries.length) return { ok: false, id: '' };
  const h = sha(c);
  let found = null;
  for (const e of entries) {
    let hit = false;
    for (const k of e.secrets) if (timingSafeEqual(h, sha(k))) hit = true;
    if (hit && !found) found = e;
  }
  return found ? { ok: true, id: found.label || anonId(found.secrets[found.secrets.length - 1], env) } : { ok: false, id: '' };
}
export const isValidPremiumCode = (input, env = process.env) => matchPremiumCode(input, env).ok;

export function dailyLimit(env = process.env) {
  const raw = strip(env.PREMIUM_DAILY_LIMIT);
  if (raw === '') return DEFAULT_DAILY_LIMIT;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : DEFAULT_DAILY_LIMIT;
}
