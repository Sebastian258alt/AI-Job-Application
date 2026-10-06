# AI Job Application Copilot — V1

Transforma o teu CV numa candidatura mais forte. Sem login, sem base de dados, sem pagamentos automáticos.

## Estrutura
- `index.html` — página única (landing + fluxo de 5 passos)
- `css/style.css` — estilos
- `js/state.js` — configuração (número WhatsApp, preço), estado, helpers, tracking de eventos
- `js/demo.js` — dados fictícios do modo DEMO
- `js/ui.js` — renderização (landing, passos, análise, kit, entrevista)
- `js/cv-input.js` — leitura de PDF/DOCX no navegador e validações
- `js/analysis.js` — chamadas à API
- `js/app.js` — arranque
- `api/analyze.js` — rota serverless (Vercel): validação, limite de pedidos, verificação Premium
- `services/ai.js` — abstracção Provider → Modelo
- `data/prompts.js` — prompts (análise, kit, entrevista)

## Configuração
1. O número de WhatsApp e o preço estão em `CONFIG` (`js/state.js`).
2. Variáveis de ambiente (Vercel → Settings → Environment Variables), ver `.env.example`:
   `AI_PROVIDER=gemini` (ou openai | openrouter | deepseek | gemini), `AI_API_KEY`, `AI_MODEL` (opcional), `PREMIUM_CODES` (códigos separados por vírgula).
3. Deploy: `vercel` (ou ligar o repositório ao Vercel). Local: `vercel dev`.

## Notas
- A chave de IA nunca vai para o navegador.
- CV e vaga são processados temporariamente e não são guardados.
- O Premium é desbloqueado por código (validado no servidor) após o pagamento combinado por WhatsApp.
- Eventos de analytics: `window.addEventListener('copilot:event', e => ...)`.
