const { randomBytes } = require('crypto');
const ProcessedStripeEvent = require('../../models/ProcessedStripeEvent');
const { getStripe } = require('./stripeClient');
const {
  findUserByEmail,
  createUserWithPassword,
  updateUserStripeFields,
  findUserByStripeSubscriptionId,
} = require('./usersBilling');
const {
  sendSubscriptionActivatedForExistingUserEmail,
  sendSubscriptionWelcomeEmail,
} = require('./email');
const {
  syncUserQuotaFromStripeSubscription,
  zeroUserQuota,
} = require('./simulationQuotas');
const { LEGAL_VERSION } = require('../../legal/version');
const { stripeSubscriptionFields } = require('./stripeSubscriptionFields');
const { isQuotaRecoveryTransition } = require('./subscriptionAccess');

function resolveTermsFieldsFromSession(session) {
  const version = String(session.metadata?.app_terms_version || LEGAL_VERSION).trim();
  const rawAt = String(session.metadata?.app_terms_accepted_at || '').trim();
  const acceptedAt = rawAt ? new Date(rawAt) : new Date();
  if (Number.isNaN(acceptedAt.getTime())) return null;
  return {
    termsAcceptedAt: acceptedAt,
    privacyAcceptedAt: acceptedAt,
    termsVersion: version || LEGAL_VERSION,
    patientDataResponsibilityAckAt: acceptedAt,
  };
}

async function provisionUserFromCheckoutSession(session, { skipEmails = false } = {}) {
  if (session.mode !== 'subscription') return;

  const subscriptionId = session.subscription;
  const customerId = session.customer;
  if (!subscriptionId || !customerId) {
    throw new Error('checkout.session.completed sem subscription ou customer');
  }

  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(String(subscriptionId), {
    expand: ['items.data.price'],
  });
  const email = String(session.customer_details?.email || session.customer_email || '')
    .toLowerCase()
    .trim();
  if (!email) {
    throw new Error('checkout.session.completed sem e-mail do cliente');
  }

  const name = String(session.metadata?.app_user_name || 'Usuário').trim() || 'Usuário';
  const clinic = String(session.metadata?.app_user_clinic || '').trim();

  const stripeFields = stripeSubscriptionFields(sub);
  const termsFields = resolveTermsFieldsFromSession(session);

  const user = await findUserByEmail(email);
  if (user) {
    const alreadyLinked =
      String(user.stripeSubscriptionId || '').trim() === String(subscriptionId).trim();
    if (alreadyLinked) return;

    await updateUserStripeFields(user._id, {
      stripeCustomerId: String(customerId),
      stripeSubscriptionId: String(subscriptionId),
      ...stripeFields,
      ...(termsFields || {}),
    });
    await syncUserQuotaFromStripeSubscription(user._id, sub);
    if (String(user.accountType || '') === 'partner_test') {
      await updateUserStripeFields(user._id, {
        accountType: 'official',
        partnerTestExpiresAt: null,
      });
    }
    if (!skipEmails) {
      await sendSubscriptionActivatedForExistingUserEmail({
        to: email,
        loginUrl: (process.env.SUBSCRIPTION_WELCOME_LOGIN_URL || '').trim() || undefined,
      });
    }
    return;
  }

  const tempPassword = randomBytes(18).toString('base64url');
  const newUser = await createUserWithPassword({
    name,
    clinic,
    email,
    password: tempPassword,
    firstAccess: true,
  });
  await updateUserStripeFields(newUser._id, {
    stripeCustomerId: String(customerId),
    stripeSubscriptionId: String(subscriptionId),
    ...stripeSubscriptionFields(sub),
    ...(termsFields || {}),
  });
  await syncUserQuotaFromStripeSubscription(newUser._id, sub);
  await sendSubscriptionWelcomeEmail({
    to: email,
    tempPassword,
    loginUrl: (process.env.SUBSCRIPTION_WELCOME_LOGIN_URL || '').trim() || undefined,
  });
}

const TERMINAL_SUBSCRIPTION_STATUSES = new Set(['canceled', 'cancelled', 'unpaid', 'incomplete_expired']);

async function handleSubscriptionUpdated(subscription) {
  const user = await findUserByStripeSubscriptionId(subscription.id);
  if (!user) return;

  const previousStatus = user.subscriptionStatus;

  await updateUserStripeFields(user._id, {
    ...stripeSubscriptionFields(subscription),
  });

  const newStatus = String(subscription.status || '').toLowerCase();

  if (TERMINAL_SUBSCRIPTION_STATUSES.has(newStatus)) {
    await zeroUserQuota(user._id);
    return;
  }

  if (
    isQuotaRecoveryTransition(previousStatus, newStatus) &&
    subscription.items?.data?.length
  ) {
    await syncUserQuotaFromStripeSubscription(user._id, subscription);
  }
}

async function handleStripeEvent(event) {
  const existing = await ProcessedStripeEvent.findOne({ eventId: event.id });
  if (existing) return;

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await provisionUserFromCheckoutSession(event.data.object);
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await handleSubscriptionUpdated(event.data.object);
        break;
      default:
        break;
    }
    await ProcessedStripeEvent.create({ eventId: event.id });
  } catch (e) {
    console.error('[stripe webhook]', event.type, e);
    throw e;
  }
}

module.exports = {
  provisionUserFromCheckoutSession,
  handleStripeEvent,
};
