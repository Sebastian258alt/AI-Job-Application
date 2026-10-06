// Abstracção: Provider -> Model. Env: AI_PROVIDER (openai|openrouter|deepseek|gemini), AI_API_KEY, AI_MODEL
const P = {
  openai:     { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-4o-mini' },
  deepseek:   { url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' },
};
// gemini-2.0-flash foi desligado pela Google em 1 Jun 2026. Modelos actuais + alternativa se o principal falhar com 404.
const GEMINI_DEFAULT = 'gemini-3.5-flash';
const GEMINI_FALLBACK = 'gemini-3.1-flash-lite';

class UpstreamError extends Error {
  constructor(status, detail) { super('UPSTREAM_' + status); this.status = status; this.detail = detail; }
}

function parseJSON(text) {
  if (!text) throw new Error('EMPTY_RESPONSE');
  let s = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(s); } catch {
    const a = s.indexOf('{'), b = s.lastIndexOf('}'); // extrai o objecto JSON se vier com texto à volta
    if (a !== -1 && b > a) return JSON.parse(s.slice(a, b + 1));
    throw new Error('INVALID_JSON');
  }
}

async function callGemini(model, key, system, user, signal) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json' }, // temperatura por defeito (recomendado nos modelos Gemini 3)
    }),
  });
  if (!r.ok) throw new UpstreamError(r.status, (await r.text().catch(() => '')).slice(0, 300));
  const j = await r.json();
  const cand = j.candidates?.[0];
  // junta apenas as partes de texto (ignora partes de "thinking")
  const text = (cand?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('');
  if (!text) throw new Error('EMPTY_RESPONSE:' + (cand?.finishReason || j.promptFeedback?.blockReason || 'unknown'));
  return text;
}

export async function generateJSON(system, user) {
  // tolera espaços/maiúsculas/aspas coladas nas variáveis da Vercel
  const clean = v => String(v || '').trim().replace(/^["']|["']$/g, '').trim();
  const provider = clean(process.env.AI_PROVIDER).toLowerCase() || 'openai', key = clean(process.env.AI_API_KEY);
  if (!key) throw new Error('NOT_CONFIGURED:AI_API_KEY em falta ou vazia');
  if (provider !== 'gemini' && !P[provider]) throw new Error('NOT_CONFIGURED:AI_PROVIDER inválido "' + provider + '" (usa gemini|openai|openrouter|deepseek)');
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 55000);
  try {
    let text;
    if (provider === 'gemini') {
      const model = clean(process.env.AI_MODEL) || GEMINI_DEFAULT;
      try {
        text = await callGemini(model, key, system, user, ctl.signal);
      } catch (e) {
        // modelo inexistente/desligado -> tenta o modelo alternativo
        if (e instanceof UpstreamError && e.status === 404 && model !== GEMINI_FALLBACK) {
          console.error('ai_model_not_found', model, '-> a usar', GEMINI_FALLBACK);
          text = await callGemini(GEMINI_FALLBACK, key, system, user, ctl.signal);
        } else throw e;
      }
    } else {
      const c = P[provider];
      const r = await fetch(c.url, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: clean(process.env.AI_MODEL) || c.model, temperature: 0.3, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
      if (!r.ok) throw new UpstreamError(r.status, (await r.text().catch(() => '')).slice(0, 300));
      text = (await r.json()).choices?.[0]?.message?.content;
    }
    return parseJSON(text);
  } finally { clearTimeout(t); }
}
