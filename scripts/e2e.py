"""Teste ponta-a-ponta LOCAL: navegador real + handler real de api/analyze.js + IA simulada + CSP de vercel.json aplicada.
Uso (na raiz do projecto): python3 scripts/e2e.py   Requer: node, playwright, reportlab, python-docx, pillow.
Não testa: fornecedor de IA real, Redis real, Vercel, pagamentos/WhatsApp."""
import subprocess,time,json,os,sys,urllib.request,urllib.error,tempfile,pathlib
from playwright.sync_api import sync_playwright
import socket,atexit
def free_port():
    s=socket.socket();s.bind(('127.0.0.1',0));p=s.getsockname()[1];s.close();return p
ROOT=pathlib.Path(__file__).resolve().parents[1];PORT=free_port();BASE=f'http://localhost:{PORT}'  # porta livre: nunca reutiliza um servidor antigo (os contadores por código são em memória)
LOG=pathlib.Path(tempfile.gettempdir())/'applypro-dev.log'
ENV=dict(os.environ,STUB_AI='1',PREMIUM_CODES='maria=MARIA-CODE-1234,joao=JOAO-CODE-5678,ana=ANA-CODE-4242,LEGACYCODE12345',PREMIUM_DAILY_LIMIT='4',AI_API_KEY='stub-key-not-real')
srv=subprocess.Popen(['node',str(ROOT/'scripts/dev-server.mjs'),str(PORT)],cwd=ROOT,env=ENV,stdout=open(LOG,'w'),stderr=subprocess.STDOUT)
atexit.register(lambda:(srv.terminate(),srv.wait(5)))  # termina sempre o servidor, mesmo se o teste falhar a meio
# ---- ficheiros de teste reais
FX=pathlib.Path(tempfile.mkdtemp())
CVTXT=['Joao Silva (ficticio) - Licenciado em Letras','Professor de ingles durante 4 anos numa escola secundaria.','Traducao tecnica EN-PT. Conhecimentos de Word e Excel. MARCADOR-E2E']
from reportlab.pdfgen import canvas
c=canvas.Canvas(str(FX/'cv.pdf'))
for i,l in enumerate(CVTXT):c.drawString(72,780-20*i,l)
c.save()
c=canvas.Canvas(str(FX/'long.pdf'))
for p in range(16):c.drawString(72,780,f'Pagina {p+1} com texto suficiente para o teste de limite de paginas do PDF.');c.showPage()
c.save()
import docx;d=docx.Document()
for l in CVTXT:d.add_paragraph(l)
d.save(str(FX/'cv.docx'))
from PIL import Image,ImageDraw
im=Image.new('RGB',(600,300),'white');ImageDraw.Draw(im).text((20,20),'texto em imagem',fill='black');im.save(FX/'scan.pdf')
(FX/'fake.pdf').write_text('isto nao e um pdf');(FX/'cv.txt').write_text('x'*80)
R=[]
def pdftext(path):
    return subprocess.run(['pdftotext','-layout',str(path),'-'],capture_output=True,text=True).stdout
def docxtext(path):
    import docx as _d;return '\n'.join(p.text for p in _d.Document(str(path)).paragraphs)
def download(pg,selector):
    with pg.expect_download() as d:pg.click(selector)
    dl=d.value;p=FX/('dl-'+dl.suggested_filename);dl.save_as(str(p));return dl.suggested_filename,p
def until(pg,expr,timeout=15000):
    # Polling via CDP (pg.evaluate). NÃO usar pg.wait_for_function: avalia texto com eval() na página, que a CSP bloqueia (artefacto do teste, não da app).
    t0=time.time()
    while (time.time()-t0)*1000<timeout:
        if pg.evaluate('()=>!!('+expr+')'):return
        time.sleep(.1)
    raise TimeoutError(expr)
def check(name,ok,info=''):R.append((name,bool(ok)));print(('PASS' if ok else 'FAIL'),name,info)
def post(body,ip):
    r=urllib.request.Request(BASE+'/api/analyze',json.dumps(body).encode(),{'content-type':'application/json','x-real-ip':ip})
    try:
        with urllib.request.urlopen(r) as x:return x.status,json.loads(x.read())
    except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
for _ in range(50):
    try:urllib.request.urlopen(BASE+'/');break
    except Exception:time.sleep(.2)
