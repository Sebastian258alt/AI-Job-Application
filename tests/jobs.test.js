// Testes do módulo de vagas (/api/jobs). Tudo simulado: nenhum teste chama a Remotive nem o Redis reais.
// Estes testes NÃO provam que a integração real funciona; isso exige um teste ao vivo com a rede.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import handler, { RATE } from '../api/jobs.js';
import { normalize } from '../services/jobs/providers/remotive.js';
import { validateQuery, dedupe, sortJobs, runSearch } from '../services/jobs/search.js';
import { safeUrl, excerpt, hasSkill } from '../services/jobs/model.js';
import { assess, isExpired } from '../services/jobs/quality.js';
import { cached } from '../services/jobs/cache.js';
import { _resetMemoryForTests } from '../services/ratelimit.js';
import { _resetCacheForTests } from '../services/jobs/cache.js';

const recent = d => new Date(Date.now() - d * 864e5).toISOString();
const RAW = [
  { id: 1, url: 'https://remotive.com/remote-jobs/software-dev/python-dev-1', title: 'Senior Python Developer', company_name: 'Acme Lda', category: 'Software Development', tags: ['python', 'django'], job_type: 'full_time', publication_date: recent(2), candidate_required_location: 'Worldwide', salary: '$80k - $100k', description: '<p>Build <b>APIs</b> in Python. '.padEnd(200, 'x') },
  { id: 2, url: 'https://remotive.com/remote-jobs/marketing/seo-2', title: 'SEO Manager', company_name: 'Beta Inc', category: 'Marketing', tags: ['seo'], job_type: 'contract', publication_date: recent(40), candidate_required_location: 'USA Only', description: 'SEO' },
  { id: 3, url: 'https://remotive.com/remote-jobs/software-dev/js-3', title: 'JavaScript Engineer', company_name: 'Gamma', category: 'Software Development', tags: ['javascript'], job_type: 'part_time', publication_date: recent(1), candidate_required_location: 'Mozambique, South Africa', description: 'JS' },
  { id: 4, url: 'javascript:alert(1)', title: 'Evil', company_name: 'X', description: 'x' },
  { id: 5, url: 'http://remotive.com/insecure', title: 'Insecure', company_name: 'X' },
  { id: 6, url: 'https://evil.example.com/phish', title: 'Phish', company_name: 'X' },
  { id: 7, url: 'https://remotive.com/remote-jobs/x/nodate-7', title: 'No Date Job', company_name: '', description: 'd' },
];
let realFetch, fetchCalls, fetchImpl, ipN = 0;
const feed = () => ({ ok: true, status: 200, text: async () => JSON.stringify({ 'job-count': RAW.length, jobs: RAW }) });
const newIp = () => '10.9.' + (++ipN >> 8) + '.' + (ipN & 255);
const mockRes = () => ({ statusCode: 200, body: undefined, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
async function call(query = {}, { method = 'GET', ip } = {}) { const res = mockRes(); await handler({ method, headers: { 'x-real-ip': ip || newIp() }, query }, res); return res; }

beforeEach(() => { _resetMemoryForTests(); _resetCacheForTests(); fetchCalls = 0; fetchImpl = async () => feed(); realFetch = globalThis.fetch; globalThis.fetch = async (...a) => { fetchCalls++; return fetchImpl(...a); }; delete process.env.JOBS_PROVIDERS; delete process.env.UPSTASH_REDIS_REST_URL; });
afterEach(() => { globalThis.fetch = realFetch; });

describe('validateQuery', () => {
  it('aceita defeitos e normaliza', () => { const v = validateQuery({ q: '  python \n dev ', country: 'mz' }); assert.equal(v.ok, true); assert.equal(v.value.q, 'python dev'); assert.equal(v.value.country, 'MZ'); assert.equal(v.value.limit, 10); assert.equal(v.value.page, 1); });
  for (const [name, q] of [['país', { country: 'MOZ' }], ['país não-string', { country: { a: 1 } }], ['workplace', { workplace: 'moon' }], ['contrato', { employmentType: 'x' }], ['categoria', { category: '../etc' }], ['página 0', { page: '0' }], ['página 999', { page: '999' }], ['limite 1000', { limit: '1000' }], ['limite decimal', { limit: '2.5' }], ['dias', { postedWithinDays: '400' }], ['q longa', { q: 'a'.repeat(101) }], ['q objecto', { q: { $ne: 1 } }]])
    it('rejeita ' + name, () => { const v = validateQuery(q); assert.equal(v.ok, false); assert.equal(v.status, 400); });
  it('usa o primeiro valor de parâmetros repetidos', () => assert.equal(validateQuery({ q: ['a', 'b'] }).value.q, 'a'));
});

describe('normalização e segurança de URLs', () => {
  it('safeUrl só aceita https do domínio permitido', () => {
    assert.ok(safeUrl('https://remotive.com/a', ['remotive.com']));
    for (const u of ['javascript:alert(1)', 'http://remotive.com/a', 'https://evil.com/a', 'https://remotive.com.evil.com/a', 'https://u:p@remotive.com/a', 'data:text/html,x', '']) assert.equal(safeUrl(u, ['remotive.com']), null, u);
  });
  it('descarta vagas com URL insegura ou sem id/título', () => { for (const i of [3, 4, 5]) assert.equal(normalize(RAW[i], 'T'), null); assert.equal(normalize({ id: 9, url: 'https://remotive.com/a' }, 'T'), null); });
  it('campos em falta ficam null, nada é inventado', () => {
    const j = normalize(RAW[6], '2026-01-01T00:00:00Z');
    assert.equal(j.company, null); assert.equal(j.postedAt, null); assert.equal(j.salaryMin, null); assert.equal(j.expiresAt, null); assert.equal(j.lastVerifiedAt, null); assert.equal(j.country, null);
    assert.deepEqual(j.requiredSkills, []); assert.ok(j.qualityFlags.includes('no_company') && j.qualityFlags.includes('no_posted_date'));
  });
  it('vaga normal: atribuição, estado só "source_retrieved", sem HTML na descrição', () => {
    const j = normalize(RAW[0], '2026-01-01T00:00:00Z');
    assert.equal(j.id, 'remotive:1'); assert.equal(j.verificationStatus, 'source_retrieved'); assert.equal(j.sourceAttribution.name, 'Remotive'); assert.equal(j.workplaceType, 'remote');
    assert.ok(!/[<>]/.test(j.description)); assert.ok(j.description.length <= 401); assert.equal(j.salaryText, '$80k - $100k'); assert.equal(j.salaryMin, null);
  });
  it('excerpt remove scripts', () => assert.equal(excerpt('<script>alert(1)</script><p>ok</p>'), 'ok'));
});

describe('/api/jobs', () => {
  it('só GET e POST', async () => { const r = await call({}, { method: 'PUT' }); assert.equal(r.statusCode, 405); assert.equal(r.headers.allow, 'GET, POST'); });
  it('pesquisa com sucesso; só devolve vagas com URL segura; ordena por data', async () => {
    const r = await call({ q: '' }); assert.equal(r.statusCode, 200);
    assert.deepEqual(r.body.jobs.map(j => j.id), ['remotive:3', 'remotive:1', 'remotive:2', 'remotive:7']);
    assert.ok(r.body.jobs.every(j => j.originalUrl.startsWith('https://remotive.com/')));
    assert.deepEqual(r.body.attributions, [{ id: 'remotive', name: 'Remotive' }]); assert.equal(r.body.providers[0].status, 'ok');
  });
  it('filtra por palavra-chave, contrato e data', async () => {
    assert.deepEqual((await call({ q: 'python' })).body.jobs.map(j => j.id), ['remotive:1']);
    assert.deepEqual((await call({ employmentType: 'contract' })).body.jobs.map(j => j.id), ['remotive:2']);
    assert.deepEqual((await call({ postedWithinDays: '7' })).body.jobs.map(j => j.id), ['remotive:3', 'remotive:1']);
  });
  it('país: inclui "Worldwide", vagas sem restrição indicada e vagas que nomeiam o país; exclui as restritas a outros', async () => {
    assert.deepEqual((await call({ country: 'MZ' })).body.jobs.map(j => j.id), ['remotive:3', 'remotive:1', 'remotive:7']); // 7: sem localização indicada = sem restrição indicada
  });
  it('resultado vazio é 200 com lista vazia (não inventa vagas)', async () => { const r = await call({ q: 'astronaut' }); assert.equal(r.statusCode, 200); assert.equal(r.body.total, 0); assert.deepEqual(r.body.jobs, []); });
  it('paginação controlada e estável', async () => {
    const a = await call({ limit: '2', page: '1' }), b = await call({ limit: '2', page: '2' });
    assert.equal(a.body.total, 4); assert.equal(a.body.jobs.length, 2); assert.equal(b.body.jobs.length, 2); assert.deepEqual([...a.body.jobs, ...b.body.jobs].map(j => j.id), ['remotive:3', 'remotive:1', 'remotive:2', 'remotive:7']);
  });
  it('filtro não suportado (presencial) => fonte "skipped", sem chamar o fornecedor', async () => {
    const r = await call({ workplace: 'onsite' }); assert.equal(r.statusCode, 200); assert.equal(r.body.code, 'FILTER_UNSUPPORTED'); assert.equal(fetchCalls, 0);
  });
  it('parâmetros inválidos => 400', async () => assert.equal((await call({ page: 'abc' })).statusCode, 400));
  it('limite de pedidos por IP => 429 com Retry-After', async () => {
    const ip = newIp(); for (let i = 0; i < RATE.max; i++) assert.equal((await call({}, { ip })).statusCode, 200);
    const r = await call({}, { ip }); assert.equal(r.statusCode, 429); assert.ok(Number(r.headers['retry-after']) > 0);
  });
  it('fornecedor desconhecido em JOBS_PROVIDERS => não configurado', async () => { process.env.JOBS_PROVIDERS = 'nope'; assert.equal((await call({})).body.code, 'JOBS_NOT_CONFIGURED'); });
});

describe('cache e falhas do fornecedor', () => {
  it('só um pedido à Remotive para várias pesquisas (quota de 4/dia)', async () => { await call({ q: 'a' }); await call({ q: 'b' }); await call({}); assert.equal(fetchCalls, 1); });
  it('pesquisas simultâneas partilham o mesmo pedido', async () => { await Promise.all([call({}), call({ q: 'x' }), call({ q: 'y' })]); assert.equal(fetchCalls, 1); });
  for (const [name, impl, kind] of [
    ['HTTP 500', async () => ({ ok: false, status: 500, text: async () => '' }), 'UPSTREAM'],
    ['HTTP 429', async () => ({ ok: false, status: 429, headers: new Headers({ 'retry-after': '120' }), text: async () => '' }), 'RATE_LIMITED'],
    ['JSON inválido', async () => ({ ok: true, status: 200, text: async () => '<html>' }), 'BAD_RESPONSE'],
    ['formato inesperado', async () => ({ ok: true, status: 200, text: async () => '{"jobs":"x"}' }), 'BAD_RESPONSE'],
    ['timeout', async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; }, 'TIMEOUT'],
    ['rede', async () => { throw new TypeError('fetch failed'); }, 'NETWORK'],
  ]) it('falha (' + name + ') => 503 sem vagas inventadas e sem detalhes internos', async () => {
    fetchImpl = impl; const r = await call({});
    assert.equal(r.statusCode, 503); assert.equal(r.body.code, 'JOBS_UNAVAILABLE'); assert.deepEqual(r.body.jobs, []); assert.equal(r.body.providers[0].error, kind);
    assert.ok(!JSON.stringify(r.body).includes('fetch failed'));
  });
  it('após falha não volta a chamar o fornecedor de imediato (cache negativo)', async () => { fetchImpl = async () => ({ ok: false, status: 500, text: async () => '' }); await call({}); await call({}); assert.equal(fetchCalls, 1); });
  it('resposta demasiado grande é rejeitada', async () => { fetchImpl = async () => ({ ok: true, status: 200, text: async () => 'x'.repeat(7e6) }); assert.equal((await call({})).body.providers[0].error, 'BAD_RESPONSE'); });
});

describe('Remotive: formato oficial', () => {
  it('salário no formato oficial é interpretado; outros formatos ficam só em texto', () => {
    const j = normalize({ ...RAW[0], salary: '$40,000 - $50,000' }, 'T'); assert.deepEqual([j.salaryMin, j.salaryMax, j.salaryCurrency], [40000, 50000, 'USD']);
    for (const t of ['$80k - $100k', '€40,000 - €50,000', 'Competitive', '$50,000 - $40,000', '']) { const k = normalize({ ...RAW[0], salary: t }, 'T'); assert.equal(k.salaryMin, null, t); assert.equal(k.salaryCurrency, null, t); }
  });
  it('datas sem fuso são tratadas como UTC; datas inválidas ou futuras => null', () => {
    assert.equal(normalize({ ...RAW[0], publication_date: '2020-02-15T10:23:26' }, 'T').postedAt, '2020-02-15T10:23:26.000Z');
    assert.equal(normalize({ ...RAW[0], publication_date: '2020-02-15T10:23:26+02:00' }, 'T').postedAt, '2020-02-15T08:23:26.000Z');
    assert.equal(normalize({ ...RAW[0], publication_date: 'ontem' }, 'T').postedAt, null);
    assert.equal(normalize({ ...RAW[0], publication_date: '2099-01-01T00:00:00' }, 'T').postedAt, null);
  });
  it('localização vazia (sem restrição indicada) não é excluída no filtro por país', async () => {
    RAW.push({ id: 8, url: 'https://remotive.com/remote-jobs/x/empty-8', title: 'Support Agent', company_name: 'Delta', candidate_required_location: '', description: 'd', publication_date: recent(3) });
    try { assert.ok((await call({ country: 'MZ' })).body.jobs.some(j => j.id === 'remotive:8')); } finally { RAW.pop(); }
  });
  it('pedido ao fornecedor: URL oficial, sem parâmetros do utilizador, sem URL inventado no user-agent', async () => {
    let seen; fetchImpl = async (u, o) => { seen = { u, o }; return feed(); };
    await call({ q: 'python; DROP TABLE', country: 'MZ' });
    assert.equal(seen.u, 'https://remotive.com/api/remote-jobs'); assert.ok(!/http/i.test(seen.o.headers['user-agent']));
  });
  it('diagnóstico: contagens do feed bruto vs. normalizado', async () => {
    const { default: p } = await import('../services/jobs/providers/remotive.js'); const r = await p.search({}); assert.equal(r.meta.rawCount, 7); assert.equal(r.meta.feedCount, 4);
  });
});

describe('deduplicação', () => {
  const J = (id, source, company, title, extra = {}) => ({ id, source, company, title, originalUrl: 'https://x.test/' + id, postedAt: null, salaryText: null, description: null, ...extra });
  it('agrupa mesma empresa+título (acentos, "Lda", maiúsculas) e mantém a mais completa', () => {
    const out = dedupe([J('a:1', 'a', 'Acme Lda', 'Desenvolvedor Sénior'), J('b:1', 'b', 'ACME', 'desenvolvedor senior', { postedAt: '2026-01-01T00:00:00Z', description: 'x' })]);
    assert.equal(out.length, 1); assert.equal(out[0].id, 'b:1'); assert.deepEqual(out[0].alsoFoundIn, ['a']);
  });
  it('não funde vagas diferentes nem vagas sem empresa só pelo título', () => assert.equal(dedupe([J('a:1', 'a', null, 'Dev'), J('b:1', 'b', null, 'Dev'), J('a:2', 'a', 'Acme', 'QA')]).length, 3));
  it('ordem estável por data e id', () => assert.deepEqual(sortJobs([J('b', 'x', 'c', 't'), J('a', 'x', 'c', 't2'), J('c', 'x', 'c', 't3', { postedAt: '2026-01-02T00:00:00Z' })]).map(j => j.id), ['c', 'a', 'b']));
});

describe('registo de fornecedores', () => {
  it('fornecedor sem configuração é reportado como not_configured', async () => {
    const p = { id: 'zz', name: 'ZZ', isConfigured: () => false, supports: () => true, search: async () => { throw new Error('não devia ser chamado'); } };
    const o = await runSearch({ page: 1, limit: 10 }, [p]); assert.equal(o.providers[0].status, 'not_configured'); assert.equal(o.jobs.length, 0);
  });
  it('um fornecedor a falhar não esconde os resultados dos outros', async () => {
    const ok = { id: 'ok', name: 'OK', isConfigured: () => true, supports: () => true, search: async () => ({ jobs: [{ id: 'ok:1', source: 'ok', company: 'A', title: 'T', originalUrl: 'https://x.test/1', postedAt: null }], meta: {} }) };
    const ko = { id: 'ko', name: 'KO', isConfigured: () => true, supports: () => true, search: async () => { const e = new Error('x'); e.kind = 'TIMEOUT'; throw e; } };
    const o = await runSearch({ page: 1, limit: 10 }, [ok, ko]); assert.equal(o.jobs.length, 1); assert.deepEqual(o.providers.map(p => p.status), ['ok', 'error']);
  });
});

describe('Stage 4: novos parâmetros', () => {
  it('skills: lista normalizada, máx. 10, caracteres seguros', () => {
    assert.deepEqual(validateQuery({ skills: ' Python, Django ,python' }).value.skills, ['python', 'django']);
    assert.ok(validateQuery({ skills: 'c++,c#,node.js' }).ok);
    for (const k of ['a,b,c,d,e,f,g,h,i,j,k', '<script>', 'x'.repeat(41), '$(rm -rf)']) assert.equal(validateQuery({ skills: k }).ok, false, k);
    assert.equal(validateQuery({ skills: ['a', 'b'] }).value.skills.join(), 'a');
  });
  it('experienceLevel, salaryMin e sort validados', () => {
    assert.equal(validateQuery({ experienceLevel: 'senior', salaryMin: '1000', sort: 'relevance' }).ok, true);
    for (const q of [{ experienceLevel: 'god' }, { salaryMin: '-5' }, { salaryMin: '1e9' }, { sort: 'random' }]) assert.equal(validateQuery(q).ok, false);
  });
});

describe('Stage 4: qualidade', () => {
  const base = { id: 'x:1', source: 'x', title: 'Dev', company: 'A', description: 'Texto normal da vaga '.repeat(8), postedAt: new Date().toISOString(), expiresAt: null, qualityFlags: [] };
  it('sinais informativos, sem remover a vaga', () => {
    assert.ok(assess({ ...base, postedAt: recent(90) }).qualityFlags.includes('possibly_old'));
    assert.ok(assess({ ...base, description: 'You must pay a small fee to apply for this job.' }).qualityFlags.includes('possible_fee_request'));
    assert.ok(assess({ ...base, description: 'Taxa de pagamento antes de começar.' }).qualityFlags.includes('possible_fee_request'));
    assert.ok(assess({ ...base, title: 'URGENT HIRING NOW' }).qualityFlags.includes('title_all_caps'));
    assert.ok(assess({ ...base, title: 'Earn $$$ fast!!' }).qualityFlags.includes('title_spammy_punctuation'));
    assert.deepEqual(assess(base).qualityFlags, []);
  });
  it('vaga normal não é marcada como suspeita; "fee" noutro contexto não dispara', () => assert.deepEqual(assess({ ...base, description: 'We pay competitive salary. Fee schedule review experience.' }).qualityFlags, []));
  it('expiração: só "expired" quando a FONTE deu data passada; sem data => unknown (não é removida)', () => {
    assert.equal(assess({ ...base, expiresAt: recent(1) }).expirationStatus, 'expired');
    assert.equal(isExpired(assess({ ...base, expiresAt: new Date(Date.now() + 864e5).toISOString() })), false);
    assert.equal(assess(base).expirationStatus, 'unknown');
  });
  it('vaga incompleta (sem empresa/data) é mantida e apenas sinalizada', async () => {
    const p = { id: 'p', name: 'P', isConfigured: () => true, supports: () => true, search: async () => ({ jobs: [{ id: 'p:1', source: 'p', title: 'T', company: null, originalUrl: 'https://x.test/1', postedAt: null, qualityFlags: ['no_company', 'no_posted_date'] }], meta: {} }) };
    const o = await runSearch({ page: 1, limit: 10, sort: 'recent' }, [p]); assert.equal(o.jobs.length, 1); assert.deepEqual(o.jobs[0].qualityFlags, ['no_company', 'no_posted_date']);
  });
  it('vaga expirada é excluída e contabilizada', async () => {
    const mk = (id, exp) => ({ id, source: 'p', title: 'T' + id, company: 'C' + id, originalUrl: 'https://x.test/' + id, postedAt: null, expiresAt: exp, qualityFlags: [] });
    const p = { id: 'p', name: 'P', isConfigured: () => true, supports: () => true, search: async () => ({ jobs: [mk('1', recent(2)), mk('2', null)], meta: {} }) };
    const o = await runSearch({ page: 1, limit: 10, sort: 'recent' }, [p]); assert.deepEqual(o.jobs.map(j => j.id), ['2']); assert.equal(o.excludedExpired, 1);
  });
});

describe('Stage 4: filtros e ordenação', () => {
  it('hasSkill usa palavra inteira (java != javascript; c++ e node.js funcionam)', () => {
    assert.equal(hasSkill('we use javascript', 'java'), false); assert.equal(hasSkill('we use java.', 'java'), true);
    assert.equal(hasSkill('c++ and c# devs', 'c++'), true); assert.equal(hasSkill('node.js stack', 'node.js'), true); assert.equal(hasSkill('react native', 'react'), true);
  });
  it('skills: todas têm de existir (E)', async () => {
    assert.deepEqual((await call({ skills: 'java' })).body.jobs, []);
    assert.deepEqual((await call({ skills: 'javascript' })).body.jobs.map(j => j.id), ['remotive:3']);
    assert.deepEqual((await call({ skills: 'python,django' })).body.jobs.map(j => j.id), ['remotive:1']);
    assert.deepEqual((await call({ skills: 'python,javascript' })).body.jobs, []);
  });
  it('filtros sem dados fiáveis são declarados, e a pesquisa continua útil', async () => {
    const r = await call({ q: 'python', city: 'Maputo', salaryMin: '5000', experienceLevel: 'senior' });
    assert.equal(r.statusCode, 200); assert.deepEqual(r.body.jobs.map(j => j.id), ['remotive:1']); assert.deepEqual(r.body.unsupportedFilters, ['city', 'salaryMin', 'experienceLevel']);
    assert.deepEqual((await call({ q: 'python' })).body.unsupportedFilters, []);
  });
  it('hasMore e contagem coerentes', async () => { const r = await call({ limit: '3' }); assert.equal(r.body.hasMore, true); assert.equal((await call({ limit: '3', page: '2' })).body.hasMore, false); });
  it('relevância: título pesa mais que descrição; empates por data', async () => {
    const mk = (id, title, d, at) => ({ id, source: 'p', title, company: 'C' + id, description: d, originalUrl: 'https://x.test/' + id, postedAt: at, qualityFlags: [], extra: { tags: [] } });
    const p = { id: 'p', name: 'P', isConfigured: () => true, supports: () => true, search: async () => ({ jobs: [mk('a', 'Office Manager', 'uses python daily', recent(1)), mk('b', 'Python Engineer', 'x', recent(5)), mk('c', 'Designer', 'x', recent(2))], meta: {} }) };
    const rel = await runSearch({ q: 'python', page: 1, limit: 10, sort: 'relevance' }, [p]); assert.deepEqual(rel.jobs.map(j => j.id), ['b', 'a', 'c']);
    const rec = await runSearch({ q: 'python', page: 1, limit: 10, sort: 'recent' }, [p]); assert.deepEqual(rec.jobs.map(j => j.id), ['a', 'c', 'b']);
  });
});

describe('Stage 4: 429 e cache partilhada', () => {
  it('429 respeita Retry-After e não volta a chamar a Remotive durante o cooldown', async () => {
    fetchImpl = async () => ({ ok: false, status: 429, headers: new Headers({ 'retry-after': '120' }), text: async () => '' });
    const a = await call({}); assert.equal(a.body.providers[0].error, 'RATE_LIMITED'); await call({}); await call({ q: 'x' }); assert.equal(fetchCalls, 1);
  });
  it('429 sem Retry-After usa cooldown de 15 min (também é 1 só pedido)', async () => { fetchImpl = async () => ({ ok: false, status: 429, text: async () => '' }); await call({}); await call({}); assert.equal(fetchCalls, 1); });
  it('Redis partilhado: outra instância usa a cópia e o cooldown, sem novo pedido ao fornecedor', async () => {
    const store = new Map(), exp = new Map(); let redisCalls = 0;
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test'; process.env.UPSTASH_REDIS_REST_TOKEN = 't';
    globalThis.fetch = async (u, o) => {
      assert.ok(String(u).startsWith('https://redis.test'), 'só o Redis é chamado neste teste'); redisCalls++;
      const out = JSON.parse(o.body).map(([c, k, v, , ex]) => {
        const live = () => !exp.has(k) || exp.get(k) > Date.now();
        if (c === 'GET') return { result: store.has(k) && live() ? store.get(k) : null };
        if (c === 'SET') { store.set(k, v); if (ex) exp.set(k, Date.now() + Number(ex) * 1000); return { result: 'OK' }; }
        if (c === 'PTTL') return { result: exp.has(k) && live() ? exp.get(k) - Date.now() : -2 };
        return { result: null };
      });
      return { ok: true, json: async () => out };
    };
    try {
      let loads = 0; const loader = async () => { loads++; return { n: 1 }; };
      assert.equal((await cached('t:a', 3600, loader)).cache, 'miss');
      _resetCacheForTests(); // "outra instância": memória vazia
      assert.equal((await cached('t:a', 3600, loader)).cache, 'redis'); assert.equal(loads, 1);
      let tries = 0; const bad = async () => { tries++; throw Object.assign(new Error('x'), { kind: 'RATE_LIMITED', cooldownSec: 120 }); };
      await assert.rejects(cached('t:b', 3600, bad)); _resetCacheForTests();
      await assert.rejects(cached('t:b', 3600, bad), e => e.kind === 'RATE_LIMITED'); assert.equal(tries, 1);
    } finally { delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN; }
  });
  it('instância com cópia velha vê a cópia renovada no Redis (não faz pedido novo)', async () => {
    const store = new Map(); process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test'; process.env.UPSTASH_REDIS_REST_TOKEN = 't';
    globalThis.fetch = async (u, o) => ({ ok: true, json: async () => JSON.parse(o.body).map(([c, k, v]) => (c === 'SET' ? (store.set(k, v), { result: 'OK' }) : { result: c === 'GET' ? store.get(k) ?? null : -2 })) });
    try {
      let loads = 0; await cached('t:c', 0.05, async () => { loads++; return { v: 'old' }; });
      await new Promise(r => setTimeout(r, 90)); // cópia local expira (TTL 50 ms)
      store.set('jobs:v1:t:c', JSON.stringify({ value: { v: 'new' }, at: Date.now() })); // outra instância renovou
      const r = await cached('t:c', 0.05, async () => { loads++; return { v: 'x' }; }); assert.equal(r.value.v, 'new'); assert.equal(loads, 1);
    } finally { delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN; }
  });
});
