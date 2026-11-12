// Servidor local de TESTE: serve o site, aplica os cabeçalhos de vercel.json (incluindo a CSP) e executa o handler REAL de api/analyze.js.
// Com STUB_AI=1 o fornecedor de IA é simulado (nenhum pedido sai da máquina); /__calls devolve o que o handler enviou ao "fornecedor".
// Uso: STUB_AI=1 PREMIUM_CODES=... node scripts/dev-server.mjs [porta]
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8124);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.gz': 'application/octet-stream', '.md': 'text/plain; charset=utf-8' };
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const staticHeaders = (vercel.headers.find(h => h.source === '/(.*)') || { headers: [] }).headers;
const calls = [];

if (process.env.STUB_AI === '1') {
  process.env.AI_PROVIDER ||= 'openai'; process.env.AI_API_KEY ||= 'stub-key-not-real';
  const FIX = {
    pt: { analyze: { score: 64, strengths: ['Inglês fluente'], partial_matches: ['Excel'], missing_from_cv: ['Gestão de projectos: não identificado no CV.'], requirements: [{ category: 'essential', text: 'Inglês fluente', status: 'MATCH', evidence: 'Professor de inglês' }], recommendations: [{ current: 'A', direction: 'DIR-1' }, { current: 'B', direction: 'DIR-2' }, { current: 'C', direction: 'DIR-3' }], keywords: ['kw'], application_strategy: 'ESTRATEGIA' }, kit: { cover_letter: 'Carta [STUB]', email: { subject: 'Assunto', body: 'Corpo' }, profile_summary: 'Resumo' }, interview: { questions: [{ question: 'Pergunta 1 [STUB]', why: 'p', structure: 's', example: '' }], ask_employer: ['P1'] },
    cv: { lang: 'pt', name: 'Joao Silva', headline: 'Professor de inglês', contact: ['joao@x.com', '+258 84 999 9999'], summary: 'Professor de inglês com experiência em tradução técnica. Formação em Letras.', experience: [{ role: 'Professor de inglês', company: 'Escola Y', period: '2020 a 2024', bullets: ['Ensinou 120 alunos.', 'Tradução técnica EN-PT.'] }], education: [{ title: 'Licenciatura em Letras', institution: 'UEM', period: '', details: '' }], skills: ['Excel', 'Word'], languages: ['Português', 'Inglês'], additional: [] } },
    en: { analyze: { score: 64, strengths: ['Fluent English'], partial_matches: ['Excel'], missing_from_cv: ['Project management: not identified in the CV.'], requirements: [{ category: 'essential', text: 'Fluent English', status: 'MATCH', evidence: 'English teacher' }], recommendations: [{ current: 'A', direction: 'DIR-1' }, { current: 'B', direction: 'DIR-2' }, { current: 'C', direction: 'DIR-3' }], keywords: ['kw'], application_strategy: 'STRATEGY' }, kit: { cover_letter: 'Letter [STUB]', email: { subject: 'Subject', body: 'Body' }, profile_summary: 'Summary' }, interview: { questions: [{ question: 'Question 1 [STUB]', why: 'w', structure: 's', example: '' }], ask_employer: ['Q1'] },
    cv: { lang: 'en', name: 'Joao Silva', headline: 'Professor de inglês', contact: ['joao@x.com', '+258 84 999 9999'], summary: 'Professor de inglês com experiência em tradução técnica. Formação em Letras.', experience: [{ role: 'Professor de inglês', company: 'Escola Y', period: '2020 a 2024', bullets: ['Ensinou 120 alunos.', 'Tradução técnica EN-PT.'] }], education: [{ title: 'Licenciatura em Letras', institution: 'UEM', period: '', details: '' }], skills: ['Excel', 'Word'], languages: ['Português', 'Inglês'], additional: [] } },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (!/api\.openai\.com|openrouter\.ai|api\.deepseek\.com|generativelanguage\.googleapis\.com/.test(String(url))) return realFetch(url, opts);
    const body = JSON.parse(opts.body), system = body.messages?.[0]?.content || '';
    const task = system.includes('REGRAS ESPECÍFICAS DO CV') ? 'cv' : system.includes('"cover_letter"') ? 'kit' : system.includes('"questions"') ? 'interview' : 'analyze';
    const lang = system.includes('LANGUAGE (highest priority') ? 'en' : 'pt';
    calls.push({ task, lang, userHasCv: String(body.messages?.[1]?.content || '').includes('CV_') });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(FIX[lang][task]) } }] }), { status: 200 });
  };
}
const { default: handler } = await import('../api/analyze.js');

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__calls') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(calls)); }
  if (url.pathname === '/api/analyze') {
    const chunks = []; for await (const c of req) chunks.push(c);
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch { body = undefined; }
    const r = { method: req.method, headers: req.headers, body };
    const o = { statusCode: 200, setHeader: (k, v) => res.setHeader(k, v), status(c) { this.statusCode = c; return this; }, json(b) { res.statusCode = this.statusCode; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(b)); } };
    return handler(r, o);
  }
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let f = join(ROOT, p); if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!f.startsWith(ROOT) || !existsSync(f) || /\/(services|data|tests|scripts|branding)\//.test(p) || /package\.json|vercel\.json/.test(p)) { res.statusCode = 404; return res.end('404'); }
  for (const h of staticHeaders) res.setHeader(h.key, h.value);
  res.setHeader('content-type', MIME[extname(f)] || 'application/octet-stream');
  res.end(readFileSync(f));
}).listen(PORT, () => console.log('dev-server em http://localhost:' + PORT + (process.env.STUB_AI === '1' ? ' (IA simulada)' : '')));
