# Changelog

Formato: mais recente primeiro. Cada entrada indica ficheiros alterados, testes e como reverter.

## Stage 6 · Fase 1 — Auditoria e estabilização (2026-11-12)

Sem funcionalidades novas para o utilizador. Só correcções e observabilidade; nenhum teste existente foi alterado ou enfraquecido.

### Corrigido
- **F-1** Ligação "Sobre" do rodapé na landing: voltava ao topo em vez de ir à secção (dois scrolls suaves em conflito). `js/app.js`, `js/ui.js` (`go()` ganhou o 3.º argumento opcional `keepScroll`; as chamadas existentes não mudam). O teste E2E que já existia passou de falhado para correcto, sem o alterar.

### Segurança / produção
- **S-1** O recurso a memória quando o Redis falha deixa de ser silencioso: `storeHealth()` (`shared` | `memory` | `degraded`) e contador de falhas. Novo modo opcional `REQUIRE_SHARED_STORE=1`: as rotas de IA (`/api/analyze`) respondem **503 `RATE_LIMIT_UNAVAILABLE`** em vez de usar um limite por instância. Sem a variável, o comportamento é exactamente o anterior. `services/ratelimit.js`, `api/analyze.js`, `js/i18n.js` (mensagem EN).
- **S-3** Fornecedores: cooldown com recuo exponencial (base, 2x, 4x… máx. 1 h) quando a falha não traz `Retry-After`; o sucesso repõe-no. Remotive passa a base de 15 min (antes 60 s) por causa da quota (~4 pedidos/dia). Um `Retry-After`/`cooldownSec` do fornecedor continua a prevalecer. `services/jobs/cache.js`, `services/jobs/providers/remotive.js`.
- **S-4** Novo `RATELIMIT_SECRET` para o HMAC dos IPs (precedência: `RATELIMIT_SECRET` > `AI_API_KEY` > constante pública). Quem não define a nova variável mantém os mesmos identificadores. Se ficar só a constante pública, o pseudónimo do IP é reversível por força bruta: define uma das duas.
- **S-6** Novo `GET /api/health`: `{ status: ok|degraded|down, checks: { ai, jobs, rateLimitStore } }`. Sem chamadas externas, sem segredos, sem nomes de fornecedores. 503 só quando as rotas de IA não conseguem funcionar. `api/health.js`, `services/ai.js` (nova exportação `aiConfigured`, sem alterar o resto).

### Testes
- Novo `tests/stabilization.test.js` (20 testes, tudo simulado). Total: 253 unitários + 104 verificações E2E locais (E2E: navegador real, IA simulada).
- **Não verificado** (sem credenciais/rede neste ambiente): Remotive real, Redis real, fornecedores de IA reais, Vercel.

### Conhecido e adiado (ver auditoria)
- F-2 a F-7 (elegibilidade de localização, regiões, dedupe, descrições de 400 caracteres, custo do SmartMatch): Fases 2 e 3.
- S-2 (tarefa `profile` gratuita sem tecto global de custo), S-5, S-7, S-8.

### Reverter
Ver `DEPLOY.md` §6. Nenhuma migração de dados. Variáveis novas são todas opcionais.
