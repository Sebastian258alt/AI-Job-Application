// Registo de fornecedores. Para acrescentar um: criar o ficheiro (id, name, isConfigured, supports, search) e listá-lo aqui.
import remotive from './remotive.js';
const ALL = { remotive };
// JOBS_PROVIDERS="remotive,adzuna" (defeito: remotive). Ids desconhecidos são ignorados.
export function enabledProviders(env = process.env) {
  const ids = String(env.JOBS_PROVIDERS || 'remotive').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return [...new Set(ids)].map(id => ALL[id]).filter(Boolean);
}
