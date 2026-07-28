const { getStripe } = require('./stripeClient');
const { updateUserStripeFields } = require('./usersBilling');
const { stripeSubscriptionFields } = require('./stripeSubscriptionFields');

function isoOrNull(epochSeconds) {
  if (!epochSeconds) return null;
  return new Date(epochSeconds * 1000).toISOString();
}

function mapPrice(price) {
  if (!price) return null;
  const product = typeof price.product === 'object' ? price.product : null;
  return {
    id: price.id,
    nickname: price.nickname || null,
    currency: price.currency || null,
    amountCents: Number.isFinite(price.unit_amount) ? price.unit_amount : null,
    recurringInterval: price.recurring?.interval || null,
    recurringIntervalCount: price.recurring?.interval_count || null,
    productId: product?.id || (typeof price.product === 'string' ? price.product : null),
    productName: product?.name || null,
  };
}

async function getCurrentSubscriptionSummary(user) {
  const trialEndsAt = user.trialEndsAt ? user.trialEndsAt.toISOString() : null;
  const subscriptionId = String(user.stripeSubscriptionId || '').trim();
  const customerId = String(user.stripeCustomerId || '').trim();

  if (!subscriptionId || !customerId) {
    return {
      hasSubscription: false,
      status: user.subscriptionStatus || 'none',
      subscriptionId: subscriptionId || null,
      customerId: customerId || null,
      trialEndsAt,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      currentPrice: null,
    };
  }

  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['items.data.price.product'],
  });

  await updateUserStripeFields(user._id, stripeSubscriptionFields(subscription));

  const firstItem = subscription.items?.data?.[0];
  return {
    hasSubscription: true,
    status: subscription.status,
    subscriptionId: subscription.id,
    customerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id || customerId,
    trialEndsAt: isoOrNull(subscription.trial_end) || trialEndsAt,
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    currentPeriodEnd: isoOrNull(subscription.current_period_end),
    canceledAt: isoOrNull(subscription.canceled_at),
    currentPrice: mapPrice(firstItem?.price),
  };
}

async function createBillingPortalSessionForUser(user) {
  const customerId = String(user.stripeCustomerId || '').trim();
  if (!customerId) {
    throw new Error('Usuário sem cliente Stripe vinculado');
  }

  const returnUrl = (process.env.STRIPE_BILLING_PORTAL_RETURN_URL || '').trim();
  if (!returnUrl) {
    throw new Error('STRIPE_BILLING_PORTAL_RETURN_URL é obrigatório no .env');
  }

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  if (!session.url) {
    throw new Error('Stripe Billing Portal sem URL');
  }

  return { url: session.url };
}

module.exports = {
  getCurrentSubscriptionSummary,
  createBillingPortalSessionForUser,
};
