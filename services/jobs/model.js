// Modelo interno de vaga, independente do fornecedor. Campos em falta ficam null/[]: nada é inventado.
export const VERIFICATION = { SOURCE_RETRIEVED: 'source_retrieved' }; // só estados com prova; "listing accessible" e "employer verified" não são atribuídos aqui

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
export function stripHtml(s) {
  return String(s ?? '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|nbsp|#39);/g, m => ENT[m]).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function excerpt(s, max = 400) {
  const t = stripHtml(s);
  if (t.length <= max) return t || null;
  const cut = t.slice(0, max), i = cut.lastIndexOf(' ');
  return (i > max * 0.6 ? cut.slice(0, i) : cut) + '…';
}
const text = (v, max) => (typeof v === 'string' && v.trim() ? stripHtml(v).slice(0, max) : null);

// Só aceita https e, se indicado, só os domínios do fornecedor. Nunca javascript:, data:, http:.
export function safeUrl(u, hosts) {
  try {
    const x = new URL(String(u));
    if (x.protocol !== 'https:' || x.username || x.password) return null;
    if (hosts && !hosts.some(h => x.hostname === h || x.hostname.endsWith('.' + h))) return null;
    return x.href.slice(0, 500);
  } catch { return null; }
}
export function isoDate(v) {
  const t = Date.parse(typeof v === 'string' ? v : '');
  return Number.isFinite(t) && t < Date.now() + 864e5 ? new Date(t).toISOString() : null; // datas no futuro distante = inválidas
}

export function makeJob(f) {
  const j = {
    id: f.id, source: f.source, sourceJobId: f.sourceJobId ?? null,
    title: text(f.title, 160), company: text(f.company, 120), location: text(f.location, 160), country: f.country ?? null,
    description: f.description ?? null, employmentType: f.employmentType ?? null, workplaceType: f.workplaceType ?? null,
    salaryMin: f.salaryMin ?? null, salaryMax: f.salaryMax ?? null, salaryCurrency: f.salaryCurrency ?? null, salaryText: text(f.salaryText, 80),
    requiredSkills: f.requiredSkills ?? [], preferredSkills: f.preferredSkills ?? [],
    postedAt: f.postedAt ?? null, expiresAt: f.expiresAt ?? null, originalUrl: f.originalUrl,
    fetchedAt: f.fetchedAt, lastVerifiedAt: null, verificationStatus: VERIFICATION.SOURCE_RETRIEVED,
    sourceAttribution: f.sourceAttribution, applicationMethod: 'external_link',
    extra: f.extra ?? {}, // campos específicos do fornecedor
  };
  j.qualityFlags = [!j.company && 'no_company', !j.postedAt && 'no_posted_date', (!j.description || j.description.length < 80) && 'short_description'].filter(Boolean);
  return j;
}
export const isComplete = j => !!(j.id && j.title && j.originalUrl);

export const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\b(lda|ltd|llc|inc|sa|gmbh|limitada)\b\.?/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Tokens de pesquisa (minúsculas; mantém + # . para "c++", "c#", "node.js").
export const tokens = s => stripHtml(s).toLowerCase().split(/[^\p{L}\p{N}+#.]+/u).filter(Boolean);
// Competência como palavra inteira: "java" não corresponde a "javascript".
export const hasSkill = (hay, skill) => new RegExp('(^|[^a-z0-9+#])' + skill.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9+#])').test(hay.toLowerCase());
