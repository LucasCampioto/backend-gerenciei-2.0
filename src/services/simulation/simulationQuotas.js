const User = require('../../models/User');
const { isPartnerTestAppLocked } = require('./partnerTestAccess');
const {
  isSubscriptionAppLocked,
  getSubscriptionLockState,
  isSubscriptionEligibleForQuotaRenewal,
} = require('./subscriptionAccess');
const { isSubscriptionBypassUser } = require('./subscriptionBypass');

const PARTNER_LOCK_MSG = 'Período de teste encerrado. Contrate um plano em Configurações para continuar.';

/**
 * Cotas do plano atual (Starter) para contas admin sem Stripe.
 * Env: SUBSCRIPTION_BYPASS_MONTHLY_QUOTA / SUBSCRIPTION_BYPASS_PREVIEW_MONTHLY_QUOTA
 */
function getBypassMonthlyQuota() {
  const n = Number(process.env.SUBSCRIPTION_BYPASS_MONTHLY_QUOTA);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 40;
}

function getBypassPreviewMonthlyQuota() {
  const n = Number(process.env.SUBSCRIPTION_BYPASS_PREVIEW_MONTHLY_QUOTA);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
}

/** Realinha cota admin quando zerada, legado ilimitado (9999+) ou diferente do plano configurado. */
function bypassShouldSyncQuota(currentQuota, desiredQuota) {
  const q = Number(currentQuota ?? 0);
  if (!Number.isFinite(q) || q <= 0) return true;
  if (q >= 9999) return true;
  if (q !== desiredQuota) return true;
  return false;
}

function effectiveSimulationMonthlyQuota(userDoc) {
  const desired = getBypassMonthlyQuota();
  const q = Number(userDoc?.simulationMonthlyQuota ?? 0);
  if (isSubscriptionBypassUser(userDoc) && bypassShouldSyncQuota(q, desired)) return desired;
  if (Number.isFinite(q) && q > 0) return Math.floor(q);
  return Number.isFinite(q) && q >= 0 ? Math.floor(q) : 0;
}

function effectivePreviewMonthlyQuota(userDoc) {
  const desired = getBypassPreviewMonthlyQuota();
  const q = Number(userDoc?.previewMonthlyQuota ?? 0);
  if (isSubscriptionBypassUser(userDoc) && bypassShouldSyncQuota(q, desired)) return desired;
  if (Number.isFinite(q) && q > 0) return Math.floor(q);
  return Number.isFinite(q) && q >= 0 ? Math.floor(q) : 0;
}

// Timezone used to compute the YYYY-MM period key (e.g. first day of a new month
// in Brazil may already be the last of the previous month in UTC).
function getTimezone() {
  return (process.env.SIMULATION_QUOTA_TIMEZONE || 'America/Sao_Paulo').trim();
}

// Returns current period as "YYYY-MM" in the configured timezone.
function getCurrentQuotaPeriodKey() {
  const tz = getTimezone();
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value || '';
  const month = parts.find((p) => p.type === 'month')?.value || '';
  return `${year}-${month}`;
}

// Parses SIMULATION_QUOTA_BY_PRICE_ID env var.
// Expected format: {"price_xxx": 40, "price_yyy": 140}
function loadQuotaMap() {
  const raw = (process.env.SIMULATION_QUOTA_BY_PRICE_ID || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    console.error('[simulationQuotas] SIMULATION_QUOTA_BY_PRICE_ID is not valid JSON — quotas disabled');
  }
  return {};
}

function getMonthlyQuotaForPriceId(priceId) {
  const map = loadQuotaMap();
  const id = String(priceId || '').trim();
  if (!id || !(id in map)) return 0;
  const quota = Number(map[id]);
  return Number.isFinite(quota) && quota >= 0 ? Math.floor(quota) : 0;
}

/**
 * Monta $set para renovação mensal (simulações e prévias independentes).
 * Exportado para testes unitários.
 * @param {Record<string, unknown>} userDoc
 * @param {string} periodKey
 */
