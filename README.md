# AI Job Application Copilot — V1

Transforma o teu CV numa candidatura mais forte. Sem login e sem pagamentos automáticos.

## Estrutura
- `index.html` — página única (landing + fluxo de 5 passos)
- `css/style.css` — estilos
- `js/state.js` — configuração (número WhatsApp, preço, limites), estado, helpers, tracking de eventos
- `js/demo.js` — dados fictícios do modo DEMO
- `js/ui.js` — renderização (landing, passos, análise, kit, entrevista)
- `js/cv-input.js` — leitura de PDF/DOCX no navegador e validações
- `js/analysis.js` — chamadas à API e desbloqueio Premium
- `js/app.js` — arranque
- `api/analyze.js` — rota serverless (Vercel): método, validação, limites de pedidos, autorização Premium, tratamento de erros
- `services/ai.js` — abstracção Provider → Modelo (timeouts, tentativa alternativa, erros sem detalhes internos)
- `services/validate.js` — validação do pedido (tarefas permitidas, tipos, tamanhos)
- `services/schema.js` — validação/normalização das respostas JSON da IA e filtragem do conteúdo Premium
- `services/premium.js` — validação de códigos Premium (comparação em tempo constante)
- `services/ratelimit.js` — limite de pedidos por IP (Redis REST partilhado, com fallback em memória)
- `services/log.js` — logs estruturados sem dados pessoais
- `data/prompts.js` — prompts (análise, kit, entrevista) e construção da mensagem com delimitadores
- `tests/` — testes automáticos (`npm test`)

## Configuração (Vercel → Settings → Environment Variables; ver `.env.example`)
| Variável | Obrigatória | Descrição |
|---|---|---|
| `AI_PROVIDER` | sim | `gemini`, `openai`, `openrouter` ou `deepseek` (se ficar vazia, o código assume `openai`) |
| `AI_API_KEY` | sim | chave do fornecedor (só existe no servidor) |
| `AI_MODEL` | não | substitui o modelo por defeito |
| `PREMIUM_CODES` | sim, para o Premium | códigos separados por vírgula. Usa códigos longos e aleatórios (≥ 16 caracteres). Sem esta variável **nenhum** código é aceite |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (ou `KV_REST_API_URL` + `KV_REST_API_TOKEN`) | recomendada | Redis REST para o limite de pedidos ser **partilhado entre instâncias**. Sem isto, o limite é por instância e não é garantido |

O número de WhatsApp e o preço estão em `CONFIG` (`js/state.js`). Deploy: ligar o repositório à Vercel ou `vercel`. Local: `vercel dev`.

### Limite de pedidos consistente (Redis)
1. No painel da Vercel, adiciona uma base Redis pela integração de Marketplace (Upstash for Redis) e liga-a a este projecto.
2. Confirma, em Settings → Environment Variables, os nomes criados pela integração (`UPSTASH_REDIS_REST_*` ou `KV_REST_API_*`); o código aceita qualquer um dos dois pares.
3. Faz um novo deploy. Nos logs, a ausência de `ratelimit_store_error` indica que o Redis está a responder; se falhar, a aplicação continua com o limite em memória.
O Redis guarda apenas contadores com um identificador pseudonimizado do IP (HMAC), que expira ao fim da janela (10 min / 1 h).

## Testes
`npm test` (Node ≥ 18, sem dependências). Os testes simulam a IA e o Redis; não chamam serviços reais. Não cobrem a leitura real de PDF/DOCX (precisa de navegador e das bibliotecas do CDN).

## Notas
- A chave de IA nunca vai para o navegador.
- O Premium é decidido **só no servidor**: o conteúdo Premium não é enviado a quem não tem código válido. O estado da interface não desbloqueia nada.
- Privacidade: o texto do CV e da vaga é enviado ao fornecedor de IA configurado, que o trata segundo as suas políticas. Esta aplicação não grava o CV nem a vaga, mas **não pode garantir** o que o fornecedor de IA ou a infraestrutura de alojamento fazem com os dados. Os logs não registam CV, vaga, códigos nem chaves.
- Os códigos Premium são partilháveis (um código = vários utilizadores). Ver recomendações P1.
- Eventos de analytics: `window.addEventListener('copilot:event', e => ...)`.
