// Fase 1 (estabilização): estado observável do limite de pedidos, modo "armazém partilhado obrigatório",
// segredo próprio do HMAC, recuo exponencial dos fornecedores e /api/health. Tudo simulado (sem Redis, IA ou Remotive reais).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { hit, peek, clientKey, storeHealth, rlSecret, rlSecretSource, sharedStoreRequired, _resetMemoryForTests } from '../services/ratelimit.js';
import { cached, _resetCacheForTests } from '../services/jobs/cache.js';
import remotive from '../services/jobs/providers/remotive.js';
import analyze from '../api/analyze.js';
import health, { computeHealth } from '../api/health.js';
import { aiConfigured } from '../services/ai.js';
import { readFileSync } from 'node:fs';

const KEYS = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'REQUIRE_SHARED_STORE', 'RATELIMIT_SECRET', 'AI_API_KEY', 'AI_PROVIDER', 'JOBS_PROVIDERS'];
let saved, realFetch, realNow, realConsole;
const mockRes = () => ({ statusCode: 200, body: undefined, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]])); KEYS.forEach(k => delete process.env[k]);
  realFetch = globalThis.fetch; realNow = Date.now; realConsole = { w: console.warn, e: console.error, l: console.log };
  console.warn = console.error = console.log = () => {}; _resetMemoryForTests(); _resetCacheForTests();
});
afterEach(() => {
  KEYS.forEach(k => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  globalThis.fetch = realFetch; Date.now = realNow; console.warn = realConsole.w; console.error = realConsole.e; console.log = realConsole.l;
});
const redisOn = () => { process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test'; process.env.UPSTASH_REDIS_REST_TOKEN = 'tok'; };

describe('S-4: segredo do HMAC dos IPs', () => {
  it('precedência RATELIMIT_SECRET > AI_API_KEY > constante, e a origem é identificada', () => {
    assert.equal(rlSecretSource(), 'default'); assert.equal(rlSecret(), 'copilot-rl');
    process.env.AI_API_KEY = 'k1'; assert.equal(rlSecretSource(), 'ai_key'); assert.equal(rlSecret(), 'k1');
    process.env.RATELIMIT_SECRET = 'dedicated'; assert.equal(rlSecretSource(), 'dedicated'); assert.equal(rlSecret(), 'dedicated');
  });
  it('o identificador do cliente muda com o segredo e nunca contém o IP', () => {
    const req = { headers: { 'x-real-ip': '203.0.113.7' } };
    const a = clientKey(req); process.env.RATELIMIT_SECRET = 'novo'; const b = clientKey(req);
    assert.notEqual(a, b); assert.equal(b.length, 32); assert.ok(!b.includes('203'));
  });
  it('sem RATELIMIT_SECRET mantém o comportamento anterior (AI_API_KEY)', () => {
    process.env.AI_API_KEY = 'legacy-key'; const k = clientKey({ headers: { 'x-real-ip': '198.51.100.1' } });
    process.env.RATELIMIT_SECRET = ''; assert.equal(clientKey({ headers: { 'x-real-ip': '198.51.100.1' } }), k);
  });
});

describe('S-1: estado do armazém e modo obrigatório', () => {
  it('sem Redis configurado: estado "memory"', () => { assert.equal(storeHealth().status, 'memory'); });
  it('com Redis a responder: "shared"; depois de uma falha: "degraded" e o pedido continua a ser contado em memória', async () => {
    redisOn();
    globalThis.fetch = async () => new Response(JSON.stringify([{ result: 'OK' }, { result: 1 }, { result: 600 }]), { status: 200 });
    assert.equal((await hit('t:a', 5, 600)).backend, 'redis'); assert.equal(storeHealth().status, 'shared');
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    const r = await hit('t:b', 5, 600); assert.equal(r.backend, 'memory'); assert.equal(r.allowed, true);
    const h = storeHealth(); assert.equal(h.status, 'degraded'); assert.equal(h.fallbacks, 1);
  });
  it('recupera para "shared" quando o Redis volta', async () => {
    redisOn(); globalThis.fetch = async () => { throw new TypeError('x'); }; await hit('t:c', 5, 600); assert.equal(storeHealth().status, 'degraded');
    await new Promise(r => setTimeout(r, 5));
    globalThis.fetch = async () => new Response(JSON.stringify([{ result: 'OK' }, { result: 1 }, { result: 600 }]), { status: 200 }); await hit('t:d', 5, 600);
    assert.equal(storeHealth().status, 'shared');
  });
  it('sem a variável, requireShared não muda nada (comportamento anterior preservado)', async () => {
    assert.equal(sharedStoreRequired(), false);
    const r = await hit('t:e', 2, 60, { requireShared: true }); assert.equal(r.allowed, true); assert.equal(r.unavailable, undefined);
    assert.equal((await peek('t:e', 5, { requireShared: true })).unavailable, undefined);
  });
  it('REQUIRE_SHARED_STORE=1 sem Redis: hit/peek recusam (fail closed) só quando a rota o pede', async () => {
    process.env.REQUIRE_SHARED_STORE = '1';
    const r = await hit('t:f', 5, 60, { requireShared: true }); assert.equal(r.allowed, false); assert.equal(r.unavailable, true); assert.ok(r.retryAfter > 0);
    assert.equal((await peek('t:f', 5, { requireShared: true })).unavailable, true);
    assert.equal((await hit('t:g', 5, 60)).allowed, true); // rotas sem a opção (vagas) continuam com o fallback
  });
  it('REQUIRE_SHARED_STORE=1 com Redis a falhar: fail closed; com Redis a funcionar: normal', async () => {
    process.env.REQUIRE_SHARED_STORE = 'true'; redisOn();
    globalThis.fetch = async () => new Response('x', { status: 500 });
    assert.equal((await hit('t:h', 5, 60, { requireShared: true })).unavailable, true);
    globalThis.fetch = async () => new Response(JSON.stringify([{ result: 'OK' }, { result: 1 }, { result: 60 }]), { status: 200 });
    const ok = await hit('t:i', 5, 60, { requireShared: true }); assert.equal(ok.allowed, true); assert.equal(ok.backend, 'redis');
  });
  it('/api/analyze devolve 503 RATE_LIMIT_UNAVAILABLE e NÃO chama a IA nem o Redis falso', async () => {
    process.env.REQUIRE_SHARED_STORE = '1'; process.env.AI_API_KEY = 'k'; let calls = 0; globalThis.fetch = async () => { calls++; return new Response('{}'); };
    const res = mockRes();
    await analyze({ method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '10.9.9.9' }, body: { task: 'analyze', cv: 'x'.repeat(80), vacancy: 'y'.repeat(80) } }, res);
    assert.equal(res.statusCode, 503); assert.equal(res.body.code, 'RATE_LIMIT_UNAVAILABLE'); assert.ok(res.headers['retry-after']); assert.equal(calls, 0);
    assert.ok(!JSON.stringify(res.body).includes('redis'));
  });
  it('a mensagem existe em EN no i18n', () => { assert.match(readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8'), /"srv\.RATE_LIMIT_UNAVAILABLE":"[^"]+"/); });
});

describe('S-3: recuo exponencial dos fornecedores', () => {
  const failing = () => { let n = 0; return { loader: async () => { n++; throw Object.assign(new Error('x'), { kind: 'UPSTREAM', status: 500 }); }, count: () => n }; };
  it('falhas sem Retry-After: cooldown failSec, 2x, 4x (e não volta a insistir antes)', async () => {
    let t = 1e12; Date.now = () => t; const f = failing(), opt = { failSec: 10 };
    await assert.rejects(cached('b:1', 3600, f.loader, opt)); assert.equal(f.count(), 1);
    t += 5000; await assert.rejects(cached('b:1', 3600, f.loader, opt)); assert.equal(f.count(), 1); // ainda em cooldown (10 s)
    t += 6000; await assert.rejects(cached('b:1', 3600, f.loader, opt)); assert.equal(f.count(), 2); // passou 10 s: tenta; novo cooldown 20 s
    t += 15000; await assert.rejects(cached('b:1', 3600, f.loader, opt)); assert.equal(f.count(), 2);
    t += 6000; await assert.rejects(cached('b:1', 3600, f.loader, opt)); assert.equal(f.count(), 3); // novo cooldown 40 s
    t += 30000; await assert.rejects(cached('b:1', 3600, f.loader, opt)); assert.equal(f.count(), 3);
  });
  it('o cooldown nunca passa de 1 h', async () => {
    let t = 1e12; Date.now = () => t; const f = failing(), opt = { failSec: 1800 };
    for (let i = 0; i < 4; i++) { await assert.rejects(cached('b:2', 3600, f.loader, opt)); t += 3601e3; }
    const before = f.count(); t -= 1000e3; await assert.rejects(cached('b:2', 3600, f.loader, opt)); assert.equal(f.count(), before); // dentro de 1 h do último erro
  });
  it('sucesso repõe o recuo', async () => {
    let t = 1e12; Date.now = () => t; let bad = true, n = 0;
    const loader = async () => { n++; if (bad) throw Object.assign(new Error('x'), { kind: 'UPSTREAM' }); return 'ok'; };
    await assert.rejects(cached('b:3', 1, loader, { failSec: 10 })); t += 11e3; await assert.rejects(cached('b:3', 1, loader, { failSec: 10 }));
    bad = false; t += 21e3; assert.equal((await cached('b:3', 1, loader, { failSec: 10 })).cache, 'miss');
    bad = true; t += 5e3; await cached('b:3', 1, loader, { failSec: 10 }).catch(() => {}); // falha com cópia antiga: devolve "stale"; o recuo recomeça em 10 s (não 40 s)
    const c = n; t += 11e3; await cached('b:3', 1, loader, { failSec: 10 }).catch(() => {}); assert.equal(n, c + 1);
  });
  it('Remotive: erro 500 sem Retry-After não é repetido durante 15 min (antes: 60 s)', async () => {
    let t = 1e12; Date.now = () => t; let calls = 0;
    globalThis.fetch = async () => { calls++; return { ok: false, status: 500, headers: { get: () => null }, text: async () => '' }; };
    await assert.rejects(remotive.search({ q: '' })); assert.equal(calls, 1);
    t += 120e3; await assert.rejects(remotive.search({ q: '' })); assert.equal(calls, 1);
    t += 14 * 60e3; await assert.rejects(remotive.search({ q: '' })); assert.equal(calls, 2);
  });
});

describe('S-6: /api/health', () => {
  const GOOD = { AI_API_KEY: 'secret-key-123', AI_PROVIDER: 'openai', JOBS_PROVIDERS: 'remotive' };
  it('aiConfigured valida chave e fornecedor sem chamar a rede', () => {
    assert.equal(aiConfigured({}), false); assert.equal(aiConfigured({ AI_API_KEY: 'k', AI_PROVIDER: 'nope' }), false);
    assert.equal(aiConfigured({ AI_API_KEY: 'k' }), true); assert.equal(aiConfigured({ AI_API_KEY: 'k', AI_PROVIDER: 'Gemini' }), true);
  });
  it('down sem IA; degraded sem Redis; ok com Redis a funcionar', async () => {
    assert.equal(computeHealth({}).status, 'down');
    assert.equal(computeHealth(GOOD).status, 'degraded'); assert.equal(computeHealth(GOOD).checks.rateLimitStore, 'memory');
    Object.assign(process.env, GOOD); redisOn();
    globalThis.fetch = async () => new Response(JSON.stringify([{ result: 'OK' }, { result: 1 }, { result: 60 }]), { status: 200 }); await hit('h:1', 5, 60);
    assert.equal(computeHealth(GOOD).status, 'ok');
  });
  it('REQUIRE_SHARED_STORE sem armazém partilhado => down (as rotas de IA recusam)', () => {
    assert.equal(computeHealth({ ...GOOD, REQUIRE_SHARED_STORE: '1' }).status, 'down');
  });
  it('sem fornecedores de vagas activos => degraded', () => { Object.assign(process.env, GOOD); assert.equal(computeHealth({ ...GOOD, JOBS_PROVIDERS: 'nope' }).checks.jobs, 'not_configured'); });
  it('handler: GET 200/503, HEAD ok, POST 405, no-store, e nada sensível na resposta', () => {
    Object.assign(process.env, GOOD, { UPSTASH_REDIS_REST_URL: 'https://redis.test', UPSTASH_REDIS_REST_TOKEN: 'tok-SECRET' });
    const r = mockRes(); health({ method: 'GET', headers: {} }, r);
    assert.ok([200, 503].includes(r.statusCode)); assert.equal(r.headers['cache-control'], 'no-store');
    const body = JSON.stringify(r.body); for (const s of ['secret-key-123', 'tok-SECRET', 'redis.test', 'remotive', 'openai']) assert.ok(!body.includes(s), s);
    assert.deepEqual(Object.keys(r.body).sort(), ['checks', 'status']);
    const p = mockRes(); health({ method: 'POST', headers: {} }, p); assert.equal(p.statusCode, 405); assert.equal(p.headers.allow, 'GET, HEAD');
    delete process.env.AI_API_KEY; const d = mockRes(); health({ method: 'GET', headers: {} }, d); assert.equal(d.statusCode, 503); assert.equal(d.body.status, 'down');
  });
});
