const User = require('../models/User');
const Organization = require('../models/Organization');
const { isSubscriptionBypassUser } = require('./simulation/subscriptionBypass');
const { resolvePlanTier } = require('./simulation/planEntitlements');

/**
 * Billing v1 vive no User owner. Admin/member herdam o plano da org.
 * Owner (ou legado sem role) usa a própria conta.
 */
function shouldInheritOrgOwnerBilling(userDoc) {
  if (!userDoc?.organizationId) return false;
  const role = String(userDoc.role || '');
  if (!role || role === 'owner') return false;
  return true;
}

async function resolveOrgBillingUser(userDoc) {
  if (isSubscriptionBypassUser(userDoc)) return userDoc;
  if (!shouldInheritOrgOwnerBilling(userDoc)) return userDoc;
  const org = await Organization.findById(userDoc.organizationId).select('ownerUserId').lean();
  const ownerId = org?.ownerUserId;
  if (!ownerId) return userDoc;
  if (String(ownerId) === String(userDoc._id)) return userDoc;
  const owner = await User.findById(ownerId).lean();
  return owner || userDoc;
}

function isoDate(value) {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Copia campos de plano/assinatura do owner para o payload público do membro
 * (sem expor IDs Stripe).
 */
function overlayPublicBillingFields(publicUser, billingUser) {
  if (!publicUser || !billingUser) return publicUser;
  if (publicUser.id && billingUser._id && String(publicUser.id) === String(billingUser._id)) {
    return publicUser;
  }
  const out = { ...publicUser };

  if (isSubscriptionBypassUser(billingUser)) {
    out.subscriptionBillingBypass = true;
    out.subscriptionStatus = 'active';
    out.planTier = billingUser.planTier
      ? String(billingUser.planTier)
      : resolvePlanTier(billingUser);
    delete out.cancelAtPeriodEnd;
    return out;
  }

  if (billingUser.planTier) out.planTier = String(billingUser.planTier);
  if (billingUser.subscriptionStatus) {
    out.subscriptionStatus = String(billingUser.subscriptionStatus);
  }
  const trialEndsAt = isoDate(billingUser.trialEndsAt);
  if (trialEndsAt) out.trialEndsAt = trialEndsAt;
  const currentPeriodEnd = isoDate(billingUser.currentPeriodEnd);
  if (currentPeriodEnd) out.currentPeriodEnd = currentPeriodEnd;
  if (billingUser.cancelAtPeriodEnd === true) out.cancelAtPeriodEnd = true;
  return out;
}

module.exports = {
  shouldInheritOrgOwnerBilling,
  resolveOrgBillingUser,
  overlayPublicBillingFields,
};