function buildQuotaPeriodResetSet(userDoc, periodKey) {
  const set = {};
  const simQuota = effectiveSimulationMonthlyQuota(userDoc);
  const previewQuota = effectivePreviewMonthlyQuota(userDoc);
  const bypass = isSubscriptionBypassUser(userDoc);

  // Contas admin: alinha cota ao plano Starter (40 sim / 20 prévias) sem Stripe.
  if (bypass) {
    if (bypassShouldSyncQuota(userDoc.simulationMonthlyQuota, simQuota)) {
      set.simulationMonthlyQuota = simQuota;
      set.simulationCreditsRemaining = simQuota;
      set.simulationQuotaPeriodKey = periodKey;
    }
    if (bypassShouldSyncQuota(userDoc.previewMonthlyQuota, previewQuota)) {
      set.previewMonthlyQuota = previewQuota;
      set.previewCreditsRemaining = previewQuota;
      set.previewQuotaPeriodKey = periodKey;
    }
  }

  const simPeriodStale = String(userDoc.simulationQuotaPeriodKey || '') !== periodKey;
  const previewPeriodStale = String(userDoc.previewQuotaPeriodKey || '') !== periodKey;

  if (!bypass && simPeriodStale) {
    set.simulationCreditsRemaining = simQuota;
    set.simulationQuotaPeriodKey = periodKey;
  }

  if (!bypass && previewPeriodStale) {
    set.previewCreditsRemaining = previewQuota;
    set.previewQuotaPeriodKey = periodKey;
  }

  return set;
}

// If the stored period key is stale (new month), reset remaining credits to the
// monthly quota and update the period key. Writes to DB only when needed.
// Only runs for official accounts with subscriptionStatus === 'active'.
async function applyQuotaPeriodResetIfNeeded(userDoc) {
  if (userDoc && String(userDoc.accountType || '') === 'partner_test') {
    return userDoc;
  }
  if (!userDoc || !isSubscriptionEligibleForQuotaRenewal(userDoc)) {
    return userDoc;
  }

  const periodKey = getCurrentQuotaPeriodKey();
  const set = buildQuotaPeriodResetSet(userDoc, periodKey);
  if (Object.keys(set).length === 0) return userDoc;

  return User.findByIdAndUpdate(userDoc._id, { $set: set }, { new: true });
}

function loadPreviewQuotaMap() {
  const raw = (process.env.PREVIEW_QUOTA_BY_PRICE_ID || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    console.error('[simulationQuotas] PREVIEW_QUOTA_BY_PRICE_ID is not valid JSON — preview quotas disabled');
  }
  return {};
}

function getMonthlyPreviewQuotaForPriceId(priceId) {
  const map = loadPreviewQuotaMap();
  const id = String(priceId || '').trim();
  if (!id || !(id in map)) return 0;
  const quota = Number(map[id]);
  return Number.isFinite(quota) && quota >= 0 ? Math.floor(quota) : 0;
}

// Called from the webhook when a subscription is created or updated.
// Reads the price id from the subscription object's first item and updates quota.
async function syncUserQuotaFromStripeSubscription(userId, subscription) {
  const firstItem = subscription?.items?.data?.[0];
  const rawPrice = firstItem?.price;
  const priceId = typeof rawPrice === 'string' ? rawPrice : (rawPrice?.id ?? '');
  const quota = getMonthlyQuotaForPriceId(priceId);
  const previewQuota = getMonthlyPreviewQuotaForPriceId(priceId);

  const periodKey = getCurrentQuotaPeriodKey();

  await User.findByIdAndUpdate(userId, {
    $set: {
      simulationMonthlyQuota: quota,
      simulationCreditsRemaining: quota,
      simulationQuotaPeriodKey: periodKey,
      previewMonthlyQuota: previewQuota,
      previewCreditsRemaining: previewQuota,
      previewQuotaPeriodKey: periodKey,
    },
  });
}

// Called when the subscription reaches a terminal state (canceled, unpaid, etc.)
async function zeroUserQuota(userId) {
  await User.findByIdAndUpdate(userId, {
    $set: {
      simulationMonthlyQuota: 0,
      simulationCreditsRemaining: 0,
      previewMonthlyQuota: 0,
      previewCreditsRemaining: 0,
    },
  });
}

/**
 * Tenta consumir 1 crédito de simulação (mês + débito atômico).
 * Usado na rota de enhance; ao salvar no histórico não debita de novo.
 * @param {string|object} userId id do User (ObjectId)
 * @returns {Promise<{ ok: true } | { ok: false, error: string, status: number }>}
 */
