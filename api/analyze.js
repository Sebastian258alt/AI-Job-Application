import { generateJSON } from '../services/ai.js';
import { PROMPTS } from '../data/prompts.js';
const hits = new Map(); // limite simples por IP (best-effort em serverless)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0] || 'x', now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 600000);
  if (recent.length >= 12) return res.status(429).json({ error: 'Muitos pedidos. Tenta novamente dentro de alguns minutos.' });
  hits.set(ip, [...recent, now]);
  const { task, cv, vacancy, code } = req.body || {};
  if (!PROMPTS[task]) return res.status(400).json({ error: 'Pedido inválido.' });
  if (!cv?.trim() || !vacancy?.trim()) return res.status(400).json({ error: 'Falta o CV ou a vaga.' });
  if (cv.length > 20000 || vacancy.length > 12000) return res.status(413).json({ error: 'O texto é demasiado longo.' });
  if (task !== 'analyze') { // Premium verificado no servidor
    const ok = (process.env.PREMIUM_CODES || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!code || !ok.includes(code)) return res.status(402).json({ error: 'Conteúdo Premium.' });
  }
  try {
    const data = await generateJSON(PROMPTS[task], `CV:\n"""\n${cv}\n"""\n\nVAGA:\n"""\n${vacancy}\n"""`);
    res.status(200).json({ data });
  } catch (e) {
    // Log técnico no servidor (sem conteúdo do CV) — ver Vercel → Logs
    console.error('ai_error', e.message, e.detail || '');
    const reason = String(e.message || 'UNKNOWN'), detail = String(e.detail || '').slice(0, 300);
    if (reason.startsWith('NOT_CONFIGURED')) return res.status(503).json({ error: 'Serviço de IA não configurado. Contacta o suporte.', reason, detail });
    if (e.name === 'AbortError') return res.status(504).json({ error: 'A análise demorou demasiado. Tenta novamente.', reason: 'TIMEOUT' });
    if (e.status === 429) return res.status(503).json({ error: 'O serviço de IA está com muito tráfego. Tenta novamente dentro de 1 minuto.', reason, detail });
    // reason/detail aparecem no separador Network do navegador para diagnóstico (nunca contêm a chave nem o CV)
    res.status(502).json({ error: 'Não foi possível concluir a análise agora. Tenta novamente dentro de alguns instantes.', reason, detail });
  }
}