CV='Joao Silva (ficticio). Licenciado em Letras. Professor de ingles durante 4 anos. Traducao tecnica EN-PT.';VAC='Assistente de Projectos. Requisitos: licenciatura, ingles fluente, gestao de projectos, Excel.'
with sync_playwright() as p:
    b=p.chromium.launch()
    # nota: o 402 de um código inválido aparece na consola do navegador; é esperado nos testes e por isso é ignorado
    def ctx(ip,w=1280,h=900):
        cx=b.new_context(viewport={'width':w,'height':h},extra_http_headers={'x-real-ip':ip});pg=cx.new_page();pg.errs=[]
        pg.add_init_script("window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective+' '+e.blockedURI))")
        pg.on('console',lambda m:pg.errs.append(m.text) if m.type=='error' and 'status of 402' not in m.text else None);pg.on('pageerror',lambda e:pg.errs.append(str(e)));return pg
    def clean(pg,name):
        v=pg.evaluate('window.__csp');check(name+': sem violações CSP nem erros de consola',not v and not pg.errs,f'csp={v} errs={pg.errs}')
    # 1) cabeçalhos + landing PT
    r=urllib.request.urlopen(BASE+'/');csp=r.headers.get('Content-Security-Policy','')
    check('CSP presente, sem unsafe-inline/unsafe-eval',"script-src 'self'" in csp and 'unsafe' not in csp)
    pg=ctx('10.1.0.1');pg.goto(BASE+'/');pg.wait_for_selector('.hero')
    check('landing PT: h1 e title',pg.inner_text('h1').startswith('O teu CV') and pg.title().startswith('ApplyPro'))
    check('fonte Plus Jakarta Sans carregada',pg.evaluate("document.fonts.check('800 16px \"Plus Jakarta Sans\"')"))
    check('anel de pontuação recebe --p por CSSOM',pg.evaluate("getComputedStyle(document.querySelector('.ring')).getPropertyValue('--p').trim()")=='78')
    # 2) idioma
    pg.click('[data-lang=en]');until(pg,"document.querySelector('h1').innerText.startsWith('Is your CV')")
    check('EN: h1, html lang, title, footer traduzidos',pg.evaluate("document.documentElement.lang")=='en' and pg.title().startswith('ApplyPro | AI-powered') and 'Privacy' in pg.inner_text('footer'))
    pg.wait_for_timeout(300)
    check('EN: imagem hero EN carrega',pg.evaluate("(()=>{const i=document.querySelector('.heroimg');return i.currentSrc.includes('-en-')&&i.naturalWidth>0})()"))
    pg.reload();pg.wait_for_selector('.hero');check('EN persiste após recarregar (localStorage)',pg.inner_text('h1').startswith('Is your CV'))
    pg.goto(BASE+'/?lang=pt');pg.wait_for_selector('.hero');check('?lang=pt sobrepõe a escolha guardada',pg.inner_text('h1').startswith('O teu CV'))
    clean(pg,'landing')
    # 3) upload real PDF/DOCX sob CSP
    for fn,lab in [('cv.pdf','PDF'),('cv.docx','DOCX')]:
        pg=ctx('10.1.0.2');pg.goto(BASE+'/');pg.click('[data-act=start]');pg.set_input_files('#f',str(FX/fn))
        try:until(pg,"document.querySelector('#cv').value.includes('MARCADOR-E2E')",timeout=20000);ok=True
        except Exception:ok=False
        check(f'upload {lab} real: texto extraído para a caixa do CV',ok,pg.inner_text('.err') if not ok else '');clean(pg,'upload '+lab)
    for fn,frag,lab in [('scan.pdf','digitalizado','PDF só com imagem'),('fake.pdf','não corresponde','conteúdo falso .pdf'),('long.pdf','páginas','PDF > 15 páginas'),('cv.txt','Formato não suportado','extensão .txt')]:
        pg=ctx('10.1.0.3');pg.goto(BASE+'/');pg.click('[data-act=start]');pg.set_input_files('#f',str(FX/fn));until(pg,"!document.querySelector('.err').classList.contains('hide')",timeout=20000)
        check(f'recusa: {lab}',frag in pg.inner_text('.err'),pg.inner_text('.err')[:60])
    pg=ctx('10.1.0.4');pg.goto(BASE+'/');pg.click('[data-act=start]');pg.focus('#f')
    check('input de ficheiro é focável por teclado',pg.evaluate("document.activeElement.id")=='f')
    # 4) fluxo completo PT
    pg=ctx('10.1.1.1');pg.goto(BASE+'/');pg.click('[data-act=start]');pg.fill('#cv',CV);pg.click('[data-act=next1]');pg.fill('#vac',VAC);pg.click('[data-act=next2]');pg.wait_for_selector('.score',timeout=15000)
    check('PT grátis: pontuação 64/100 e só 1 melhoria',pg.inner_text('.score .ring i')=='64/100' and pg.locator('text=Actual:').count()==1)
    pg.click('[data-act=kit]');check('PT: kit bloqueado sem código',pg.locator('.lock').count()==1)
    pg.fill('#code','codigo-errado');pg.click('[data-act=unlock]');pg.wait_for_selector('.lock .err:not(.hide)');check('PT: código inválido => erro',pg.inner_text('.lock .err')=='Código Premium inválido.')
    pg.fill('#code','MARIA-CODE-1234');pg.press('#code','Enter');pg.wait_for_selector('[data-act=genkit]');pg.click('[data-act=genkit]');pg.wait_for_selector('#k1');
    check('PT: código pessoal (Enter) desbloqueia e gera o kit',pg.inner_text('#k1').startswith('Carta [STUB]'))
    pg.click('[data-act=copy]');pg.click('[data-act=iv]');pg.click('[data-act=geniv]');pg.wait_for_selector('details summary')
    check('PT: entrevista com exemplo por defeito',pg.inner_text('details summary').startswith('Pergunta 1'))
    clean(pg,'fluxo PT')
    # 5) fluxo completo EN (kit/entrevista pedidos em inglês)
    pg=ctx('10.1.2.1');pg.goto(BASE+'/?lang=en');pg.click('[data-act=start]');pg.fill('#cv',CV);pg.click('[data-act=next1]');pg.click('[data-act=next2]')
    check('EN: validação traduzida',pg.inner_text('.err')=='Paste the job description to continue.')
    pg.fill('#vac',VAC);pg.click('[data-act=next2]');pg.wait_for_selector('.score',timeout=15000);check('EN: resultados em inglês',pg.locator('text=Strengths').count()==1 and pg.locator('text=Fluent English').count()>=1)
    pg.click('[data-act=kit]');pg.fill('#code','x');pg.click('[data-act=unlock]');pg.wait_for_selector('.lock .err:not(.hide)');check('EN: código inválido em inglês',pg.inner_text('.lock .err')=='Invalid Premium code.')
    pg.fill('#code','JOAO-CODE-5678');pg.click('[data-act=unlock]');pg.wait_for_selector('[data-act=genkit]');pg.click('[data-act=genkit]');pg.wait_for_selector('#k1');pg.click('[data-act=iv]');pg.click('[data-act=geniv]');pg.wait_for_selector('details summary')
    pg.click('details summary');check('EN: entrevista, exemplo por defeito em inglês',pg.locator('text=Not identified in the CV.').count()>=1);clean(pg,'fluxo EN')
    calls=json.loads(urllib.request.urlopen(BASE+'/__calls').read())
    check('o pedido EN chegou ao fornecedor com a instrução de língua; PT não',[c['lang'] for c in calls if c['task']=='kit']==['pt','en'] and calls[0]['lang']=='pt',str([(c['task'],c['lang']) for c in calls]))
    # 6) limite diário por código (4/dia) e códigos pessoais
    ip='10.1.3.1';sts=[post({'task':'analyze','cv':CV,'vacancy':VAC,'code':'LEGACYCODE12345'},ip)[0] for _ in range(5)]
    check('código antigo (sem etiqueta) continua válido; 5.º pedido => 429',sts==[200,200,200,200,429],str(sts))
    s,j=post({'task':'analyze','cv':CV,'vacancy':VAC,'code':'LEGACYCODE12345'},'10.1.3.2');check('limite é por código (não por IP): outro IP também bloqueado',s==429 and j['code']=='CODE_LIMIT')
    s,j=post({'task':'analyze','cv':CV,'vacancy':VAC,'code':'JOAO-CODE-5678'},'10.1.3.3');check('outro código não é afectado',s==200)
    s,j=post({'task':'verify','code':'LEGACYCODE12345'},'10.1.3.4');check('verify não conta para o limite diário',s==200)
    s,j=post({'task':'verify','code':'maria=MARIA-CODE-1234'},'10.1.3.5');check('entrada completa "etiqueta=código" também é aceite (compatibilidade)',s==200)
    s,j=post({'task':'analyze','cv':CV,'vacancy':VAC,'code':'maria'},'10.1.3.6');check('a etiqueta sozinha NÃO é um código',s==402)
    # 6b) Voltar em todos os passos + botão voltar do navegador
    pg=ctx('10.1.6.1');pg.goto(BASE+'/');pg.click('[data-act=start]');pg.fill('#cv',CV);pg.click('[data-act=next1]');pg.fill('#vac',VAC);pg.click('[data-act=next2]');pg.wait_for_selector('.score',timeout=15000)
    pg.click('[data-act=kit]');pg.wait_for_selector('.lock');check('passo 4 tem botão Voltar',pg.locator('[data-act=goto][data-step="3"]').count()==1)
    pg.click('[data-act=goto][data-step="3"]');pg.wait_for_selector('.score');check('Voltar (4→3) mostra a análise sem a repetir',pg.inner_text('.score .ring i')=='64/100')
    pg.click('[data-act=goto][data-step="2"]');pg.wait_for_selector('#vac');check('Voltar (3→2) mantém o texto da vaga',pg.input_value('#vac')==VAC)
    pg.click('[data-act=goto][data-step="1"]');pg.wait_for_selector('#cv');check('Voltar (2→1) mantém o texto do CV',pg.input_value('#cv')==CV)
    pg.click('[data-act=goto][data-step="0"]');pg.wait_for_selector('.hero');check('Voltar (1→início) mostra a landing',pg.locator('#sobre').count()==1)
    pg.click('[data-act=start]');pg.click('[data-act=next1]');pg.wait_for_selector('#vac');pg.go_back();pg.wait_for_selector('#cv')
    check('botão voltar do navegador recua um passo (2→1) em vez de sair da app',pg.url.rstrip('/')==BASE and pg.locator('#cv').count()==1)
    pg.go_forward();pg.wait_for_selector('#vac');check('avançar do navegador volta ao passo 2',pg.locator('#vac').count()==1)
    pg=ctx('10.1.6.7');pg.goto(BASE+'/');pg.click('.hero >> text=Como funciona');pg.click('[data-act=start]');pg.wait_for_selector('#cv');pg.go_back();pg.wait_for_selector('.hero')
    check('voltar do passo 1 para uma entrada de âncora mostra a landing',pg.locator('.hero').count()==1)
    # 6c) Kit em PDF/Word + CV adaptado (editar, rever, descarregar)
    pg=ctx('10.1.6.2');pg.goto(BASE+'/');pg.click('[data-act=start]');pg.fill('#cv',CV);pg.click('[data-act=next1]');pg.fill('#vac',VAC);pg.click('[data-act=next2]');pg.wait_for_selector('.score',timeout=15000)
    pg.click('[data-act=kit]');pg.fill('#code','ANA-CODE-4242');pg.click('[data-act=unlock]');pg.wait_for_selector('[data-act=genkit]');pg.click('[data-act=genkit]');pg.wait_for_selector('#k1')
    check('as 3 caixas do kit têm PDF e Word',pg.locator('[data-act=dl][data-fmt=pdf]').count()==3 and pg.locator('[data-act=dl][data-fmt=docx]').count()==3)
    fn,path=download(pg,'[data-act=dl][data-id=k1][data-fmt=pdf]');txt=pdftext(path)
    from pypdf import PdfReader
    r=PdfReader(str(path));pw,ph=float(r.pages[0].mediabox.width),float(r.pages[0].mediabox.height)
    check('carta em PDF: ficheiro %PDF, A4, texto da carta',open(path,'rb').read(4)==b'%PDF' and abs(pw-595)<2 and abs(ph-842)<2 and 'Carta [STUB]' in txt and fn=='Carta-de-apresentacao.pdf',f'{fn} {pw}x{ph}')
    fn,path=download(pg,'[data-act=dl][data-id=k1][data-fmt=docx]');check('carta em Word: .docx abre no python-docx com o texto',fn.endswith('.docx') and 'Carta [STUB]' in docxtext(path),fn)
    fn,path=download(pg,'[data-act=dl][data-id=k2][data-fmt=pdf]');t2=pdftext(path);check('email em PDF: assunto e corpo',('Assunto: Assunto' in t2) and 'Corpo' in t2)
    check('antes de gerar: cartão do CV com botão "Gerar CV adaptado", sem formulário',pg.locator('[data-act=gencv]').count()==1 and pg.locator('.cvform').count()==0)
    pg.click('[data-act=gencv]');pg.wait_for_selector('.cvform',timeout=15000)
    wt=pg.inner_text('.cvform .warn:nth-of-type(2)') if pg.locator('.cvform .warn').count()>1 else ''
    allw=' '.join(pg.locator('.cvform .warn').all_inner_texts())
    check('verificação: contacto inventado removido, nome fiel mantido',pg.input_value('[data-cv=contact]')=='' and pg.input_value('[data-cv=name]')=='Joao Silva')
    check('verificação: número (120) e nomes (Escola Y, UEM) assinalados ao utilizador','120' in allw and 'Escola Y' in allw and 'UEM' in allw,allw[:160])
    check('descarregar está desactivado até confirmar a revisão',pg.is_disabled('[data-act=cvdl][data-fmt=pdf]') and pg.is_disabled('[data-act=cvdl][data-fmt=docx]'))
    pg.fill('[data-cv=summary]','Resumo editado: coração, ação, é, ñ. Sem exageros.');pg.fill('[data-cv="experience.0.bullets"]','Ensinou inglês no ensino secundário.\nTradução técnica EN-PT.');pg.fill('[data-cv=headline]','Professor de inglês')
    pg.check('[data-cvok]');check('confirmar a revisão activa os botões (sem repintar o formulário)',not pg.is_disabled('[data-act=cvdl][data-fmt=pdf]') and pg.input_value('[data-cv=summary]').startswith('Resumo editado'))
    fn,path=download(pg,'[data-act=cvdl][data-fmt=pdf]');t=pdftext(path);r=PdfReader(str(path))
    check('CV em PDF: nome do ficheiro, secções, acentos, edições do utilizador',fn=='CV-Joao-Silva.pdf' and 'EXPERIÊNCIA PROFISSIONAL' in t and 'Resumo editado: coração, ação, é, ñ' in t and 'Joao Silva' in t and 'Escola Y' in t,fn)
    check('CV em PDF: o número removido pelo utilizador já não aparece; sem contacto inventado','120' not in t and '999' not in t and 'invent' not in t.lower())
    subprocess.run(['pdftoppm','-png','-r','60','-f','1','-l','1',str(path),'/tmp/cv-page'])
    pg.select_option('[data-cv=lang]','en');fn,path=download(pg,'[data-act=cvdl][data-fmt=docx]');dt=docxtext(path)
    check('CV em Word: idioma dos títulos EN, texto editado, bullets',fn=='CV-Joao-Silva.docx' and 'PROFESSIONAL EXPERIENCE' in dt and 'Resumo editado' in dt and 'Ensinou inglês no ensino secundário.' in dt,fn)
    fn,pdfpath=download(pg,'[data-act=cvdl][data-fmt=pdf]');check('CV em PDF com títulos em inglês',('PROFESSIONAL EXPERIENCE' in pdftext(pdfpath)) and 'Education'.upper() in pdftext(pdfpath))
    clean(pg,'kit, CV e descargas')
    for fn2,lab in [(pdfpath,'PDF gerado'),(path,'DOCX gerado')]:
        p2=ctx('10.1.6.3');p2.goto(BASE+'/');p2.click('[data-act=start]');p2.set_input_files('#f',str(fn2))
        try:until(p2,"document.querySelector('#cv').value.includes('Resumo editado')",20000);ok=True
        except Exception:ok=False
        check(f'ida e volta: a app lê o {lab} que ela própria criou',ok)
    # 6d) CV gerado sem código => servidor recusa (nem a interface o pede)
    s,j=post({'task':'cv','cv':CV,'vacancy':VAC},'10.1.6.4');check('API: CV adaptado sem código => 402',s==402 and j['code']=='PREMIUM_REQUIRED')
    # 6e) Demo: CV fictício, PDF marcado como DEMO; interface em inglês
    pg=ctx('10.1.6.5');pg.goto(BASE+'/?lang=en');pg.click('[data-act=demo]');pg.wait_for_selector('.score');pg.click('[data-act=kit]');pg.wait_for_selector('.cvform')
    check('demo EN: CV fictício e etiquetas em inglês','Fictional Candidate' in pg.input_value('[data-cv=name]') and pg.locator('text=Download PDF').count()==1 and pg.locator('[data-act=gencv]').count()==0)
    pg.check('[data-cvok]');fn,path=download(pg,'[data-act=cvdl][data-fmt=pdf]');dt=pdftext(path);check('PDF da demo marcado como DEMO',fn=='CV-Fictional-Candidate.pdf' and 'DEMO' in dt and 'Fictional Candidate' in dt,fn)
    # 6f) Sobre + domínio
    pg=ctx('10.1.6.6');pg.goto(BASE+'/');pg.wait_for_selector('#sobre');a=pg.locator('#sobre a[href^="https://snhamoneque"]')
    check('secção Sobre: ligação ao portfólio abre em novo separador, com noopener',a.count()==1 and a.get_attribute('href')=='https://snhamoneque.vercel.app' and a.get_attribute('target')=='_blank' and 'noopener' in a.get_attribute('rel'))
    pg.evaluate("document.querySelector('.hero').dataset.mark='1';scrollTo(0,0)");pg.click('.hero >> text=Como funciona');pg.wait_for_timeout(400)
    check('"Como funciona?" desce até à secção sem repintar a página',pg.evaluate("document.querySelector('.hero').dataset.mark")=='1' and pg.evaluate("document.querySelector('#como').getBoundingClientRect().top<innerHeight*0.6"))
    pg.evaluate('scrollTo(0,0)');pg.click('footer >> text=Sobre');pg.wait_for_timeout(300)
    check('ligação "Sobre" do rodapé leva à secção',pg.evaluate("(()=>{const r=document.querySelector('#sobre').getBoundingClientRect();return r.top>=-5&&r.top<innerHeight})()"))
    pg.click('[data-act=start]');pg.click('footer >> text=Sobre');pg.wait_for_selector('#sobre');check('"Sobre" funciona a partir de outro passo (volta à landing)',pg.locator('#sobre').count()==1)
    html=urllib.request.urlopen(BASE+'/').read().decode()
    check('metadados com o domínio applypro.vercel.app e sem o antigo',html.count('https://applypro.vercel.app')>=4 and 'aijobcopilot' not in html)
    for f in ['robots.txt','sitemap.xml']:
        x=urllib.request.urlopen(BASE+'/'+f).read().decode();check(f+' usa applypro.vercel.app',('applypro.vercel.app' in x) and 'aijobcopilot' not in x)
    # 7) páginas legais
    pg=ctx('10.1.4.1');pg.goto(BASE+'/?lang=en');pg.wait_for_selector('.hero');pg.click('footer >> text=Privacy');pg.wait_for_selector('.legal')
    vis=pg.evaluate("[...document.querySelectorAll('.legal h1')].filter(h=>h.offsetParent).map(h=>h.innerText)")
    check('ligação do rodapé EN abre a privacidade em inglês (PT escondido)',vis==['Privacy Policy'],str(vis))
    pg.click('[data-lang=pt]');check('páginas legais: botão PT',pg.evaluate("[...document.querySelectorAll('.legal h1')].filter(h=>h.offsetParent).map(h=>h.innerText)")==['Política de Privacidade'])
    pg.goto(BASE+'/terms.html');check('terms.html abre (PT guardado)',pg.title().startswith('Termos'));clean(pg,'legal')
    pg=ctx('10.1.4.2');pg.goto(BASE+'/');pg.wait_for_selector('.hero');href=pg.get_attribute('#sup','href');check('suporte WhatsApp tem ligação válida',href.startswith('https://wa.me/258'))
    # 8) mobile sem overflow
    for url in ['/','/?lang=en','/privacy.html','/terms.html']:
        pg=ctx('10.1.5.1',390,844);pg.goto(BASE+url);pg.wait_for_timeout(400);check(f'mobile 390px sem overflow horizontal {url}',not pg.evaluate("document.documentElement.scrollWidth>document.documentElement.clientWidth"))
    b.close()
srv.terminate();time.sleep(.3);log=LOG.read_text()
check('registos: etiqueta do cliente aparece, os códigos nunca',('"id":"maria"' in log) and not any(x in log for x in ['MARIA-CODE-1234','JOAO-CODE-5678','LEGACYCODE12345','stub-key-not-real']),'')
bad=[n for n,o in R if not o];print(f'\n{len(R)-len(bad)}/{len(R)} verificações passaram');sys.exit(1 if bad else 0)
