import { enabledProviders } from './providers/index.js';
import { norm, tokens, hasSkill } from './model.js';
import { assess, isExpired } from './quality.js';
import { matchJob, resolveWeights } from './match.js';
import { log } from '../log.js';

export const LIMITS = { Q_MAX: 100, PAGE_MAX: 50, LIMIT_MAX: 25, LIMIT_DEFAULT: 10 };
const EXPERIENCE = ['junior', 'mid', 'senior', 'lead'], SORTS = ['recent', 'relevance', 'match'], OPTIONAL = ['city', 'salaryMin', 'experienceLevel'];
const WORKPLACE = ['any', 'remote', 'hybrid', 'onsite'], TYPES = ['any', 'full_time', 'part_time', 'contract', 'freelance', 'internship'];
const one = v => (Array.isArray(v) ? v[0] : v);
const bad = message => ({ ok: false, status: 400, code: 'INVALID_QUERY', message });

// Valida os parâmetros (query string). Desconhecidos são ignorados; nada vai directo para URLs de fornecedores.
export function validateQuery(raw = {}) {
  const g = k => one(raw[k]);
  const out = {};
  const q = g('q'); if (q !== undefined && typeof q !== 'string') return bad('Pesquisa inválida.');
  out.q = (q || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (out.q.length > LIMITS.Q_MAX) return bad('Pesquisa demasiado longa.');
  const c = g('country'); if (c !== undefined && c !== '') { if (typeof c !== 'string' || !/^[A-Za-z]{2}$/.test(c)) return bad('País inválido.'); out.country = c.toUpperCase(); }
  const city = g('city'); if (city) { if (typeof city !== 'string' || city.length > 80) return bad('Localização inválida.'); out.city = city.replace(/[\u0000-\u001F\u007F]/g, ' ').trim(); }
  out.workplace = g('workplace') || 'any'; if (!WORKPLACE.includes(out.workplace)) return bad('Tipo de local de trabalho inválido.');
  out.employmentType = g('employmentType') || 'any'; if (!TYPES.includes(out.employmentType)) return bad('Tipo de contrato inválido.');
  const cat = g('category'); if (cat) { if (typeof cat !== 'string' || !/^[a-z0-9-]{1,40}$/.test(cat)) return bad('Categoria inválida.'); out.category = cat; }
  const pw = g('postedWithinDays'); if (pw !== undefined && pw !== '') { const n = Number(pw); if (!Number.isInteger(n) || n < 1 || n > 90) return bad('Data inválida.'); out.postedWithinDays = n; }
  const sk = g('skills');
  if (sk !== undefined && sk !== '') {
    if (typeof sk !== 'string') return bad('Competências inválidas.');
    const list = [...new Set(sk.split(',').map(x => x.trim().toLowerCase()).filter(Boolean))];
    if (list.length > 10 || list.some(x => !/^[\p{L}\p{N}+#. -]{1,40}$/u.test(x))) return bad('Competências inválidas.');
    if (list.length) out.skills = list;
  }
  const xl = g('experienceLevel'); if (xl) { if (!EXPERIENCE.includes(xl)) return bad('Nível de experiência inválido.'); out.experienceLevel = xl; }
  const sm = g('salaryMin'); if (sm !== undefined && sm !== '') { const n = Number(sm); if (!Number.isInteger(n) || n < 1 || n > 1e7) return bad('Salário mínimo inválido.'); out.salaryMin = n; }
  out.sort = g('sort') || 'recent'; if (!SORTS.includes(out.sort)) return bad('Ordenação inválida.');
  const p = g('page'); out.page = p === undefined || p === '' ? 1 : Number(p); if (!Number.isInteger(out.page) || out.page < 1 || out.page > LIMITS.PAGE_MAX) return bad('Página inválida.');
  const l = g('limit'); out.limit = l === undefined || l === '' ? LIMITS.LIMIT_DEFAULT : Number(l); if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > LIMITS.LIMIT_MAX) return bad('Limite inválido.');
  return { ok: true, value: out };
}

const richness = j => (j.postedAt ? 1 : 0) + (j.salaryText ? 1 : 0) + (j.company ? 1 : 0) + (j.description ? 1 : 0);
// Duplicados entre fornecedores: mesma empresa + mesmo título normalizados (ou mesmo URL). Mantém a vaga com mais informação.
export function dedupe(jobs) {
  const byKey = new Map(), byUrl = new Map();
  for (const j of jobs) {
    const key = j.company ? norm(j.company) + '|' + norm(j.title) : null;
    const prev = (key && byKey.get(key)) || byUrl.get(j.originalUrl);
    if (!prev) { const o = { ...j, alsoFoundIn: [] }; if (key) byKey.set(key, o); byUrl.set(j.originalUrl, o); continue; }
    if (prev.source !== j.source && !prev.alsoFoundIn.includes(j.source)) prev.alsoFoundIn.push(j.source);
    if (richness(j) > richness(prev)) { const keep = prev.alsoFoundIn; Object.assign(prev, j, { alsoFoundIn: keep.filter(x => x !== j.source).concat(prev.source !== j.source ? [prev.source] : []) }); }
  }
  return [...new Set(byUrl.values())];
}
// Ordem estável: mais recentes primeiro (sem data no fim), depois id.
export const sortJobs = js => js.slice().sort((a, b) => (Date.parse(b.postedAt) || 0) - (Date.parse(a.postedAt) || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export async function runSearch(q, providers = enabledProviders(), { profile = null, weights } = {}) {
  const states = [], lists = [];
  const settled = await Promise.allSettled(providers.map(async p => {
    if (!p.isConfigured()) return { p, status: 'not_configured' };
    if (!p.supports(q)) return { p, status: 'skipped', note: 'UNSUPPORTED_FILTER' };
    return { p, status: 'ok', ...(await p.search(q)) };
  }));
  settled.forEach((r, i) => {
    const p = providers[i];
    if (r.status === 'fulfilled') {
      const v = r.value; states.push({ id: p.id, name: p.name, status: v.status, count: v.jobs?.length ?? 0, ...(v.note ? { note: v.note } : {}), ...(v.meta ? { cache: v.meta.cache, fetchedAt: v.meta.fetchedAt } : {}) });
      if (v.jobs) lists.push(...v.jobs);
    } else {
      const kind = r.reason?.kind || 'UNEXPECTED';
      log('warn', 'jobs_provider_error', { provider: p.id, kind, status: r.reason?.status || 0 });
      states.push({ id: p.id, name: p.name, status: 'error', error: kind, count: 0 });
    }
  });
  // Qualidade (determinística) e filtros comuns, aplicados a todos os fornecedores.
  const now = Date.now();
  let all = sortJobs(dedupe(lists)).map(j => assess(j, now));
  const excludedExpired = all.filter(isExpired).length;
  all = all.filter(j => !isExpired(j)); // só por data de expiração fornecida pela fonte
  if (q.skills?.length) all = all.filter(j => { const hay = [j.title, j.description, ...(j.requiredSkills || []), ...(j.preferredSkills || []), ...(j.extra?.tags || [])].join(' '); return q.skills.every(x => hasSkill(hay, x)); });
  const toks = tokens(q.q || '');
  if (q.sort === 'relevance' && toks.length) { // estável: empates mantêm a ordem por data
    const sc = j => { const t = tokens(j.title || ''), m = tokens([j.extra?.category, ...(j.extra?.tags || [])].join(' ')), c = tokens(j.company || ''), d = tokens(j.description || ''); return toks.reduce((n, w) => n + 3 * t.includes(w) + 2 * m.includes(w) + c.includes(w) + d.includes(w), 0); };
    const m = new Map(all.map(j => [j.id, sc(j)])); all = all.slice().sort((a, b) => m.get(b.id) - m.get(a.id));
  }
  // SmartMatch (determinístico, sem IA): a pontuação é SEMPRE calculada aqui, nunca aceite do cliente.
  if (profile) {
    const cfg = { weights: weights || resolveWeights() };
    all = all.map(j => ({ ...j, match: matchJob(j, profile, cfg) }));
    if (q.sort === 'match') all = all.slice().sort((a, b) => (b.match.score ?? -1) - (a.match.score ?? -1)); // estável: empates mantêm a ordem por data
  }
  // Filtros opcionais pedidos que nenhuma fonte consultada sabe aplicar: dizemos em vez de os ignorar em silêncio.
  const queried = providers.filter(p => states.find(x => x.id === p.id && x.status === 'ok'));
  const unsupportedFilters = OPTIONAL.filter(f => q[f] != null && !queried.some(p => p.filters?.includes(f)));
  const start = (q.page - 1) * q.limit;
  return { jobs: all.slice(start, start + q.limit), total: all.length, page: q.page, limit: q.limit, hasMore: start + q.limit < all.length, excludedExpired, unsupportedFilters, providers: states,
    attributions: queried.map(p => ({ id: p.id, name: p.name })) };
}
