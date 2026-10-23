// Abstracção: Provider -> Modelo. Env: AI_PROVIDER (openai|openrouter|deepseek|gemini), AI_API_KEY, AI_MODEL
const P = {
  openai:     { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-4o-mini' },
  deepseek:   { url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' },
};
// gemini-2.0-flash foi desligado pela Google em 1 Jun 2026. Modelos actuais + alternativa se o principal falhar.
const GEMINI_DEFAULT = 'gemini-3.5-flash';
const GEMINI_FALLBACK = 'gemini-3.1-flash-lite';
export const DEFAULT_TIMEOUT_MS = 50000; // tem de ficar abaixo do maxDuration (60 s) em vercel.json

// Erro com "kind" estável. Nunca transporta texto do fornecedor nem conteúdo do utilizador.
// kind: NOT_CONFIGURED | TIMEOUT | NETWORK | UPSTREAM | EMPTY_RESPONSE | INVALID_JSON | INVALID_SCHEMA
export class AIError extends Error {
  constructor(kind, { status, providerCode, note } = {}) {
    super(kind + (status ? '_' + status : ''));
    this.name = 'AIError'; this.kind = kind; this.status = status; this.providerCode = providerCode; this.note = note;
  }
}

const OUTPUT_ERRORS = ['EMPTY_RESPONSE', 'INVALID_JSON', 'INVALID_SCHEMA'];

// Extrai só um código curto do erro do fornecedor (nunca a mensagem livre, que pode ecoar conteúdo).
function providerCodeOf(body) {
  try {
    const e = JSON.parse(body)?.error;
    const c = e?.status ?? e?.type ?? e?.code;
    return typeof c === 'string' || typeof c === 'number' ? String(c).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40) : undefined;
  } catch { return undefined; }
}
async function upstreamError(r) {
  const body = await r.text().catch(() => '');
  return new AIError('UPSTREAM', { status: r.status, providerCode: providerCodeOf(body) });
}

export function parseJSON(text) {
  if (!text || typeof text !== 'string') throw new AIError('EMPTY_RESPONSE');
  const s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const tryParse = t => { try { return { v: JSON.parse(t) }; } catch { return null; } }; // nunca propaga a SyntaxError (inclui excertos do texto)
  let r = tryParse(s);
  if (!r) { // extrai o objecto JSON se vier com texto à volta
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a !== -1 && b > a) r = tryParse(s.slice(a, b + 1));
  }
  if (!r) throw new AIError('INVALID_JSON');
  return r.v;
}

async function callGemini(model, key, system, user, signal) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192 }, // temperatura por defeito (recomendado nos modelos Gemini 3)
    }),
  });
  if (!r.ok) throw await upstreamError(r);
  const j = await r.json().catch(() => ({}));
  const cand = j.candidates?.[0];
  // junta apenas as partes de texto (ignora partes de "thinking")
  const text = (cand?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('');
  if (!text) throw new AIError('EMPTY_RESPONSE', { note: String(cand?.finishReason || j.promptFeedback?.blockReason || 'unknown').slice(0, 40) });
  return text;
}

async function callOpenAICompat(c, model, key, system, user, signal) {
  const r = await fetch(c.url, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({ model, temperature: 0.3, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  if (!r.ok) throw await upstreamError(r);
  const j = await r.json().catch(() => ({}));
  const text = j.choices?.[0]?.message?.content;
  if (!text) throw new AIError('EMPTY_RESPONSE', { note: String(j.choices?.[0]?.finish_reason || 'unknown').slice(0, 40) });
  return text;
}

// Converte falhas de rede/abort em AIError. Qualquer outro erro passa tal como está.
function normalizeFailure(e) {
  if (e instanceof AIError) return e;
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return new AIError('TIMEOUT');
  if (e instanceof TypeError) return new AIError('NETWORK'); // fetch failed
  return e;
}

// opts.validate(obj) deve lançar (ex.: SchemaError) se o JSON não cumprir o formato esperado e devolver o objecto normalizado.
export async function generateJSON(system, user, opts = {}) {
  const { validate = x => x, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  // tolera espaços/maiúsculas/aspas coladas nas variáveis da Vercel
  const clean = v => String(v || '').trim().replace(/^["']|["']$/g, '').trim();
  const provider = clean(process.env.AI_PROVIDER).toLowerCase() || 'openai', key = clean(process.env.AI_API_KEY);
  if (!key) throw new AIError('NOT_CONFIGURED', { note: 'AI_API_KEY em falta ou vazia' });
  if (provider !== 'gemini' && !P[provider]) throw new AIError('NOT_CONFIGURED', { note: 'AI_PROVIDER inválido (usa gemini|openai|openrouter|deepseek)' });

  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs), deadline = Date.now() + timeoutMs;
  try {
    const model = clean(process.env.AI_MODEL) || (provider === 'gemini' ? GEMINI_DEFAULT : P[provider].model);
    const attempts = provider === 'gemini'
      ? (model === GEMINI_FALLBACK ? [model] : [model, GEMINI_FALLBACK])
      : [model, model]; // 2.ª tentativa só para respostas inválidas
    const call = m => provider === 'gemini' ? callGemini(m, key, system, user, ctl.signal) : callOpenAICompat(P[provider], m, key, system, user, ctl.signal);
    const canRetry = e => e instanceof AIError && (OUTPUT_ERRORS.includes(e.kind) || (provider === 'gemini' && e.kind === 'UPSTREAM' && [400, 404, 429, 500, 502, 503, 504].includes(e.status)));
    let last;
    for (let i = 0; i < attempts.length; i++) {
      try {
        const obj = parseJSON(await call(attempts[i]));
        try { return validate(obj); } catch (v) { throw new AIError('INVALID_SCHEMA', { note: String(v?.field || v?.message || '').slice(0, 40) }); }
      } catch (raw) {
        last = normalizeFailure(raw);
        const more = i < attempts.length - 1 && deadline - Date.now() > 5000;
        if (!more || !canRetry(last)) throw last;
        console.error(JSON.stringify({ evt: 'ai_retry', kind: last.kind, status: last.status || 0, provider }));
      }
    }
    throw last;
  } finally { clearTimeout(timer); }
}
