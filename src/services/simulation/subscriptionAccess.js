const { isSubscriptionBypassUser } = require('./subscriptionBypass');

/** Status Stripe com bloqueio imediato por inadimplência. */
const PAYMENT_OVERDUE_STATUSES = new Set(['past_due', 'unpaid']);

/** Status Stripe cancelados — bloqueio após currentPeriodEnd. */
const CANCELED_SUBSCRIPTION_STATUSES = new Set(['canceled', 'cancelled', 'incomplete_expired']);

const PAYMENT_OVERDUE_MESSAGE =
  'Pagamento pendente. Regularize sua assinatura para continuar.';

const SUBSCRIPTION_CANCELED_MESSAGE =
  'Sua assinatura encerrou. Renove o plano para continuar.';

const SUBSCRIPTION_REQUIRED_MESSAGE =
  'Assine um plano em Configurações para continuar usando a Gerenciei.';

/** Status que liberam o app (gate total). */
const ACCESS_OK_STATUSES = new Set(['active', 'trialing']);

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {Record<string, unknown> | null | undefined} userDoc
 * @returns {{ locked: boolean, code?: string, message?: string }}
 */
function getSubscriptionLockState(userDoc) {
  if (!userDoc) return { locked: false };
  if (isSubscriptionBypassUser(userDoc)) return { locked: false };

  // Partner sem Stripe: lock de cota/expiração é tratado em billingLock (partner).
  if (String(userDoc.accountType || '') === 'partner_test') {
    if (!String(userDoc.stripeSubscriptionId || '').trim()) return { locked: false };
  }

  const status = String(userDoc.subscriptionStatus || '').toLowerCase();
  const hasSub = Boolean(String(userDoc.stripeSubscriptionId || '').trim());

  if (PAYMENT_OVERDUE_STATUSES.has(status)) {
    return { locked: true, code: 'PAYMENT_OVERDUE', message: PAYMENT_OVERDUE_MESSAGE };
  }

  if (CANCELED_SUBSCRIPTION_STATUSES.has(status)) {
    const periodEnd = toDate(userDoc.currentPeriodEnd);
    if (periodEnd && Date.now() < periodEnd.getTime()) {
      return { locked: false };
    }
    return { locked: true, code: 'SUBSCRIPTION_CANCELED', message: SUBSCRIPTION_CANCELED_MESSAGE };
  }

  // Gate total: sem assinatura (ou status que não libera acesso).
  if (!hasSub || !ACCESS_OK_STATUSES.has(status)) {
    if (status === 'incomplete') {
      return { locked: true, code: 'SUBSCRIPTION_REQUIRED', message: SUBSCRIPTION_REQUIRED_MESSAGE };
    }
    if (!hasSub || !status) {
      return { locked: true, code: 'SUBSCRIPTION_REQUIRED', message: SUBSCRIPTION_REQUIRED_MESSAGE };
    }
    if (!ACCESS_OK_STATUSES.has(status)) {
      return { locked: true, code: 'SUBSCRIPTION_REQUIRED', message: SUBSCRIPTION_REQUIRED_MESSAGE };
    }
  }

  return { locked: false };
}

/** @param {Record<string, unknown> | null | undefined} userDoc */
function isSubscriptionAppLocked(userDoc) {
  return getSubscriptionLockState(userDoc).locked;
}

/** @deprecated use getSubscriptionLockState */
const SUBSCRIPTION_LOCK_MESSAGE = SUBSCRIPTION_CANCELED_MESSAGE;

/** Status anteriores que, ao voltar para `active`, restauram cotas via webhook. */
const QUOTA_RECOVERY_PREVIOUS_STATUSES = new Set([
  'past_due',
  'unpaid',
  'incomplete',
  'incomplete_expired',
]);

/**
 * Renovação mensal civil de simulações/prévias — assinatura Stripe `active`, ou conta admin (bypass).
 * @param {Record<string, unknown> | null | undefined} userDoc
 */
function isSubscriptionEligibleForQuotaRenewal(userDoc) {
  if (!userDoc) return false;
  if (String(userDoc.accountType || '') === 'partner_test') return false;
  if (isSubscriptionBypassUser(userDoc)) return true;
  if (!String(userDoc.stripeSubscriptionId || '').trim()) return false;
  return String(userDoc.subscriptionStatus || '').toLowerCase() === 'active';
}

/**
 * Transição que dispara restauração imediata de cotas (pagamento regularizado).
 * @param {string} previousStatus
 * @param {string} newStatus
 */
function isQuotaRecoveryTransition(previousStatus, newStatus) {
  const prev = String(previousStatus || '').toLowerCase();
  const next = String(newStatus || '').toLowerCase();
  return QUOTA_RECOVERY_PREVIOUS_STATUSES.has(prev) && next === 'active';
}

module.exports = {
  PAYMENT_OVERDUE_MESSAGE,
  SUBSCRIPTION_CANCELED_MESSAGE,
  SUBSCRIPTION_REQUIRED_MESSAGE,
  SUBSCRIPTION_LOCK_MESSAGE,
  QUOTA_RECOVERY_PREVIOUS_STATUSES,
  getSubscriptionLockState,
  isSubscriptionAppLocked,
  isSubscriptionEligibleForQuotaRenewal,
  isQuotaRecoveryTransition,
};
