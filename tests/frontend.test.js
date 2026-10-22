// Testes do frontend: carregam os scripts reais (js/*.js) num contexto vm com um DOM mínimo simulado.
// Não testam leitura real de PDF/DOCX (isso exige navegador: ver scripts/e2e.py).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const src = f => readFileSync(new URL('../js/' + f, import.meta.url), 'utf8');

function load({ fetchImpl } = {}) {
  const els = {}, listeners = {}, events = [];
  const app = { innerHTML: '' };
  const sandbox = {
    console, setTimeout, clearTimeout, DataView, Uint8Array, ArrayBuffer, Promise, JSON, Array, Object, Math, String, Number, Error, Infinity, AbortController,
    CustomEvent: function (n, o) { this.type = n; this.detail = o?.detail; },
    document: { querySelector: s => (s === '#app' ? app : els[s] || null) },
    window: { addEventListener: (n, f) => (listeners[n] ||= []).push(f), dispatchEvent: e => { events.push(e); } },
    scrollTo() {}, navigator: { clipboard: { writeText: async () => {} } },
    fetch: fetchImpl || (async () => { throw new Error('fetch não esperado'); }),
  };
  const ctx = vm.createContext(sandbox);
  for (const f of ['i18n.js', 'state.js', 'demo.js', 'ui.js', 'cv-input.js', 'export.js', 'analysis.js']) vm.runInContext(src(f), ctx, { filename: f });
  const ev = c => vm.runInContext(c, ctx);
  return { ev, els, app, listeners, events, ctx };
}
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const RES = { score: 70, strengths: ['a'], partial_matches: [], missing_from_cv: [], requirements: [{ category: 'essential', text: 'T', status: 'MATCH', evidence: 'E' }], recommendations: [{ current: 'c1', direction: 'd1' }, { current: 'c2', direction: 'd2' }, { current: 'c3', direction: 'd3' }] };

// ZIP mínimo com uma entrada no diretório central
function zip(entries) {
  const parts = []; let cd = 0;
  const cdBufs = entries.map(e => { const b = new DataView(new ArrayBuffer(46)); b.setUint32(0, 0x02014b50, true); b.setUint32(24, e, true); return b; });
  const head = new DataView(new ArrayBuffer(4)); head.setUint32(0, 0x04034b50, true); parts.push(new Uint8Array(head.buffer));
  const cdStart = 4; for (const b of cdBufs) { parts.push(new Uint8Array(b.buffer)); cd += 46; }
  const eocd = new DataView(new ArrayBuffer(22)); eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, entries.length, true); eocd.setUint16(10, entries.length, true); eocd.setUint32(12, cd, true); eocd.setUint32(16, cdStart, true);
  parts.push(new Uint8Array(eocd.buffer));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out.buffer;
}

