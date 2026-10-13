// Validação do pedido recebido por /api/analyze.
export const LIMITS = { MIN_CHARS: 50, CV_MAX: 20000, VAC_MAX: 12000, MAX_BODY_BYTES: 150000 };

// Tarefas permitidas e respectivos requisitos. `premium: true` => exige código Premium válido.
export const TASKS = {
  analyze:   { premium: false, needsDocs: true },
  kit:       { premium: true,  needsDocs: true },
  interview: { premium: true,  needsDocs: true },
  verify:    { premium: true,  needsDocs: false }, // só valida o código (não chama a IA)
};

const fail = (status, code, message) => ({ ok: false, status, code, message });

// Remove caracteres de controlo (mantém \n e \t), normaliza quebras de linha.
export const normalizeText = s => s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();

export function validateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'INVALID_REQUEST', 'Pedido inválido.');
  const { task, cv, vacancy, code } = body;
  if (typeof task !== 'string' || !Object.hasOwn(TASKS, task)) return fail(400, 'INVALID_TASK', 'Pedido inválido.');
  if (code !== undefined && code !== null && typeof code !== 'string') return fail(400, 'INVALID_REQUEST', 'Pedido inválido.');
  const value = { task, code: typeof code === 'string' ? code.trim() : '', cv: '', vacancy: '' };
  if (!TASKS[task].needsDocs) return { ok: true, value };

  if (typeof cv !== 'string' || typeof vacancy !== 'string') return fail(400, 'MISSING_INPUT', 'Falta o CV ou a vaga.');
  const c = normalizeText(cv), v = normalizeText(vacancy);
  if (!c || !v) return fail(400, 'MISSING_INPUT', 'Falta o CV ou a vaga.');
  if (c.length > LIMITS.CV_MAX || v.length > LIMITS.VAC_MAX) return fail(413, 'TOO_LARGE', 'O texto é demasiado longo.');
  if (c.length < LIMITS.MIN_CHARS || v.length < LIMITS.MIN_CHARS) return fail(400, 'TOO_SHORT', 'O CV ou a vaga é demasiado curto para análise.');
  value.cv = c; value.vacancy = v;
  return { ok: true, value };
}
