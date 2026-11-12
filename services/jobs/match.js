// SmartMatch: pontuação DETERMINÍSTICA de alinhamento entre um perfil estruturado (extraído do CV) e uma vaga. Sem IA por vaga.
// A pontuação é uma estimativa de alinhamento com os requisitos DISPONÍVEIS; nunca é uma probabilidade de contratação.
// Só usa dados profissionais: o perfil não tem campos de idade, género, nacionalidade, religião, etc. (ver normalizeProfile).
// Informação ausente no CV = "não confirmada", nunca "falta de qualificação". Componentes sem dados ficam de fora (não valem 0).
import { tokens, hasSkill } from './model.js';

export const SCALE_NOTE = 'alignment_estimate_not_hiring_probability';
export const DEFAULT_WEIGHTS = { skills: 0.5, title: 0.2, experience: 0.15, location: 0.15 }; // parâmetros, não verdades universais
export const DEFAULT_PARAMS = { locationRestrictionCap: 35 }; // se a vaga exclui o país do candidato, a pontuação não passa deste valor
export const UNSCORED = ['languages', 'education', 'certifications']; // as fontes actuais não dão requisitos estruturados para estes

// SMARTMATCH_WEIGHTS='{"skills":0.6,"title":0.2,"experience":0.1,"location":0.1}' (opcional). Valores inválidos => defeitos.
export function resolveWeights(env = process.env) {
  try {
    const o = JSON.parse(env.SMARTMATCH_WEIGHTS || 'null');
    if (!o || typeof o !== 'object') return { ...DEFAULT_WEIGHTS };
    const w = { ...DEFAULT_WEIGHTS };
    for (const k of Object.keys(DEFAULT_WEIGHTS)) if (k in o) { if (!Number.isFinite(o[k]) || o[k] < 0 || o[k] > 1) return { ...DEFAULT_WEIGHTS }; w[k] = o[k]; }
    return Object.values(w).some(v => v > 0) ? w : { ...DEFAULT_WEIGHTS };
  } catch { return { ...DEFAULT_WEIGHTS }; }
}

const ALIASES = { js: 'javascript', ts: 'typescript', nodejs: 'node.js', node: 'node.js', 'node js': 'node.js', reactjs: 'react', 'react.js': 'react', vuejs: 'vue', 'vue.js': 'vue', postgres: 'postgresql', golang: 'go', k8s: 'kubernetes', 'ms excel': 'excel', 'microsoft excel': 'excel', powerbi: 'power bi', 'c sharp': 'c#', 'amazon web services': 'aws', 'google cloud platform': 'gcp', py: 'python' };
const GENERIC = new Set(['remote', 'worldwide', 'anywhere', 'full-time', 'full time', 'part-time', 'part time', 'contract', 'freelance', 'internship', 'senior', 'junior', 'lead', 'entry level', 'hiring', 'urgent']);
export const normSkill = s => { const t = String(s ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/^[\s.,;:()-]+|[\s.,;:()-]+$/g, ''); return ALIASES[t] ?? t; };
const uniq = a => [...new Set(a)];

const STOP = new Set(['senior', 'sr', 'junior', 'jr', 'lead', 'principal', 'staff', 'head', 'the', 'a', 'an', 'of', 'and', 'for', 'at', 'in', 'to', 'remote', 'full', 'time', 'part', 'intern', 'internship', 'trainee', 'entry', 'level', 'ii', 'iii']);
const ROLE = { engineer: 'developer', engineers: 'developer', programmer: 'developer', programmers: 'developer', dev: 'developer', developers: 'developer' };
const titleToks = s => uniq(tokens(s).map(w => ROLE[w] ?? (w.length > 3 ? w.replace(/s$/, '') : w)).filter(w => w.length > 1 && !STOP.has(w)));

const level = t => (/\b(lead|principal|staff|head|director)\b/i.test(t) ? 'lead' : /\b(senior|sr)\b/i.test(t) ? 'senior' : /\b(intern|internship|trainee|junior|jr|entry[- ]level)\b/i.test(t) ? 'junior' : null);
const WORLD = /worldwide|anywhere|global|remote/i;
const regionName = c => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(c); } catch { return null; } };

