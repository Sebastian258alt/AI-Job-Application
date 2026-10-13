// Validação de códigos Premium (apenas no servidor). Env existente: PREMIUM_CODES (separados por vírgula).
import { createHash, timingSafeEqual } from 'node:crypto';

export const CODE_MAX_LENGTH = 128;
const sha = s => createHash('sha256').update(s).digest();
const strip = v => String(v || '').trim().replace(/^["']|["']$/g, '').trim();

export function configuredCodes(env = process.env) {
  return strip(env.PREMIUM_CODES).split(',').map(s => s.trim()).filter(Boolean);
}
export const premiumConfigured = (env = process.env) => configuredCodes(env).length > 0;

// Devolve true apenas se `input` for uma string não vazia igual a um dos códigos configurados.
// Vazio, ausente, não-string ou PREMIUM_CODES por configurar => sempre false.
// Compara hashes em tempo constante e percorre todos os códigos (sem saída antecipada).
export function isValidPremiumCode(input, env = process.env) {
  if (typeof input !== 'string') return false;
  const c = input.trim();
  if (!c || c.length > CODE_MAX_LENGTH) return false;
  const codes = configuredCodes(env);
  if (!codes.length) return false;
  const h = sha(c);
  let ok = false;
  for (const k of codes) if (timingSafeEqual(h, sha(k))) ok = true;
  return ok;
}
