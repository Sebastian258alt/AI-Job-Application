// Logs estruturados e seguros: só aceita números, booleanos e strings curtas (códigos).
// NUNCA passar CV, vaga, código Premium, chaves ou IPs para esta função.
export function log(level, evt, fields = {}) {
  const safe = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'number' || typeof v === 'boolean') safe[k] = v;
    else if (typeof v === 'string') safe[k] = v.slice(0, 80);
  }
  const line = JSON.stringify({ evt, ...safe });
  if (level === 'warn') console.warn(line); else if (level === 'info') console.log(line); else console.error(line);
}
