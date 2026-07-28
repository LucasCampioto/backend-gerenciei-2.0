const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { isPartnerTestAppLocked } = require('../services/simulation/partnerTestAccess');
const {
  getSubscriptionLockState,
  isSubscriptionAppLocked,
} = require('../services/simulation/subscriptionAccess');

function pathname(url) {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/** Rotas que nunca passam pela lógica de bloqueio (públicas ou antes do JWT). */
function skipPartnerLockAlways(p) {
  if (p.startsWith('/api/auth')) return true;
  if (p.startsWith('/api/admin')) return true;
  if (p.startsWith('/api/internal')) return true;
  if (p.startsWith('/api/demo')) return true;
  if (p === '/api/stripe/webhook') return true;
  if (p.startsWith('/api/public/')) return true;
  if (p === '/api/subscriptions/plans') return true;
  if (p.startsWith('/api/subscriptions/checkout-session')) return true;
  if (p === '/api/subscriptions/checkout') return true;
  if (p === '/health') return true;
  return false;
}

/** Com conta bloqueada (parceiro ou assinatura inativa), estas rotas continuam permitidas. */
function exemptWhenBillingLocked(p) {
  if (p === '/api/me' || p.startsWith('/api/me/')) return true;
  if (p === '/api/auth/me' || p.startsWith('/api/auth/me')) return true;
  if (p === '/api/auth/accept-terms') return true;
  if (p === '/api/auth/password' || p === '/api/auth/change-password') return true;
  if (p === '/api/subscriptions/checkout-official') return true;
  if (p === '/api/subscriptions/current') return true;
  if (p === '/api/subscriptions/portal') return true;
  return false;
}

const LOCK_MESSAGE = 'Período de teste encerrado. Contrate um plano em Configurações para continuar.';

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
 * Gate total: partner_test lock + subscription lock.
 * Portado de luni partnerTestLock.js.
 */
function createBillingLockGuard(jwtSecret) {
  return async function billingLockGuard(req, res, next) {
    const p = pathname(req.originalUrl || req.url || '');
    if (skipPartnerLockAlways(p)) return next();

    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(h);
    if (!m) return next();

    const userId = verifyUserToken(m[1].trim(), jwtSecret);
    if (!userId) return next();

    const user = await User.findById(userId).lean();
    if (!user) return next();

    if (user.accountType === 'partner_test' && !String(user.stripeSubscriptionId || '').trim()) {
      if (!isPartnerTestAppLocked(user)) {
        return next();
      }
      if (exemptWhenBillingLocked(p)) {
        return next();
      }
      return res.status(403).json({ message: LOCK_MESSAGE, code: 'PARTNER_TEST_LOCKED' });
    }

    if (!isSubscriptionAppLocked(user)) return next();
    if (exemptWhenBillingLocked(p)) return next();

    const subLock = getSubscriptionLockState(user);
    return res.status(403).json({
      message: subLock.message || 'Assinatura inativa.',
      code: subLock.code || 'SUBSCRIPTION_CANCELED',
    });
  };
}

module.exports = { createBillingLockGuard };