function skillsPart(job, profile) {
  const prof = uniq(profile.skills.map(normSkill).filter(Boolean));
  const mk = (arr, tier, w) => uniq((arr || []).map(normSkill).filter(t => t && !GENERIC.has(t))).map(term => ({ term, tier, w }));
  const seen = new Set(), items = [];
  for (const it of [...mk(job.requiredSkills, 'required', 3), ...mk(job.extra?.tags, 'listed', 2), ...mk(job.preferredSkills, 'preferred', 1)].slice(0, 40)) if (!seen.has(it.term)) { seen.add(it.term); items.push(it); }
  const text = [job.title, job.description].filter(Boolean).join(' ');
  const exact = new Set(), partial = new Set();
  let num = 0, den = 0;
  for (const it of items) {
    const ex = prof.includes(it.term), pa = !ex && prof.some(p => p !== it.term && (hasSkill(p, it.term) || hasSkill(it.term, p)));
    if (ex) exact.add(it.term); else if (pa) partial.add(it.term);
    num += it.w * (ex ? 1 : pa ? 0.5 : 0); den += it.w;
  }
  const inText = prof.filter(p => !exact.has(p) && hasSkill(text, p)).slice(0, 10); // competências do candidato que a vaga menciona no texto
  const missing = tier => items.filter(i => i.tier === tier && !exact.has(i.term) && !partial.has(i.term)).map(i => i.term);
  return { known: den > 0 && prof.length > 0, value: den && prof.length ? num / den : null, // perfil sem competências = informação ausente, não "zero competências"
    matched: [...exact], partial: [...partial], inText, missing: { required: missing('required'), listed: missing('listed'), preferred: missing('preferred') }, usedTags: items.some(i => i.tier === 'listed') };
}
function titlePart(job, profile) {
  const jt = titleToks(job.title || ''), mine = [profile.headline, ...profile.titles].filter(Boolean).map(titleToks).filter(t => t.length);
  if (!jt.length || !mine.length) return { known: false, value: null };
  return { known: true, value: Math.max(...mine.map(p => jt.filter(w => p.includes(w)).length / jt.length)) };
}
function experiencePart(job, profile) {
  const lv = level(job.title || ''), y = profile.yearsExperience;
  if (!lv || y == null) return { known: false, value: null, jobLevel: lv };
  const value = lv === 'junior' ? (y <= 3 ? 1 : 0.8) : Math.min(1, y / (lv === 'senior' ? 5 : 8)); // sobrequalificação não é penalizada com força
  return { known: true, value, jobLevel: lv, years: y };
}
function locationPart(job, profile) {
  const parts = []; let blocked = false, eligible = null, workplaceFit = null;
  const wp = profile.workplacePreference;
  if (wp && job.workplaceType) { workplaceFit = wp === 'any' || wp === job.workplaceType; parts.push(workplaceFit ? 1 : 0.4); }
  const c = profile.location?.country;
  if (c) {
    const name = regionName(c), loc = job.location || '';
    eligible = !loc || WORLD.test(loc) || (!!name && loc.toLowerCase().includes(name.toLowerCase()));
    if (!eligible) blocked = true;
    parts.push(eligible ? 1 : 0);
  }
  return parts.length ? { known: true, value: parts.reduce((a, b) => a + b, 0) / parts.length, blocked, eligible, workplaceFit } : { known: false, value: null, blocked: false };
}

export function matchJob(job, profile, { weights = DEFAULT_WEIGHTS, params = DEFAULT_PARAMS } = {}) {
  const sk = skillsPart(job, profile), ti = titlePart(job, profile), ex = experiencePart(job, profile), lo = locationPart(job, profile);
  const parts = { skills: sk, title: ti, experience: ex, location: lo };
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const known = Object.keys(parts).filter(k => parts[k].known && weights[k] > 0), wsum = known.reduce((a, k) => a + weights[k], 0);
  const coverage = total ? wsum / total : 0;
  let score = null;
  if (wsum > 0) {
    let raw = known.reduce((a, k) => a + weights[k] * parts[k].value, 0) / wsum;
    if (lo.blocked) raw = Math.min(raw, params.locationRestrictionCap / 100);
    score = Math.round(100 * raw);
  }
  const strengths = [], gaps = [], notes = [];
  if (sk.matched.length) strengths.push({ code: 'skills_matched', items: sk.matched.slice(0, 10) });
  if (sk.partial.length) strengths.push({ code: 'skills_related', items: sk.partial.slice(0, 10) });
  if (sk.inText.length) strengths.push({ code: 'skills_in_job_text', items: sk.inText });
  if (ti.known && ti.value >= 0.5) strengths.push({ code: 'title_aligned' });
  if (ex.known && ex.value >= 0.9) strengths.push({ code: 'seniority_fit', jobLevel: ex.jobLevel });
  if (lo.eligible === true) strengths.push({ code: 'location_eligible' });
  if (lo.workplaceFit === true) strengths.push({ code: 'workplace_fit' });
  // "unconfirmed" = não aparece no perfil; não significa que o candidato não tenha a competência.
  for (const tier of ['required', 'listed', 'preferred']) if (sk.missing[tier].length) gaps.push({ code: 'skills_unconfirmed_' + tier, items: sk.missing[tier].slice(0, 10) });
  if (ex.known && ex.value < 0.7) gaps.push({ code: 'seniority_below', jobLevel: ex.jobLevel, years: ex.years });
  if (lo.blocked) gaps.push({ code: 'location_restricted' });
  if (lo.workplaceFit === false) gaps.push({ code: 'workplace_differs' });
  if (sk.usedTags) notes.push('listed_skills_are_source_tags_not_confirmed_requirements');
  if (job.description) notes.push('job_description_may_be_partial');
  return {
    score, scale: SCALE_NOTE, confidence: coverage >= 0.8 ? 'high' : coverage >= 0.5 ? 'medium' : 'low', coverage: Math.round(coverage * 100) / 100,
    components: Object.fromEntries(Object.keys(parts).map(k => [k, { weight: weights[k], known: parts[k].known, value: parts[k].value == null ? null : Math.round(parts[k].value * 100) / 100 }])),
    strengths, gaps, notes, unscored: UNSCORED,
  };
}
