# ApplyPro — ferramentas de carreira com IA

> Anteriormente "AI Job Application Copilot". O nome visível ao utilizador é ApplyPro; identificadores técnicos antigos mantêm-se por compatibilidade (ver "Identidade visual").

Transforma o teu CV numa candidatura mais forte. Sem login e sem pagamentos automáticos.

## Estrutura
- `index.html` — página única (landing + fluxo de 5 passos)
- `css/style.css` — estilos
- `js/i18n.js` — traduções PT (por defeito) e EN, escolha de língua (`?lang=`, guardada no navegador)
- `js/state.js` — configuração (número WhatsApp, preço, limites), estado, helpers, tracking de eventos
- `js/demo.js` — dados fictícios do modo DEMO
- `js/ui.js` — renderização (landing, passos, análise, kit, entrevista)
- `js/cv-input.js` — leitura de PDF/DOCX no navegador e validações
- `js/analysis.js` — chamadas à API e desbloqueio Premium
- `js/app.js` — arranque e eventos (um ouvinte por tipo de evento; o HTML não tem `onclick` nem `style` inline, por causa da CSP)
- `js/export.js` — exportação para PDF (jsPDF) e Word (.docx criado no próprio ficheiro, sem biblioteca); tudo no navegador
- `js/legal.js` — língua das páginas `privacy.html` e `terms.html`
- `vendor/` — pdf.js, mammoth e jsPDF alojados localmente (sem CDN)
- `scripts/` — `gen-codes.mjs` (gera códigos Premium), `dev-server.mjs` + `e2e.py` (teste ponta-a-ponta local; não é publicado)
- `api/analyze.js` — rota serverless (Vercel): método, validação, limites de pedidos, autorização Premium, tratamento de erros
- `services/ai.js` — abstracção Provider → Modelo (timeouts, tentativa alternativa, erros sem detalhes internos)
- `services/validate.js` — validação do pedido (tarefas permitidas, tipos, tamanhos)
- `services/schema.js` — validação/normalização das respostas JSON da IA e filtragem do conteúdo Premium
- `services/premium.js` — validação de códigos Premium (tempo constante), códigos pessoais `etiqueta=código` e limite diário por código
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
| `PREMIUM_CODES` | sim, para o Premium | códigos separados por vírgula; cada um pode ser `CODIGO` ou `etiqueta=CODIGO` (um por cliente; gera com `node scripts/gen-codes.mjs maria joao`). Sem esta variável **nenhum** código é aceite |
| `PREMIUM_DAILY_LIMIT` | não | pedidos de IA por código e por 24 h (defeito 30; `0` = sem limite). Com Redis (Upstash) o limite é global; sem Redis é por instância e reinicia nos arranques a frio |
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
- Eventos de analytics: `window.addEventListener('copilot:event', e => ...)` (nome mantido de propósito, para não quebrar quem já o escuta).

## Imagens e branding
- `assets/img/` — imagens usadas pelo site (WebP em 2 larguras + `og-image.png`). Referenciadas em `js/ui.js` (`heroImg()`, `features()`) e `index.html`.
- `assets/social/` — peças para redes sociais (LinkedIn, Facebook, WhatsApp Status, quadrado, banner largo, showcase de produto). Não são carregadas pelo site.
- `branding/` — **não** é publicado (ver `.vercelignore`): masters 2x, screenshots reais da app e scripts (`tools/`) para regenerar tudo. As imagens são capturas REAIS da aplicação em molduras de dispositivos desenhadas em CSS (não são renders fotorrealistas).
- Para regenerar: servir a pasta (`python3 -m http.server 8123`), correr `branding/tools/shoot.py` e depois `build_assets.py` (precisa de Playwright + Pillow e das fontes @fontsource; os caminhos nos scripts são os do ambiente original e podem precisar de ajuste).
- Depois de ter o domínio final, torna absoluto o `og:image` em `index.html` (ex.: `https://o-teu-dominio.vercel.app/assets/img/og-image.png`).

