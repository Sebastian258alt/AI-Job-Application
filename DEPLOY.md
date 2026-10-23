# ApplyPro: guia de publicação

Este ficheiro não é publicado (está no `.vercelignore`).

## 1. Substituir os ficheiros
Extrai o zip **por cima** da pasta do projecto (a raiz do zip é a raiz do projecto). Mantém a tua pasta `.git`, se existir. Nada foi apagado em relação à versão anterior; foram acrescentados `vendor/` (inclui jsPDF), `js/export.js`, `tests/cv.test.js`, `vendor/`, `assets/fonts/`, `assets/logo-*.svg`, `scripts/`, `privacy.html`, `terms.html`, `robots.txt`, `sitemap.xml`, `js/i18n.js`, `js/legal.js`, `DEPLOY.md` e imagens `*-en-*.webp`.

## 2. Variáveis de ambiente (Vercel → Settings → Environment Variables)
Os nomes existentes **não mudaram**. Se já funcionava, continua a funcionar sem mexer em nada.

| Variável | Estado | Notas |
|---|---|---|
| `AI_PROVIDER`, `AI_API_KEY` | existentes | iguais |
| `PREMIUM_CODES` | existente | os códigos actuais continuam válidos. Novo (opcional): `etiqueta=CODIGO` por cliente |
| `PREMIUM_DAILY_LIMIT` | **nova, opcional** | defeito 30 pedidos de IA por código/24 h; `0` desactiva |
| `UPSTASH_REDIS_REST_URL/TOKEN` (ou `KV_REST_API_*`) | existentes, opcionais | recomendado: sem Redis, o limite diário por código é por instância e reinicia nos arranques a frio |

Códigos pessoais: `node scripts/gen-codes.mjs maria joao` gera `maria=XXXX-XXXX-XXXX-XXXX,joao=...`. Cola na `PREMIUM_CODES` e volta a publicar (as variáveis só mudam num novo deploy). Para revogar um código, apaga a entrada e volta a publicar. A etiqueta aparece nos registos da Vercel (`premium_use`): usa iniciais ou um apelido.

## 3. Antes de passar a produção (usa um deploy de pré-visualização)
Estas verificações precisam dos teus serviços reais e **não foram executadas por mim**:
1. Uma análise completa em PT e outra em EN com a tua chave de IA real. Confirma que, em EN, a resposta vem em inglês.
2. Um código Premium real: desbloquear, gerar candidatura e entrevista.
3. **Fotografar um CV em papel** (passo 1): num telemóvel real, tira uma fotografia com a câmara, confirma que abre a câmara, que o texto é lido e que a primeira leitura descarrega o leitor (3 a 5 MB). Testa também em Android e iPhone e, se possível, com a rede móvel. Só foi testado em Chromium com ficheiros de imagem (não com a câmara física).
4. **CV adaptado e descargas** (passo 4 do fluxo): gerar o CV com o teu CV real, ler os avisos, editar, confirmar e descarregar PDF e Word; abrir o .docx no Microsoft Word (só foi testado com python-docx e mammoth) e o PDF no telemóvel. Confirma que a IA não inventou nada.
5. Enviar um PDF e um DOCX reais (do telemóvel também). A CSP foi testada em Chromium; falta Safari/Firefox.
6. Abrir `/privacy.html`, `/terms.html`, e a ligação "Suporte por WhatsApp".
7. Partilhar o URL no WhatsApp para ver a pré-visualização (og:image).
8. Consola do navegador sem erros de "Content Security Policy".

## 4. O domínio applypro.vercel.app
O código já aponta para `https://applypro.vercel.app` (canonical, og:url, og:image, robots, sitemap). **Falta, do teu lado, na Vercel:** Project → Settings → Domains → adicionar `applypro.vercel.app` (ou mudar o nome do projecto para `applypro`). Se esse nome já estiver ocupado por outro projecto, a Vercel recusa: nesse caso escolhe outro e troca-o nos ficheiros abaixo. Enquanto o domínio não estiver activo, as pré-visualizações de partilha (og:image) não carregam.

Quando mudares de domínio no futuro, o URL está em: `index.html` (canonical, `og:url`, `og:image`, `twitter:image`), `robots.txt` e `sitemap.xml`. Troca nos 3 ficheiros. Nada mais depende do domínio (a API é de mesma origem).

## 5. Secção Sobre
Está na landing (e no rodapé) com a ligação `https://snhamoneque.vercel.app`. O texto está em `js/i18n.js` (`about.*`) nas duas línguas e só contém afirmações verificáveis; revê-o e ajusta se quiseres acrescentar mais sobre ti.

## 6. Reverter
Faz deploy da versão anterior na Vercel (Deployments → Promote), ou repõe os ficheiros antigos. Não há migrações de dados nem alterações de base de dados.

## 7. Limitações conhecidas
- **Páginas legais**: foram escritas só com o que o código faz (sem contas, o que é enviado à IA, o que se guarda). Não indicam lei aplicável nem política de reembolso (não tenho essa informação). Recomenda-se revisão por um jurista moçambicano.
- **CSP estrita**: se um dia acrescentares analytics ou outro script de terceiros, tens de alargar a CSP em `vercel.json` (e conhecer o risco).
- **pdf.js 3.11.174**: é a versão que a aplicação já usava. Tem um CVE conhecido (CVE-2024-4367) mitigado aqui com `isEvalSupported:false` e pela CSP sem `unsafe-eval`. Actualizar para pdf.js 4.x exige trocar para módulos ES.
- **Política de segurança (CSP) e OCR**: para ler fotografias a página tem de poder executar WebAssembly. Por isso o `vercel.json` passou a ter `script-src 'self' 'wasm-unsafe-eval'`. Isto permite WebAssembly mas **não** `eval()` nem scripts inline, e é a única excepção. Se não quiseres a funcionalidade de fotografias, podes apagar `vendor/tesseract/` e `js/scan.js` e voltar a `script-src 'self'` (e ajustar o teste que verifica a CSP).
- **Tamanho do repositório**: `vendor/tesseract/` tem cerca de 16 MB (3 motores + 2 línguas). Nenhum ficheiro passa de 4 MB. Com o upload pelo navegador do GitHub tens de enviar em lotes de até 100 ficheiros.
- **OCR**: é aproximado. Pode trocar caracteres (um `@` lido como `&g` aconteceu num dos testes) e não lê bem manuscrito, tabelas complexas ou fotografias com sombras. O texto é sempre mostrado ao utilizador para correcção. Em telemóveis lentos cada página pode demorar bastante mais do que os ~3 s medidos no computador de teste.
- **Cache do leitor**: `vercel.json` tem uma regra `Cache-Control: public, max-age=2592000` para `/vendor/tesseract/`. Se actualizares esses ficheiros, muda o nome ou espera/limpa a cache.
- **CV adaptado**: a IA pode errar. O servidor remove contactos/nome que não estão no CV e assinala números e nomes novos, mas não consegue provar que o resto é fiel; por isso a descarga exige a confirmação do utilizador.
- **PDF**: usa fontes padrão (Latin-1). Nomes com caracteres fora do Latin-1 (por exemplo, alguns nomes polacos ou vietnamitas) ficam sem esses caracteres no PDF; no Word ficam intactos.
- **Limite diário**: cada pedido de IA conta; uma utilização completa (análise, kit, CV, entrevista) gasta 4 de 30 por defeito.
- **Imagens**: as do site têm versão PT e EN; as redes sociais e o og:image são só em português.
- **Limite por código sem Redis**: ver acima.
