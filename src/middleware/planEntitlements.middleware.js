const jwt = require('jsonwebtoken');
const User = require('../models/User');
const {
  resolvePlanTier,
  planHasFeature,
  FEATURE_LOCKED_MESSAGE,
} = require('../services/simulation/planEntitlements');

function pathname(url) {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/**
 * Mapeia path da API → feature requerida (null = sem gate de plano).
 * @param {string} p
 * @returns {string | null}
 */
function requiredFeatureForPath(p) {
  if (p.startsWith('/v1/enhance')) return 'ai_simulation';
  if (p.startsWith('/api/enhance-pairs') || p.startsWith('/api/enhance')) return 'ai_simulation';
  if (p.startsWith('/api/simulations')) return 'ai_simulation';
  if (p.startsWith('/api/whatsapp')) return 'whatsapp';
  if (p.startsWith('/api/campaigns')) return 'marketing';
  if (p.startsWith('/api/marketing')) return 'marketing';
  if (p.startsWith('/api/crm')) return 'crm';
  if (p.startsWith('/api/forms')) return 'forms';
  if (p.startsWith('/api/commercial')) return 'commercial_ai';
  return null;
}

function skipPlanGateAlways(p) {
  if (p.startsWith('/api/auth')) return true;
  if (p.startsWith('/api/admin')) return true;
  if (p.startsWith('/api/internal')) return true;
  if (p === '/api/stripe/webhook') return true;
  if (p.startsWith('/api/public/')) return true;
  if (p === '/api/subscriptions/plans') return true;
  if (p.startsWith('/api/subscriptions/checkout')) return true;
  if (p === '/health') return true;
  // Simulador de preços (ops) — permitido no Gestão
  if (p.startsWith('/api/pricing-bases') || p.startsWith('/api/pricingBases')) return true;
  return false;
}

function verifyUserToken(token, secret) {
  try {
    const payload = jwt.verify(token, secret);
    if (payload?.userId) return String(payload.userId);
    if (payload?.sub) return String(payload.sub);
    return null;
  } catch {
    return null;
  }
}

/**
 * Bloqueia rotas Pro-only para contas no plano Gestão.
 */
function createPlanEntitlementsGuard(jwtSecret) {
  return async function planEntitlementsGuard(req, res, next) {
    const p = pathname(req.originalUrl || req.url || '');
    if (skipPlanGateAlways(p)) return next();

    const feature = requiredFeatureForPath(p);
    if (!feature) return next();

    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(h);
    if (!m) return next();

    const userId = verifyUserToken(m[1].trim(), jwtSecret);
    if (!userId) return next();

    const user = await User.findById(userId).lean();
    if (!user) return next();

    const tier = resolvePlanTier(user);
    if (planHasFeature(tier, feature)) return next();

    return res.status(403).json({
      message: FEATURE_LOCKED_MESSAGE,
      code: 'PLAN_FEATURE_LOCKED',
      planTier: tier,
      feature,
    });
  };
}

module.exports = {
  createPlanEntitlementsGuard,
  requiredFeatureForPath,
};
