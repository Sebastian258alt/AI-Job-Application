// Verificação AO VIVO do fornecedor Remotive (precisa de internet; faz UM pedido ao fornecedor).
// Uso: node scripts/check-jobs-live.mjs
// Não imprime vagas completas nem chaves. Serve para confirmar o formato real e medir a cobertura (Moçambique/África).
import remotive from '../services/jobs/providers/remotive.js';

const t0 = Date.now();
let all;
try { all = await remotive.search({ q: '', workplace: 'any', employmentType: 'any' }); }
catch (e) { console.error('FALHOU:', e.kind || e.name, e.status || ''); process.exit(1); }
const { jobs, meta } = all, n = jobs.length, pct = c => n ? Math.round(100 * jobs.filter(c).length / n) + '%' : 'n/a';
const loc = s => jobs.filter(j => new RegExp(s, 'i').test(j.location || '')).length;
console.log(JSON.stringify({
  ok: n > 0, ms: Date.now() - t0, cache: meta.cache, rawJobsInFeed: meta.rawCount, normalizedKept: meta.feedCount, droppedAsInvalid: meta.rawCount - meta.feedCount,
  fieldCoverage: { company: pct(j => j.company), postedAt: pct(j => j.postedAt), location: pct(j => j.location), salaryText: pct(j => j.salaryText), salaryParsed: pct(j => j.salaryMin != null), employmentType: pct(j => j.employmentType), description: pct(j => j.description) },
  locationMentions: { worldwide: loc('worldwide|anywhere'), africa: loc('africa'), mozambique: loc('mozambique'), southAfrica: loc('south africa'), portugal: loc('portugal'), emptyLocation: jobs.filter(j => !j.location).length },
  newestPostedAt: jobs.map(j => j.postedAt).filter(Boolean).sort().pop() ?? null,
  allUrlsHttpsRemotive: jobs.every(j => /^https:\/\/([a-z0-9-]+\.)*remotive\.com\//.test(j.originalUrl)),
  sample: jobs.slice(0, 3).map(j => ({ id: j.id, title: j.title, company: j.company, location: j.location, postedAt: j.postedAt, url: j.originalUrl })),
}, null, 2));
