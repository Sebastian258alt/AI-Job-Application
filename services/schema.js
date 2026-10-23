// Validação/normalização das respostas JSON da IA ANTES de chegarem ao utilizador.
// Tolerante em campos opcionais (assume vazio), estrito nos campos sem os quais a interface não funciona.
export class SchemaError extends Error {
  constructor(field) { super('INVALID_SCHEMA:' + field); this.name = 'SchemaError'; this.field = field; }
}
export const CATEGORIES = ['essential', 'preferred', 'responsibility', 'technical', 'soft', 'education', 'experience', 'language'];
export const STATUSES = ['MATCH', 'PARTIAL', 'NOT_FOUND'];

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
const list = (v, maxItems, maxLen) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])
  .map(x => str(x, maxLen)).filter(Boolean).slice(0, maxItems);
const items = (v, max) => (Array.isArray(v) ? v : []).filter(isObj).slice(0, max);

export function normalizeAnalysis(raw) {
  if (!isObj(raw)) throw new SchemaError('root');
  const n = typeof raw.score === 'string' && raw.score.trim() !== '' ? Number(raw.score) : raw.score;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new SchemaError('score');
  const requirements = items(raw.requirements, 40).map(x => {
    const category = str(x.category, 30).toLowerCase();
    const status = str(x.status, 20).toUpperCase().replace(/[\s-]+/g, '_');
    return { category, text: str(x.text, 400), status, evidence: str(x.evidence, 500) };
  }).filter(x => CATEGORIES.includes(x.category) && STATUSES.includes(x.status) && x.text); // descarta itens inválidos
  const out = {
    score: Math.max(0, Math.min(100, Math.round(n))),
    strengths: list(raw.strengths, 15, 400),
    partial_matches: list(raw.partial_matches, 15, 400),
    missing_from_cv: list(raw.missing_from_cv, 15, 400),
    requirements,
    recommendations: items(raw.recommendations, 15).map(x => ({ current: str(x.current, 600), direction: str(x.direction, 800) })).filter(x => x.direction),
    keywords: list(raw.keywords, 30, 60),
    application_strategy: str(raw.application_strategy, 3000),
  };
  if (!out.strengths.length && !out.partial_matches.length && !out.missing_from_cv.length && !out.requirements.length) throw new SchemaError('empty');
  return out;
}

export function normalizeKit(raw) {
  if (!isObj(raw)) throw new SchemaError('root');
  const e = isObj(raw.email) ? raw.email : {};
  const out = {
    cover_letter: str(raw.cover_letter, 8000),
    email: { subject: str(e.subject, 200), body: str(e.body, 4000) },
    profile_summary: str(raw.profile_summary, 1500),
  };
  if (!out.cover_letter) throw new SchemaError('cover_letter');
  if (!out.email.subject) throw new SchemaError('email.subject');
  if (!out.email.body) throw new SchemaError('email.body');
  if (!out.profile_summary) throw new SchemaError('profile_summary');
  return out;
}

export const NOT_IDENTIFIED = { pt: 'Não identificado no CV.', en: 'Not identified in the CV.' };
export function normalizeInterview(raw, lang = 'pt') {
  if (!isObj(raw)) throw new SchemaError('root');
  const questions = items(raw.questions, 10).map(q => ({
    question: str(q.question, 400), why: str(q.why, 600), structure: str(q.structure, 600),
    example: str(q.example, 900) || NOT_IDENTIFIED[lang] || NOT_IDENTIFIED.pt,
  })).filter(q => q.question);
  if (!questions.length) throw new SchemaError('questions');
  return { questions, ask_employer: list(raw.ask_employer, 5, 300) };
}

export function normalizeCv(raw) {
  if (!isObj(raw)) throw new SchemaError('root');
  const experience = items(raw.experience, 20).map(x => ({ role: str(x.role, 150), company: str(x.company, 150), period: str(x.period, 80), bullets: list(x.bullets, 10, 400) }))
    .filter(x => x.role || x.company || x.bullets.length);
  const education = items(raw.education, 10).map(x => ({ title: str(x.title, 200), institution: str(x.institution, 200), period: str(x.period, 80), details: str(x.details, 400) }))
    .filter(x => x.title || x.institution);
  const out = {
    lang: str(raw.lang, 5).toLowerCase() === 'en' ? 'en' : 'pt', name: str(raw.name, 120), headline: str(raw.headline, 160),
    contact: list(raw.contact, 8, 120), summary: str(raw.summary, 1200), experience, education,
    skills: list(raw.skills, 40, 60), languages: list(raw.languages, 10, 80), additional: list(raw.additional, 15, 300),
  };
  if (!out.summary && !experience.length && !education.length && !out.skills.length) throw new SchemaError('empty');
  return out;
}

// Verificação contra o CV original (feita no servidor, depois da validação do formato): impede que dados de contacto/nome
// inventados cheguem ao documento e assinala números e nomes de entidades que não aparecem no CV, para o utilizador confirmar.
const squash = t => String(t).toLowerCase().replace(/\s+/g, '');
const nums = t => new Set((String(t).match(/\d[\d.,]*%?/g) || []).map(x => x.replace(/[.,]+$/, '')));
export function groundCv(doc, cvText) {
  const src = squash(cvText), srcNums = nums(cvText);
  const inCv = x => x && src.includes(squash(x));
  const out = { ...doc, contact: doc.contact.filter(inCv), name: inCv(doc.name) ? doc.name : '' };
  const generated = [out.headline, out.summary, ...out.experience.flatMap(e => [e.role, ...e.bullets]), ...out.education.map(e => e.details)].join('\n');
  const numbers = [...nums(generated)].filter(n => !srcNums.has(n)).slice(0, 10);
  const entities = [...new Set([...out.experience.map(e => e.company), ...out.education.map(e => e.institution)].filter(x => x && !inCv(x)))].slice(0, 10);
  return { ...out, check: { numbers, entities } };
}

const NORMALIZERS = { analyze: normalizeAnalysis, kit: normalizeKit, interview: normalizeInterview, cv: normalizeCv };
export function normalizeResult(task, raw, lang = 'pt') {
  const f = NORMALIZERS[task];
  if (!f) throw new SchemaError('task');
  return f(raw, lang);
}

// Conteúdo Premium da análise é retirado NO SERVIDOR para quem não tem código válido
// (grátis: pontuação, pontos fortes, lacunas, requisitos e 1 recomendação).
export function gateAnalysis(data, premium) {
  if (premium) return data;
  return { ...data, recommendations: data.recommendations.slice(0, 1), keywords: [], application_strategy: '' };
}