## Identidade visual
- Tokens (cores, raios, tipografia) em `:root` de `css/style.css`: azul-marinho `#101827`, teal `#60E5C2`, fundo `#F5F7FB`; `--teal-ink` (`#0B6B58`) para texto sobre fundo claro.
- Tipo de letra Plus Jakarta Sans, alojado em `assets/fonts/` (licença OFL incluída), sem pedidos a serviços externos.
- Logótipo: `assets/logo-mark.svg`, `logo-light.svg` (fundos claros), `logo-dark.svg` (fundos escuros), `favicon.svg`. Os wordmarks têm o texto convertido em curvas.
- Imagens: `assets/img` (site e og:image), `assets/social` (redes sociais). Reconstruir com `branding/tools/run_all.sh` (precisa de Python, Playwright e Pillow; `branding/` não é publicado, ver `.vercelignore`). Os ecrãs nas imagens são capturas reais da app em modo demo; não foi usado gerador de imagens.
- Antes de publicar: tornar o `og:image` absoluto com o domínio final em `index.html`.

## Idiomas
PT (pt-MZ) é o idioma por defeito; EN através do selector PT/EN no cabeçalho. O pedido à API leva `lang` (`pt`|`en`): em EN o prompt de sistema recebe uma instrução extra para responder em inglês; em PT o prompt é exactamente o original. Os textos estão em `js/i18n.js` (mesmas chaves nas duas línguas; há um teste que o garante). As imagens do site têm versão EN (`*-en-*.webp`); as imagens sociais e o og:image são em português.

## Segurança (CSP)
`vercel.json` define uma Content-Security-Policy estrita: `script-src 'self'`, `style-src 'self'`, sem `unsafe-inline`/`unsafe-eval` e sem origens externas. Por isso: nada de `onclick=`, `style=` ou `<script>` inline; bibliotecas e fontes são locais (`vendor/`, `assets/fonts/`). Os testes em `tests/premium-i18n.test.js` falham se alguém reintroduzir isto.

## Teste ponta-a-ponta local
`STUB_AI=1` simula só o fornecedor de IA; o resto (handler real, CSP, navegador) é real. Corre `python3 scripts/e2e.py` (precisa de Node, Playwright, reportlab, python-docx, Pillow). Cobre: PT/EN, envio real de PDF/DOCX, fluxo grátis e Premium, limite por código, páginas legais, mobile e violações de CSP. Não cobre IA real, Redis real, pagamentos nem a Vercel.

## CV adaptado, PDF e Word
- **Kit** (Premium): carta, email e resumo, cada um com Copiar, PDF e Word.
- **CV adaptado à vaga** (Premium, tarefa `cv` em `/api/analyze`): a IA reorganiza e reescreve **apenas** o que está no CV do utilizador. O utilizador edita tudo, tem de confirmar que revisou ("Revi o conteúdo e confirmo que é verdadeiro") e só então descarrega PDF ou Word.
- **Verificação no servidor** (`groundCv`, `services/schema.js`): nome e contactos que não aparecem no CV original são removidos; números e nomes de empresas/instituições que não aparecem no CV são assinalados ao utilizador. Isto reduz, mas não elimina, o risco de a IA inventar: a revisão do utilizador continua a ser necessária.
- Os ficheiros são criados no navegador: nada é enviado ao servidor. PDF: fontes padrão (Latin-1, cobre o português); caracteres fora do Latin-1 são omitidos no PDF (mantêm-se no Word). Na demonstração, os ficheiros trazem a marca DEMO.
- Cada pedido de IA (análise, kit, CV, entrevista) conta para `PREMIUM_DAILY_LIMIT`: uma utilização completa gasta 4 pedidos (mais 1 por cada "gerar de novo").

## Testes
`npm test` corre os 5 ficheiros em `tests/` (132 testes: API, frontend, recursos/CSP, códigos Premium/idiomas, CV). `python3 scripts/e2e.py` corre o teste de navegador.