async function tryDebitSimulationCredit(userId) {
  let userDoc = await User.findById(userId).lean();
  if (!userDoc) return { ok: false, error: 'Usuário não encontrado', status: 404 };

  if (isPartnerTestAppLocked(userDoc)) {
    return { ok: false, error: PARTNER_LOCK_MSG, status: 403, code: 'PARTNER_TEST_LOCKED' };
  }

  if (isSubscriptionAppLocked(userDoc)) {
    const subLock = getSubscriptionLockState(userDoc);
    return {
      ok: false,
      error: subLock.message || 'Assinatura inativa.',
      status: 403,
      code: subLock.code || 'SUBSCRIPTION_CANCELED',
    };
  }

  // Admin bypass: mesma cota do plano (debita normalmente); só isenta Stripe.
  if (String(userDoc.simulationQuotaPeriodKey || '') !== getCurrentQuotaPeriodKey()) {
    userDoc = await applyQuotaPeriodResetIfNeeded(userDoc);
  } else if (isSubscriptionBypassUser(userDoc)) {
    userDoc = await applyQuotaPeriodResetIfNeeded(userDoc);
  }

  const debited = await User.findOneAndUpdate(
    { _id: userId, simulationCreditsRemaining: { $gt: 0 } },
    { $inc: { simulationCreditsRemaining: -1 } },
    { new: true },
  );
  if (!debited) {
    return { ok: false, error: 'Limite de simulações do mês atingido', status: 403 };
  }
  return { ok: true };
}

/** Devolve 1 crédito após falha do agente (débito feito antes da chamada). */
async function refundSimulationCredit(userId) {
  await User.findByIdAndUpdate(userId, { $inc: { simulationCreditsRemaining: 1 } });
}

/**
 * Tenta consumir 1 crédito de pré-visualização (mês + débito atômico).
 * @param {string|object} userId
 * @returns {Promise<{ ok: true } | { ok: false, error: string, status: number, code?: string }>}
 */
async function tryDebitPreviewCredit(userId) {
  let userDoc = await User.findById(userId).lean();
  if (!userDoc) return { ok: false, error: 'Usuário não encontrado', status: 404 };

  if (isPartnerTestAppLocked(userDoc)) {
    return { ok: false, error: PARTNER_LOCK_MSG, status: 403, code: 'PARTNER_TEST_LOCKED' };
  }

  if (isSubscriptionAppLocked(userDoc)) {
    const subLock = getSubscriptionLockState(userDoc);
    return {
      ok: false,
      error: subLock.message || 'Assinatura inativa.',
      status: 403,
      code: subLock.code || 'SUBSCRIPTION_CANCELED',
    };
  }

  // Admin bypass: mesma cota de prévia do plano (debita normalmente).
  if (String(userDoc.previewQuotaPeriodKey || '') !== getCurrentQuotaPeriodKey()) {
    userDoc = await applyQuotaPeriodResetIfNeeded(userDoc);
  } else if (isSubscriptionBypassUser(userDoc)) {
    userDoc = await applyQuotaPeriodResetIfNeeded(userDoc);
  }

  const debited = await User.findOneAndUpdate(
    { _id: userId, previewCreditsRemaining: { $gt: 0 } },
    { $inc: { previewCreditsRemaining: -1 } },
    { new: true },
  );
  if (!debited) {
    return {
      ok: false,
      error: 'Limite de pré-visualizações do mês atingido',
      status: 403,
      code: 'PREVIEW_LIMIT_REACHED',
    };
  }
  return { ok: true };
}

/** Devolve 1 crédito de preview após falha do agente. */
async function refundPreviewCredit(userId) {
  await User.findByIdAndUpdate(userId, { $inc: { previewCreditsRemaining: 1 } });
}

module.exports = {
  getCurrentQuotaPeriodKey,
  getMonthlyQuotaForPriceId,
  getMonthlyPreviewQuotaForPriceId,
  buildQuotaPeriodResetSet,
  applyQuotaPeriodResetIfNeeded,
  syncUserQuotaFromStripeSubscription,
  zeroUserQuota,
  tryDebitSimulationCredit,
  refundSimulationCredit,
  tryDebitPreviewCredit,
  refundPreviewCredit,
};