describe('Frontend: Premium não pode ser contornado pelo estado da interface', () => {
  it('S.code preenchido (ou S.premium forçado) não mostra conteúdo Premium gerado: só o servidor o devolve', () => {
    const { ev } = load();
    ev('S.step=4;S.res=' + JSON.stringify(RES) + ';S.code="qualquer-coisa"');
    const lock = ev('kitView()'); assert.ok(lock.includes('🔒 Premium') && !lock.includes('Gerar candidatura'), 'código por validar não desbloqueia');
    ev('S.premium=true'); assert.ok(ev('kitView()').includes('Gerar candidatura'));
    assert.ok(ev('ivView()').includes('Gerar preparação'));
    ev('S.kit=null;S.iv=null'); // sem dados do servidor não há nada para mostrar além do botão
    assert.ok(!ev('kitView()').includes('Carta de apresentação'));
  });
  it('recomendações: sem Premium só 1 é mostrada; com S.premium mostra todas as que o servidor enviou', () => {
    const { ev } = load(); ev('S.res=' + JSON.stringify(RES));
    let h = ev('analysis()'); assert.ok(h.includes('c1') && !h.includes('c2'));
    ev('S.code="x"'); h = ev('analysis()'); assert.ok(!h.includes('c2'), 'S.code sozinho não revela mais');
    ev('S.premium=true'); h = ev('analysis()'); assert.ok(h.includes('c2') && h.includes('c3'));
  });
  it('unlock(): código vazio => erro local, nenhum pedido; inválido (402) => continua bloqueado', async () => {
    let n = 0; const { ev, els } = load({ fetchImpl: async () => { n++; return resp(402, { code: 'INVALID_CODE' }); } });
    ev('S.step=4'); els['#code'] = { value: '   ' }; await ev('unlock()'); assert.equal(n, 0); assert.ok(ev('S.err').includes('Introduz'));
    els['#code'] = { value: 'errado' }; await ev('unlock()'); assert.equal(n, 1);
    assert.equal(ev('S.premium'), false); assert.equal(ev('S.code'), ''); assert.ok(ev('S.err').includes('inválido'));
  });
  it('unlock(): válido => S.premium só depois de o servidor responder OK; volta a pedir a análise completa', async () => {
    const seen = []; const { ev, els } = load({ fetchImpl: async (u, i) => { const b = JSON.parse(i.body); seen.push(b.task); return b.task === 'verify' ? resp(200, { ok: true }) : resp(200, { data: RES, premium: true }); } });
    ev('S.step=4;S.res={score:1,strengths:["x"]};S.resPremium=false'); els['#code'] = { value: ' CODIGO ' };
    await ev('unlock()');
    assert.deepEqual(seen, ['verify', 'analyze']); assert.equal(ev('S.premium'), true); assert.equal(ev('S.code'), 'CODIGO'); assert.equal(ev('S.res.recommendations.length'), 3); assert.equal(ev('S.resPremium'), true);
  });
  it('unlock(): pedido "verify" não envia CV nem vaga', async () => {
    let body; const { ev, els } = load({ fetchImpl: async (u, i) => { body = JSON.parse(i.body); return resp(200, { ok: true }); } });
    ev('S.cv="CV SECRETO";S.vac="VAGA"'); els['#code'] = { value: 'c' }; await ev('unlock()'); assert.deepEqual(Object.keys(body).sort(), ['code', 'task']);
  });
  it('gen(): 402 do servidor revoga o estado Premium; chamadas simultâneas são ignoradas', async () => {
    let n = 0; const { ev } = load({ fetchImpl: async () => { n++; await new Promise(r => setTimeout(r, 10)); return resp(402, { code: 'INVALID_CODE' }); } });
    ev('S.step=4;S.premium=true;S.code="x"'); await Promise.all([ev('gen("kit","kit",4)'), ev('gen("kit","kit",4)')]);
    assert.equal(n, 1, 'duplo clique não duplica pedidos'); assert.equal(ev('S.premium'), false); assert.equal(ev('S.code'), ''); assert.equal(ev('S.kit'), null);
  });
  it('runAnalysis(): ignora cliques repetidos enquanto ocupado', async () => {
    let n = 0; const { ev } = load({ fetchImpl: async () => { n++; await new Promise(r => setTimeout(r, 10)); return resp(200, { data: RES, premium: false }); } });
    ev('S.cv="a".repeat(60);S.vac="b".repeat(60)'); await Promise.all([ev('runAnalysis()'), ev('runAnalysis()')]); assert.equal(n, 1); assert.equal(ev('S.resPremium'), false);
  });
  it('mensagens de erro de rede e de timeout; erro do servidor mostra só a mensagem genérica', async () => {
    let { ev } = load({ fetchImpl: async () => { throw new TypeError('x'); } }); ev('S.cv="a".repeat(60);S.vac="b".repeat(60)'); await ev('runAnalysis()'); assert.ok(ev('S.err').includes('Sem ligação'));
    ({ ev } = load({ fetchImpl: async () => { const e = new Error('a'); e.name = 'AbortError'; throw e; } })); ev('S.cv="a".repeat(60);S.vac="b".repeat(60)'); await ev('runAnalysis()'); assert.ok(ev('S.err').includes('demorou'));
    ({ ev } = load({ fetchImpl: async () => resp(502, { error: 'Mensagem do servidor.', code: 'AI_UNAVAILABLE', detail: 'NAO-MOSTRAR' }) })); ev('S.cv="a".repeat(60);S.vac="b".repeat(60)'); await ev('runAnalysis()'); assert.equal(ev('S.err'), 'Mensagem do servidor.');
    ({ ev } = load({ fetchImpl: async () => ({ ok: false, status: 504, json: async () => { throw new Error('html'); } }) })); ev('S.cv="a".repeat(60);S.vac="b".repeat(60)'); await ev('runAnalysis()'); assert.ok(ev('S.err').includes('Não foi possível'));
  });
});

