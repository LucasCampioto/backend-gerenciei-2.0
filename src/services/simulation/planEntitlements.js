const { isSubscriptionBypassUser } = require('./subscriptionBypass');

/** @typedef {'gestao' | 'profissional' | 'enterprise' | 'legado'} PlanTier */
/** @typedef {'ops' | 'pricing_simulator' | 'ai_simulation' | 'whatsapp' | 'marketing' | 'crm' | 'commercial_ai' | 'forms'} PlanFeature */

const VALID_TIERS = new Set(['gestao', 'profissional', 'enterprise', 'legado']);

/** Features liberadas no plano Gestão (ops + simulador de preços). */
const GESTAO_FEATURES = new Set([
  'ops',
  'pricing_simulator',
]);

/** Features do app completo (Profissional, Enterprise, Legado). */
const FULL_FEATURES = new Set([
  'ops',
  'pricing_simulator',
  'ai_simulation',
  'whatsapp',
  'marketing',
  'crm',
  'commercial_ai',
  'forms',
]);

const FEATURES_BY_TIER = {
  gestao: GESTAO_FEATURES,
  profissional: FULL_FEATURES,
  enterprise: FULL_FEATURES,
  legado: FULL_FEATURES,
};

function loadPlanTierMap() {
  const raw = (process.env.PLAN_TIER_BY_PRICE_ID || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    console.error('[planEntitlements] PLAN_TIER_BY_PRICE_ID is not valid JSON');
  }
  return {};
}

/**
 * @param {string | null | undefined} priceId
 * @returns {PlanTier | null}
 */
function resolvePlanTierFromPriceId(priceId) {
  const id = String(priceId || '').trim();
  if (!id) return null;
  const map = loadPlanTierMap();
  const raw = map[id];
  if (raw == null) return null;
  const tier = String(raw).trim().toLowerCase();
  return VALID_TIERS.has(tier) ? /** @type {PlanTier} */ (tier) : null;
}

/**
 * Resolve tier a partir do User (campo persistido) ou priceId.
 * Bypass admin → profissional, salvo se `planTier` estiver setado (simulação local).
 * @param {Record<string, unknown> | null | undefined} userDoc
 * @param {string | null | undefined} [priceId]
 * @returns {PlanTier}
 */
function resolvePlanTier(userDoc, priceId) {
  const stored = String(userDoc?.planTier || '')
    .trim()
    .toLowerCase();
  const storedTier = VALID_TIERS.has(stored) ? /** @type {PlanTier} */ (stored) : null;

  // Admin bypass: permite simular plano via User.planTier; sem override → profissional.
  if (isSubscriptionBypassUser(userDoc)) {
    return storedTier || 'profissional';
  }

  // Contas parceiro de teste: app completo até o partner lock.
  if (String(userDoc?.accountType || '') === 'partner_test') {
    return storedTier || 'profissional';
  }

  const fromPrice = resolvePlanTierFromPriceId(priceId);
  if (fromPrice) return fromPrice;

  if (storedTier) return storedTier;

  // Sem mapeamento: contas oficiais pagantes antigas sem tier → legado (app completo).
  if (String(userDoc?.stripeSubscriptionId || '').trim()) return 'legado';

  return 'gestao';
}

/**
 * @param {PlanTier | string | null | undefined} tier
 * @param {PlanFeature | string} feature
 */
function planHasFeature(tier, feature) {
  const t = String(tier || '')
    .trim()
    .toLowerCase();
  const f = String(feature || '')
    .trim()
    .toLowerCase();
  const set = FEATURES_BY_TIER[t] || GESTAO_FEATURES;
  return set.has(f);
}

const FEATURE_LOCKED_MESSAGE =
  'Este recurso está disponível no plano Profissional. Faça upgrade em Configurações → Assinatura.';

module.exports = {
  VALID_TIERS,
  GESTAO_FEATURES,
  FULL_FEATURES,
  FEATURES_BY_TIER,
  FEATURE_LOCKED_MESSAGE,
  loadPlanTierMap,
  resolvePlanTierFromPriceId,
  resolvePlanTier,
  planHasFeature,
};
