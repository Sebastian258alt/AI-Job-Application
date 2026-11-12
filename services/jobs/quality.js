// Controlo de qualidade determinístico (sem IA). Só ACRESCENTA sinais; nunca remove vagas por falta de campos opcionais.
// Única exclusão automática: vagas cuja data de expiração FORNECIDA pela fonte já passou.
// Não atribui "verificada"/"empregador verificado": isso exigiria prova que não temos.
const FEE = /(pay|payment|deposit|fee|taxa|pagamento|pagar)\W+(?:\w+\W+){0,4}(to apply|before (hiring|starting)|registration|training kit|para se candidatar|antes de (começar|iniciar))|western union|moneygram/i;
const OLD_DAYS = 60;

export function assess(job, now = Date.now()) {
  const flags = new Set(job.qualityFlags || []);
  const posted = Date.parse(job.postedAt), exp = Date.parse(job.expiresAt);
  const ageDays = Number.isFinite(posted) ? Math.max(0, Math.floor((now - posted) / 864e5)) : null;
  if (ageDays != null && ageDays > OLD_DAYS) flags.add('possibly_old'); // informativo: a fonte pode ainda listá-la como activa
  const head = (job.title || '') + ' ' + (job.description || '');
  if (FEE.test(head)) flags.add('possible_fee_request');
  if (job.title && job.title.length > 8 && job.title === job.title.toUpperCase() && /[A-Z]{4}/.test(job.title)) flags.add('title_all_caps');
  if (/!{2,}|\${2,}|€{2,}/.test(job.title || '')) flags.add('title_spammy_punctuation');
  const expirationStatus = !Number.isFinite(exp) ? 'unknown' : exp < now ? 'expired' : 'has_future_expiry';
  return { ...job, ageDays, expirationStatus, qualityFlags: [...flags] };
}
export const isExpired = j => j.expirationStatus === 'expired';