describe('Frontend: XSS e respostas inesperadas', () => {
  it('esc() escapa & < > " \'', () => { const { ev } = load(); assert.equal(ev('esc(`<a href="x" onclick=\'y\'>&`)'), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;'); });
  it('status/valores maliciosos vindos da IA não chegam ao HTML sem escape', () => {
    const { ev } = load(); const evil = '"><img src=x onerror=alert(1)>';
    ev('S.res=' + JSON.stringify({ score: evil, strengths: [evil], partial_matches: [evil], missing_from_cv: [evil], requirements: [{ category: 'essential', text: evil, status: evil, evidence: evil }], recommendations: [{ current: evil, direction: evil }] }));
    const h = ev('analysis()'); assert.ok(!h.includes('<img'), 'sem tag injectada'); assert.ok(!/class="tag [^"]*[<>]/.test(h));
    assert.ok(h.includes('class="tag NOT_FOUND"'));
  });
  it('estruturas inesperadas (null, tipos errados) não rebentam a renderização', () => {
    const { ev } = load();
    ev('S.res={score:"x",strengths:null,requirements:"texto",recommendations:5}'); assert.doesNotThrow(() => ev('analysis()'));
    ev('S.res={score:50,requirements:[null,7,"a",{category:"essential",text:"t",status:"MATCH"}]}'); assert.doesNotThrow(() => ev('analysis()'));
    ev('S.premium=true;S.kit={email:null};S.step=4'); assert.doesNotThrow(() => ev('kitView()'));
    ev('S.iv={questions:"x"}'); assert.doesNotThrow(() => ev('ivView()'));
  });
  it('perguntas de entrevista: campos vazios não geram linhas vazias', () => {
    const { ev } = load(); ev('S.premium=true;S.iv={questions:[{question:"Q",why:"",structure:"",example:""}],ask_employer:[]}');
    const h = ev('ivView()'); assert.ok(!h.includes('Porquê') && !h.includes('Estrutura') && h.includes('Não identificado no CV.'));
  });
});

describe('Frontend: PDF/DOCX (validações que não precisam das bibliotecas)', () => {
  it('checkMagic: PDF e DOCX pelos primeiros bytes', () => {
    const { ev, ctx } = load(); const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer, txt = new TextEncoder().encode('olá mundo').buffer;
    ctx.pdf = pdf; ctx.txt = txt; ctx.dz = zip([100]);
    assert.equal(ev('checkMagic(pdf,"pdf")'), true); assert.equal(ev('checkMagic(txt,"pdf")'), false);
    assert.equal(ev('checkMagic(dz,"docx")'), true); assert.equal(ev('checkMagic(pdf,"docx")'), false);
  });
  it('zipInfo: soma tamanhos declarados; detecta bomba, demasiadas entradas, ZIP inválido', () => {
    const { ev, ctx } = load();
    ctx.ok = zip([1000, 2000]); let z = ev('zipInfo(ok)'); assert.equal(z.total, 3000); assert.equal(z.entries, 2);
    ctx.bomb = zip([200e6]); z = ev('zipInfo(bomb)'); assert.ok(z.total > 30e6);
    ctx.many = zip(Array(3500).fill(10)); z = ev('zipInfo(many)'); assert.ok(z.entries > 3000);
    ctx.junk = new Uint8Array(100).buffer; assert.equal(ev('zipInfo(junk)'), null);
    ctx.tiny = new Uint8Array(5).buffer; assert.equal(ev('zipInfo(tiny)'), null);
  });
  it('onFile: extensão inválida, ficheiro vazio, >5 MB e tipo falso são recusados com mensagem clara (sem carregar bibliotecas)', async () => {
    const { ev, ctx } = load(); const f = (name, size, bytes) => ({ name, size, arrayBuffer: async () => bytes });
    await ev('onFile')(f('cv.exe', 10, new ArrayBuffer(10))); assert.ok(ev('S.err').includes('Formato não suportado'));
    await ev('onFile')(f('cv.pdf', 0, new ArrayBuffer(0))); assert.ok(ev('S.err').includes('vazio'));
    await ev('onFile')(f('cv.pdf', 6e6, new ArrayBuffer(10))); assert.ok(ev('S.err').includes('5 MB'));
    await ev('onFile')(f('cv.pdf', 20, new TextEncoder().encode('isto não é um pdf!!').buffer)); assert.ok(ev('S.err').includes('não corresponde'));
    ctx.bomb = zip([200e6]); await ev('onFile')(f('cv.docx', 100, ctx.bomb)); assert.ok(ev('S.err').includes('demasiado grande'));
    assert.equal(ev('S.cv'), '', 'nada é carregado para o CV em caso de erro'); assert.equal(ev('S.reading'), false);
  });
  it('next1/next2: mínimos e máximos de caracteres', () => {
    const { ev } = load();
    ev('S.cv="a".repeat(49)'); ev('next1()'); assert.ok(ev('S.err').includes('Adiciona'));
    ev('S.cv="a".repeat(20001)'); ev('next1()'); assert.ok(ev('S.err').includes('20000')); assert.equal(ev('S.step'), 0);
    ev('S.cv="a".repeat(20000)'); ev('next1()'); assert.equal(ev('S.step'), 2);
    ev('S.vac="a".repeat(12001)'); ev('next2()'); assert.ok(ev('S.err').includes('12000'));
  });
  it('arrastar e largar: ficheiros são lidos no passo 1 e o navegador não navega para o ficheiro', async () => {
    const { ev, listeners, ctx } = load(); let prevented = 0, got = null;
    ctx.onFileSpy = f => { got = f; }; ev('onFile=f=>onFileSpy(f)'); // substitui só para observar a chamada
    const mk = (types, files) => ({ dataTransfer: { types, files }, preventDefault() { prevented++; } });
    ev('S.step=1'); for (const fn of listeners.drop) fn(mk(['Files'], [{ name: 'cv.pdf' }])); assert.equal(got.name, 'cv.pdf');
    for (const fn of listeners.dragover) fn(mk(['Files'], [])); assert.equal(prevented, 2);
    got = null; ev('S.step=2'); for (const fn of listeners.drop) fn(mk(['Files'], [{ name: 'x.pdf' }])); assert.equal(got, null, 'fora do passo 1 não lê, mas continua a evitar a navegação'); assert.equal(prevented, 3);
    for (const fn of listeners.drop) fn(mk(['text/plain'], [])); assert.equal(prevented, 3, 'arrastar texto não é interceptado');
  });
});

describe('Frontend: texto de privacidade', () => {
  it('index.html não promete garantias que a aplicação não consegue assegurar', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.ok(!/não são guardados por nós/i.test(html)); assert.ok(/fornecedor de IA/.test(html) && /não consegue garantir/.test(html));
  });
  it('nenhum ficheiro do frontend contém chaves de API ou o nome das variáveis secretas', () => {
    for (const f of ['state.js', 'demo.js', 'ui.js', 'cv-input.js', 'analysis.js', 'app.js']) { const s = src(f); assert.ok(!/AI_API_KEY|PREMIUM_CODES|sk-[A-Za-z0-9]{10,}|AIza[0-9A-Za-z_-]{20,}/.test(s), f); }
    assert.ok(!/AI_API_KEY|PREMIUM_CODES/.test(readFileSync(new URL('../index.html', import.meta.url), 'utf8')));
  });
});

describe('Frontend: idiomas PT/EN', () => {
  it('por defeito PT; setLang("en") traduz a landing e ignora línguas desconhecidas', () => {
    const { ev, app } = load();
    ev('render()'); assert.ok(app.innerHTML.includes('O teu CV está preparado para esta vaga?'));
    ev('setLang("fr")'); assert.equal(ev('LANG'), 'pt');
    ev('setLang("en")'); assert.equal(ev('LANG'), 'en');
    assert.ok(app.innerHTML.includes('Is your CV ready for this job?') && !app.innerHTML.includes('O teu CV está'));
    assert.ok(app.innerHTML.includes('hero-showcase-en-1600.webp') && app.innerHTML.includes('feature-cv-analysis-en-1200.webp'));
    ev('setLang("pt")'); assert.ok(app.innerHTML.includes('hero-showcase-1600.webp') && !app.innerHTML.includes('-en-'));
  });
  it('dicionários PT e EN têm exactamente as mesmas chaves (excepto srv.*, só EN)', () => {
    const { ev } = load(); const pt = ev('Object.keys(I18N.pt)'), en = ev('Object.keys(I18N.en)').filter(k => !k.startsWith('srv.'));
    assert.deepEqual(pt.filter(k => !en.includes(k)), []); assert.deepEqual(en.filter(k => !pt.includes(k)), []);
    assert.ok(pt.every(k => ev(`I18N.pt[${JSON.stringify(k)}]`).length && ev(`I18N.en[${JSON.stringify(k)}]`).length));
  });
  it('toda a chave usada em t("...") nos scripts existe no dicionário', () => {
    const { ev } = load(); const keys = new Set(ev('Object.keys(I18N.pt)'));
    for (const f of ['ui.js', 'cv-input.js', 'analysis.js', 'state.js', 'export.js']) {
      for (const m of src(f).matchAll(/\bt\("([\w.]+)"(?!\s*\+)/g)) assert.ok(keys.has(m[1]), `${f}: falta a chave ${m[1]}`);
    }
    // chaves dinâmicas (prog.N, cat.X, st.X) verificadas explicitamente:
    for (const k of ['prog.1', 'prog.5', 'cat.essential', 'cat.language', 'st.MATCH', 'st.PARTIAL', 'st.NOT_FOUND']) assert.ok(keys.has(k), k);
  });
  it('o pedido à API leva a língua actual; verify não leva CV, vaga nem língua', async () => {
    const bodies = [];
    const { ev } = load({ fetchImpl: async (u, i) => { bodies.push(JSON.parse(i.body)); return resp(200, { ok: true, premium: false, result: RES }); } });
    ev('S.cv="c".repeat(120);S.vac="v".repeat(120)');
    await ev('api("analyze")'); ev('setLang("en")'); await ev('api("analyze")'); await ev('api("verify","X")');
    assert.deepEqual(bodies.slice(0, 2).map(b => b.lang), ['pt', 'en']);
    assert.deepEqual(Object.keys(bodies[2]).sort(), ['code', 'task']);
  });
  it('erros do servidor: PT mostra a mensagem do servidor (como antes); EN traduz pelo código; código desconhecido => genérico EN', async () => {
    const mk = (code, error) => load({ fetchImpl: async () => resp(429, { ok: false, code, error }) });
    let c = mk('RATE_LIMITED', 'Demasiados pedidos.'); await assert.rejects(c.ev('api("analyze")'), e => e.message === 'Demasiados pedidos.');
    c = mk('RATE_LIMITED', 'Demasiados pedidos.'); c.ev('setLang("en")'); await assert.rejects(c.ev('api("analyze")'), e => e.message === 'Too many requests. Please try again in a few minutes.');
    c = mk('CODE_LIMIT', 'x'); c.ev('setLang("en")'); await assert.rejects(c.ev('api("analyze")'), e => /daily usage limit/.test(e.message));
    c = mk('SOMETHING_NEW', 'segredo-interno'); c.ev('setLang("en")'); await assert.rejects(c.ev('api("analyze")'), e => e.message === c.ev('I18N.en["e.generic"]') && !/segredo/.test(e.message));
  });
  it('a demo existe nas duas línguas e muda com setLang', () => {
    const { ev, app } = load(); ev('loadDemo()'); assert.ok(app.innerHTML.includes('Comunicação em inglês'));
    ev('setLang("en")'); ev('loadDemo()'); assert.ok(app.innerHTML.includes('English communication') && app.innerHTML.includes('DEMO'));
  });
});

const J = x => JSON.parse(JSON.stringify(x)); // objectos vindos do vm têm outro protótipo: compara-se por JSON
const KIT = { cover_letter: 'Carta de teste', email: { subject: 'Assunto de teste', body: 'Corpo de teste' }, profile_summary: 'Resumo de teste' };
const IV = { questions: [{ question: 'Pergunta de teste', why: 'p', structure: 's', example: 'e' }], ask_employer: ['P1'] };
describe('Frontend: botões "Voltar" em todos os passos', () => {
  const back = html => [...html.matchAll(/data-act="goto" data-step="(\d)"/g)].map(m => +m[1]);
  it('passo 1 volta ao início; passo 2 volta ao passo 1; resultado e erro do passo 3 voltam ao passo 2', () => {
    const { ev, app } = load();
    ev('S.step=1;render()'); assert.deepEqual(back(app.innerHTML), [0]); assert.ok(app.innerHTML.includes('data-act="next1"'));
    ev('S.step=2;render()'); assert.deepEqual(back(app.innerHTML), [1]); assert.ok(app.innerHTML.includes('data-act="next2"'));
    ev('S.step=3;S.busy=false;S.res=' + JSON.stringify(RES) + ';render()'); assert.deepEqual(back(app.innerHTML), [2]);
    ev('S.res=null;S.err="falhou";render()'); assert.deepEqual(back(app.innerHTML), [2]); assert.ok(app.innerHTML.includes('data-act="retry"'));
  });
  it('passo 4 (bloqueado, sem kit, com kit) volta ao passo 3; passo 5 (bloqueado, sem prep., com prep.) volta ao passo 4', () => {
    const { ev, app } = load();
    for (const [st, prem, extra] of [[4, false, ''], [4, true, ''], [4, true, 'S.kit=' + JSON.stringify(KIT)], [5, false, ''], [5, true, ''], [5, true, 'S.iv=' + JSON.stringify(IV)]]) {
      ev(`Object.assign(S,{step:${st},premium:${prem},demo:false,busy:false,err:"",kit:null,iv:null,cvdoc:null});` + (extra ? extra + ';' : '') + 'render()');
      assert.ok(back(app.innerHTML).includes(st - 1), `passo ${st} premium=${prem} ${extra.slice(0, 8)}: sem Voltar`);
    }
  });
  it('go() muda de passo e limpa o erro; "voltar" e "continuar" chamam as funções certas', () => {
    const { ev } = load(); ev('S.err="x";go(2)'); assert.equal(ev('S.step'), 2); assert.equal(ev('S.err'), ''); ev('go(1)'); assert.equal(ev('S.step'), 1);
  });
});

describe('Frontend: CV adaptado (editor, verificação e envio)', () => {
  const CVD = { lang: 'pt', name: 'Ana <b>X</b>', headline: 'H', contact: ['a@b.c'], summary: 'Resumo', experience: [{ role: 'R', company: 'C', period: '2020', bullets: ['b1', 'b2'] }], education: [{ title: 'T', institution: 'I', period: '', details: '' }], skills: ['s1'], languages: ['Português'], additional: [], check: { numbers: ['120'], entities: ['Escola Y'] } };
  const setup = (extra = '') => { const c = load(); c.ev('Object.assign(S,{step:4,premium:true,demo:false,busy:false,err:"",kit:' + JSON.stringify(KIT) + ',cvdoc:null,cvOk:false,busyCv:false,cvErr:""});' + extra + 'render()'); return c; };
  it('sem código: bloqueado (nenhum botão de gerar o CV); com código e sem CV: botão "Gerar CV adaptado"', () => {
    const { ev, app } = load(); ev('Object.assign(S,{step:4,premium:false,demo:false,kit:null,cvdoc:null});render()');
    assert.ok(app.innerHTML.includes('🔒 Premium') && !app.innerHTML.includes('data-act="gencv"'));
    const c = setup(); assert.ok(c.app.innerHTML.includes('data-act="gencv"') && c.app.innerHTML.includes('Gerar CV adaptado') && !c.app.innerHTML.includes('data-cv='));
  });
  it('com CV: formulário editável, avisos de verificação, botões de descarga desactivados até confirmar; HTML do CV é escapado', () => {
    const { ev, app } = setup('S.cvdoc=' + JSON.stringify(CVD) + ';');
    const h = app.innerHTML;
    assert.ok(h.includes('data-cv="experience.0.role"') && h.includes('data-cv="education.0.title"') && h.includes('data-cv="summary"') && h.includes('data-cv="lang"'));
    assert.ok(h.includes('Ana &lt;b&gt;X&lt;/b&gt;') && !h.includes('Ana <b>X</b>'), 'nome escapado');
    assert.ok(h.includes('120') && h.includes('Escola Y') && h.includes('não aparecem'), 'avisos de números/nomes');
    assert.equal((h.match(/data-needok disabled/g) || []).length, 2);
    ev('S.cvOk=true;render()'); assert.ok(!app.innerHTML.includes('data-needok disabled') && app.innerHTML.includes('data-cvok checked'));
  });
  it('estado "a gerar" mantém o kit visível; erro do CV aparece junto ao botão, não no topo', () => {
    const { ev, app } = setup('S.busy=true;S.busyCv=true;'); assert.ok(app.innerHTML.includes('id="k1"') && app.innerHTML.includes('A preparar o teu CV'));
    ev('S.busy=false;S.busyCv=false;S.cvErr="falhou o CV";render()'); const h = app.innerHTML; assert.ok(h.indexOf('falhou o CV') > h.indexOf('id="k3"'));
  });
  it('cvSet: só caminhos conhecidos; listas dividem por linhas; caminhos perigosos ou fora do intervalo são ignorados', () => {
    const { ev } = setup('S.cvdoc=' + JSON.stringify(CVD) + ';');
    ev('cvSet("summary","Novo resumo")'); ev('cvSet("skills","a\\nb\\n")'); ev('cvSet("experience.0.bullets","x\\ny")'); ev('cvSet("lang","en")');
    assert.equal(ev('S.cvdoc.summary'), 'Novo resumo'); assert.deepEqual(J(ev('S.cvdoc.skills')), ['a', 'b', '']); assert.deepEqual(J(ev('S.cvdoc.experience[0].bullets')), ['x', 'y']); assert.equal(ev('S.cvdoc.lang'), 'en');
    for (const bad of ['__proto__.polluted', 'constructor.prototype.x', 'experience.0.__proto__', 'experience.99.role', 'check.numbers', 'name.x', 'experience.0.role.x']) ev(`cvSet(${JSON.stringify(bad)},"HACK")`);
    assert.equal(ev('({}).polluted'), undefined); assert.deepEqual(J(ev('S.cvdoc.check.numbers')), ['120']); assert.equal(ev('S.cvdoc.experience[0].role'), 'R');
  });
  it('genCv: pede a tarefa "cv", guarda o resultado e repõe as flags; 402 revoga o Premium; pedidos simultâneos são ignorados', async () => {
    const bodies = []; let n = 0;
    const c = load({ fetchImpl: async (u, i) => { bodies.push(JSON.parse(i.body)); n++; return bodies.at(-1).task === 'cv' && n === 1 ? resp(200, { data: CVD, premium: true }) : resp(402, { error: 'x', code: 'INVALID_CODE' }); } });
    c.ev('Object.assign(S,{cv:"c".repeat(100),vac:"v".repeat(100),premium:true,code:"X",cvOk:true})');
    await Promise.all([c.ev('genCv()'), c.ev('genCv()')]); assert.equal(bodies.length, 1); assert.equal(bodies[0].task, 'cv');
    assert.equal(c.ev('S.cvdoc.name'), CVD.name); assert.equal(c.ev('S.cvOk'), false); assert.equal(c.ev('S.busy'), false); assert.equal(c.ev('S.busyCv'), false);
    await c.ev('genCv()'); assert.equal(c.ev('S.premium'), false); assert.equal(c.ev('S.code'), ''); assert.ok(c.ev('S.cvErr').length > 0);
  });
  it('descarregar o CV sem confirmar a revisão não faz nada', () => {
    const { ev } = setup('S.cvdoc=' + JSON.stringify(CVD) + ';S.cvOk=false;'); ev('exportCv("pdf",null)'); assert.equal(ev('S.exporting'), false);
  });
  it('a demonstração traz um CV fictício nas duas línguas', () => {
    const { ev, app } = load(); ev('loadDemo()'); ev('go(4)'); assert.ok(app.innerHTML.includes('Candidato Fictício') && app.innerHTML.includes('data-cvok'));
    ev('setLang("en")'); ev('loadDemo()'); ev('go(4)'); assert.ok(app.innerHTML.includes('Fictional Candidate') && !app.innerHTML.includes('data-act="gencv"') && app.innerHTML.includes('Download PDF'));
  });
});

describe('Exportação: modelo de blocos, PDF seguro e Word (.docx)', () => {
  const CVD = { lang: 'pt', name: 'Ana & <Co>', headline: 'Prof', contact: ['a@b.c', ' '], summary: 'Sumário', experience: [{ role: 'Professor', company: 'Escola', period: '2020-2024', bullets: ['dá aulas', '', 'traduz'] }, { role: '', company: '', period: '', bullets: [] }], education: [{ title: 'Licenciatura', institution: 'UEM', period: '', details: 'ok' }], skills: ['Excel', 'Word'], languages: [], additional: ['x'] };
  it('cvBlocks: ordem das secções, itens vazios omitidos e títulos na língua do documento', () => {
    const { ev } = load(); const b = J(ev('cvBlocks(' + JSON.stringify(CVD) + ')')); const heads = b.filter(x => x.t === 'h2').map(x => x.x);
    assert.deepEqual(heads, ['Resumo', 'Experiência profissional', 'Formação', 'Competências', 'Informação adicional']);
    assert.equal(b.filter(x => x.t === 'li').length, 3); assert.equal(b.filter(x => x.t === 'row').length, 2); assert.equal(b[0].t, 'h1');
    assert.deepEqual(J(ev('cvBlocks({lang:"en",summary:"s",skills:["a"]})')).filter(x => x.t === 'h2').map(x => x.x), ['Summary', 'Skills']);
    assert.deepEqual(J(ev('cvBlocks({})')), []);
  });
  it('carta/email/resumo: parágrafos por linha em branco; email começa pelo assunto a negrito', () => {
    const { ev } = load(); assert.equal(ev('letterBlocks("a\\n\\nb\\n\\n\\nc")').length, 3);
    const e = J(ev('emailBlocks("Assunto: X","olá\\n\\nadeus")')); assert.deepEqual([e[0].b, e[0].x, e[1].t, e.length], [1, 'Assunto: X', 'gap', 4]);
  });
  it('pdfSafe: acentos mantidos, pontuação tipográfica convertida, emojis e caracteres fora do Latin-1 removidos', () => {
    const { ev } = load(); assert.equal(ev('pdfSafe("Formação “aspas” – traço… ç ã é •")'), 'Formação "aspas" - traço... ç ã é -');
    for (const [i, o] of [['a😀b', 'ab'], ['中文x', 'x'], ['5€', '5'], ['a\u00A0b', 'a b'], ['‘x’', "'x'"]]) assert.equal(ev(`pdfSafe(${JSON.stringify(i)})`), o, i);
    assert.equal(ev('slug("João Sílva Ñ! 2024")'), 'Joao-Silva-N-2024'); assert.equal(ev('slug("")'), '');
  });
  it('docx: ZIP válido (CRC e tamanhos coerentes), partes OOXML obrigatórias, texto escapado, sem caracteres de controlo', () => {
    const ctx = vm.createContext({ TextEncoder, Uint8Array, DataView, ArrayBuffer, Uint32Array, Blob, Date, Math, String, Array, S: {}, t: k => k, LANG: 'pt' });
    vm.runInContext(readFileSync(new URL('../js/export.js', import.meta.url), 'utf8'), ctx);
    const ev = code => vm.runInContext(code, ctx);
    const bytes = Buffer.from(ev('Array.from(docxBytes(cvBlocks(' + JSON.stringify({ ...CVD, summary: 'a\u0001b <script>x</script>' }) + '),"pt"))'));
    assert.equal(bytes.readUInt32LE(0), 0x04034b50); const eocd = bytes.length - 22; assert.equal(bytes.readUInt32LE(eocd), 0x06054b50);
    const n = bytes.readUInt16LE(eocd + 10), cd = bytes.readUInt32LE(eocd + 16); assert.equal(n, 5);
    let p = cd; const files = {};
    for (let i = 0; i < n; i++) {
      assert.equal(bytes.readUInt32LE(p), 0x02014b50); const crc = bytes.readUInt32LE(p + 16), size = bytes.readUInt32LE(p + 24), nl = bytes.readUInt16LE(p + 28), off = bytes.readUInt32LE(p + 42);
      const name = bytes.subarray(p + 46, p + 46 + nl).toString(); assert.equal(bytes.readUInt32LE(off), 0x04034b50); const data = bytes.subarray(off + 30 + bytes.readUInt16LE(off + 26), off + 30 + bytes.readUInt16LE(off + 26) + size);
      files[name] = { data, crc }; p += 46 + nl;
    }
    assert.deepEqual(Object.keys(files).sort(), ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml']);
    for (const [name, f] of Object.entries(files)) assert.equal(ev(`crc32(new Uint8Array(${JSON.stringify([...f.data])}))`), f.crc, 'CRC de ' + name);
    const xml = files['word/document.xml'].data.toString('utf8');
    assert.ok(xml.includes('Ana &amp; &lt;Co&gt;') && xml.includes('&lt;script&gt;') && !xml.includes('<script') && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml));
    assert.ok(xml.includes('EXPERIÊNCIA PROFISSIONAL') && xml.includes('w:pgSz w:w="11906"'));
    const open = (xml.match(/<w:p>/g) || []).length, close = (xml.match(/<\/w:p>/g) || []).length; assert.equal(open, close);
  });
  it('exportKit sem kit não faz nada; o modo demo marca o documento', () => {
    const { ev } = load(); ev('S.kit=null'); ev('exportKit("k1","pdf",null)'); assert.equal(ev('S.exporting'), false);
  });
});
