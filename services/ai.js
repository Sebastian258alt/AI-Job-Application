// Abstracção: Provider -> Model. Env: AI_PROVIDER (openai|openrouter|deepseek|gemini), AI_API_KEY, AI_MODEL
const P = {
  openai:     { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-4o-mini' },
  deepseek:   { url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' },
};
export async function generateJSON(system, user) {
  const provider = process.env.AI_PROVIDER || 'openai', key = process.env.AI_API_KEY;
  if (!key) throw new Error('NOT_CONFIGURED');
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 55000);
  try {
    let r, text;
    if (provider === 'gemini') {
      const model = process.env.AI_MODEL || 'gemini-2.0-flash';
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.3 } }),
      });
      if (!r.ok) throw new Error('UPSTREAM_' + r.status);
      text = (await r.json()).candidates?.[0]?.content?.parts?.[0]?.text;
    } else {
      const c = P[provider]; if (!c) throw new Error('NOT_CONFIGURED');
      r = await fetch(c.url, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: process.env.AI_MODEL || c.model, temperature: 0.3, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
      if (!r.ok) throw new Error('UPSTREAM_' + r.status);
      text = (await r.json()).choices?.[0]?.message?.content;
    }
    return JSON.parse(String(text).replace(/^```json|```$/g, '').trim());
  } finally { clearTimeout(t); }
}
