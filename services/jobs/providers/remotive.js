// Remotive (https://remotive.com/api/remote-jobs). Termos oficiais (README do GitHub da Remotive): máx. ~4 pedidos/dia, vagas atrasadas 24 h,
// atribuição com ligação à Remotive obrigatória (senão cancelam o acesso), proibido reenviar as vagas a sites de terceiros (ex.: Jooble),
// e proibido mostrar as vagas para recolher registos/emails. => A pesquisa Remotive não pode ficar atrás de registo. Sem chave. Só vagas remotas.
// Formato confirmado no README oficial (github.com/remotive-com/remote-jobs-api); ainda NÃO confirmado com chamada real.
import { makeJob, excerpt, safeUrl, isoDate, isComplete, tokens } from '../model.js';
import { cached } from '../cache.js';

export class ProviderError extends Error { constructor(kind, status, cooldownSec) { super(kind); this.kind = kind; this.status = status; this.cooldownSec = cooldownSec; } }
const URL_ = 'https://remotive.com/api/remote-jobs', HOSTS = ['remotive.com'], TTL = 6 * 3600, MAX_BYTES = 6e6, FAIL_SEC = 900; // falha sem Retry-After: 15 min, depois 30 min, 60 min (quota Remotive: ~4 pedidos/dia)
const TYPES = { full_time: 'full_time', part_time: 'part_time', contract: 'contract', freelance: 'freelance', internship: 'internship' };
const WORLD = /worldwide|anywhere|global|remote/i;
const slug = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Nota: publication_date não traz fuso horário na doc oficial; assume-se UTC.
export function normalize(raw, fetchedAt) {
  if (!raw || typeof raw !== 'object') return null;
  const url = safeUrl(raw.url, HOSTS);
  const sid = raw.id != null ? String(raw.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) : '';
  if (!url || !sid) return null;
  const j = makeJob({
    id: 'remotive:' + sid, source: 'remotive', sourceJobId: sid, title: raw.title, company: raw.company_name,
    location: raw.candidate_required_location, description: excerpt(raw.description, 400),
    employmentType: TYPES[raw.job_type] ?? null, workplaceType: 'remote', salaryText: raw.salary || null, ...parseSalary(raw.salary),
    postedAt: isoDate(/(Z|[+-]\d\d:?\d\d)$/.test(String(raw.publication_date)) ? raw.publication_date : raw.publication_date + 'Z'), originalUrl: url, fetchedAt,
    sourceAttribution: { name: 'Remotive', url: 'https://remotive.com' },
    extra: { category: typeof raw.category === 'string' ? raw.category.slice(0, 60) : null, tags: Array.isArray(raw.tags) ? raw.tags.filter(t => typeof t === 'string').slice(0, 15).map(t => t.slice(0, 40)) : [] },
  });
  return isComplete(j) ? j : null;
}

async function loadFeed() {
  let r;
  try { r = await fetch(URL_, { headers: { accept: 'application/json', 'user-agent': 'ApplyPro/1.0' }, signal: AbortSignal.timeout(8000) }); }
  catch (e) { throw new ProviderError(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK'); }
  if (r.status === 429) { const ra = Number(r.headers?.get?.('retry-after')); throw new ProviderError('RATE_LIMITED', 429, Number.isFinite(ra) && ra > 0 ? ra : 900); } // Remotive bloqueia >2 pedidos/min: respeitar
  if (!r.ok) throw new ProviderError('UPSTREAM', r.status);
  const t = await r.text().catch(() => '');
  if (t.length > MAX_BYTES) throw new ProviderError('BAD_RESPONSE');
  let j; try { j = JSON.parse(t); } catch { throw new ProviderError('BAD_RESPONSE'); }
  if (!j || !Array.isArray(j.jobs)) throw new ProviderError('BAD_RESPONSE');
  const at = new Date().toISOString();
  const jobs = j.jobs.map(x => normalize(x, at)).filter(Boolean);
  return { fetchedAt: at, rawCount: j.jobs.length, jobs };
}

// "$40,000 - $50,000" (a doc diz: normalmente anual, em USD). Só se interpreta este formato exacto; o resto fica só em salaryText.
export function parseSalary(t) {
  const m = /^\$\s?(\d{1,3}(?:,\d{3})+|\d+)\s*-\s*\$?\s?(\d{1,3}(?:,\d{3})+|\d+)$/.exec(String(t ?? '').trim());
  if (!m) return {};
  const a = Number(m[1].replace(/,/g, '')), b = Number(m[2].replace(/,/g, ''));
  return a > 0 && b >= a ? { salaryMin: a, salaryMax: b, salaryCurrency: 'USD' } : {};
}
const regionName = c => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(c); } catch { return null; } };

export default {
  id: 'remotive', name: 'Remotive', needsKey: false,
  filters: [], // filtros opcionais que consegue aplicar (city, salaryMin, experienceLevel): nenhum, sem dados fiáveis
  isConfigured: () => true,
  // Só vagas remotas; "hybrid"/"onsite" não são suportados.
  supports: q => !q.workplace || q.workplace === 'any' || q.workplace === 'remote',
  async search(q) {
    const { value, cache } = await cached('remotive:feed', TTL, loadFeed, { failSec: FAIL_SEC });
    const toks = tokens(q.q), cutoff = q.postedWithinDays ? Date.now() - q.postedWithinDays * 864e5 : 0, cn = q.country ? regionName(q.country) : null;
    const jobs = value.jobs.filter(j => {
      if (q.employmentType && q.employmentType !== 'any' && j.employmentType !== q.employmentType) return false;
      if (q.category && !slug(j.extra.category).startsWith(q.category)) return false; // heurística: o slug da API ("software-dev") é prefixo do rótulo
      if (cutoff && !(j.postedAt && Date.parse(j.postedAt) >= cutoff)) return false; // com filtro de data, vagas sem data não podem ser confirmadas
      if (q.country && !(!j.location || WORLD.test(j.location) || (cn && (j.location || '').toLowerCase().includes(cn.toLowerCase())))) return false;
      if (toks.length) { const h = tokens([j.title, j.company, j.extra.category, ...j.extra.tags, j.description].join(' ')).join(' '); if (!toks.every(t => h.includes(t))) return false; }
      return true;
    });
    return { jobs, meta: { cache, fetchedAt: value.fetchedAt, rawCount: value.rawCount, feedCount: value.jobs.length } };
  },
};
