// Testes do frontend: carregam os scripts reais (js/*.js) num contexto vm com um DOM mínimo simulado.
// Não testam leitura real de PDF/DOCX (exige navegador + bibliotecas do CDN) — ver README/relatório.
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
  for (const f of ['state.js', 'demo.js', 'ui.js', 'cv-input.js', 'analysis.js']) vm.runInContext(src(f), ctx, { filename: f });
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
