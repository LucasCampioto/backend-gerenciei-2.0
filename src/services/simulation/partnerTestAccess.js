/**
 * Conta parceira bloqueada: sem assinatura Stripe e (sem créditos ou prazo de teste encerrado).
 */

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {Record<string, unknown> | null | undefined} userDoc — lean ou documento
 */
function isPartnerTestAppLocked(userDoc) {
  if (!userDoc || String(userDoc.accountType || '') !== 'partner_test') return false;
  if (String(userDoc.stripeSubscriptionId || '').trim()) return false;
  const credits = Number(userDoc.simulationCreditsRemaining ?? 0);
  if (Number.isFinite(credits) && credits <= 0) return true;
  const end = toDate(userDoc.partnerTestExpiresAt);
  if (end && Date.now() >= end.getTime()) return true;
  return false;
}

/** @returns {'credits'|'expired'|null} */
function partnerTestLockReason(userDoc) {
  if (!isPartnerTestAppLocked(userDoc)) return null;
  const credits = Number(userDoc.simulationCreditsRemaining ?? 0);
  if (!Number.isFinite(credits) || credits <= 0) return 'credits';
  return 'expired';
}

module.exports = {
  isPartnerTestAppLocked,
  partnerTestLockReason,
};
