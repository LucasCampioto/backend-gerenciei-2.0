const { getStripe } = require('./stripeClient');
const { isAllowedPriceId } = require('./subscriptionPlans');

function normalizeEmail(email) {
  return String(email || '').toLowerCase().trim();
}

async function resolveStripeCustomerId(stripe, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const customers = await stripe.customers.list({ email: normalizedEmail, limit: 10 });
  if (!customers?.data?.length) return null;

  const activeCustomer = customers.data.find((customer) => !customer.deleted);
  return activeCustomer ? String(activeCustomer.id) : null;
}

async function resolvePromotionCodeId(stripe, rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) return null;
  const list = await stripe.promotionCodes.list({ code, limit: 5, active: true });
  const promo = list.data.find((pc) => pc.active === true && String(pc.code) === code);
  if (!promo) {
    throw new Error('Cupom inválido ou inativo');
  }
  return promo.id;
}

/** Se `promotionCode` vem preenchido, aplica esse cupom; senão permite inserir no UI do Stripe. */
async function buildCheckoutPromoFields(stripe, promotionCode) {
  const trimmed = String(promotionCode || '').trim();
  if (trimmed) {
    const id = await resolvePromotionCodeId(stripe, trimmed);
    return { discounts: [{ promotion_code: id }] };
  }
  return { allow_promotion_codes: true };
}

/**
 * @param {object} params
 * @param {string} params.email
 * @param {string} params.name
 * @param {string} [params.clinic]
 * @param {string} params.priceId
 * @param {number} [params.trialPeriodDays]
 * @param {'hosted'|'embedded'} [params.checkoutUi]
 * @param {boolean} [params.skipTrial] — se true, não envia trial_period_days (ex.: upgrade parceiro)
 * @param {string} [params.stripeCustomerId] — customer existente (Mongo); tem prioridade sobre busca por e-mail
 * @param {string} [params.promotionCode] — código promocional Stripe (opcional)
 * @param {string} [params.termsVersion]
 * @param {string} [params.termsAcceptedAt] — ISO
 */
async function createSubscriptionCheckoutSession({
  email,
  name,
  clinic,
  priceId,
  trialPeriodDays,
  checkoutUi = 'hosted',
  skipTrial = false,
  stripeCustomerId: linkedStripeCustomerId = null,
  promotionCode = null,
  termsVersion = null,
  termsAcceptedAt = null,
}) {
  const allowed = await isAllowedPriceId(priceId);
  if (!allowed) {
    throw new Error('Plano inválido ou indisponível');
  }

  const stripe = getStripe();
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error('E-mail inválido');
  }

  let customerId = linkedStripeCustomerId != null ? String(linkedStripeCustomerId).trim() : '';
  if (!customerId) {
    customerId = (await resolveStripeCustomerId(stripe, normalizedEmail)) || '';
  }

  const metadata = {
    app_user_name: String(name || '').trim() || 'Usuário',
    app_user_clinic: String(clinic || '').trim(),
  };
  if (termsVersion) metadata.app_terms_version = String(termsVersion).trim();
  if (termsAcceptedAt) metadata.app_terms_accepted_at = String(termsAcceptedAt).trim();

  const subscriptionData = {
    metadata: { ...metadata },
  };
  if (!skipTrial) {
    const trial = trialPeriodDays != null ? Number(trialPeriodDays) : NaN;
    if (Number.isFinite(trial) && trial > 0) {
      subscriptionData.trial_period_days = Math.min(Math.floor(trial), 730);
    }
  }

  const baseParams = {
    mode: 'subscription',
    line_items: [{ price: String(priceId).trim(), quantity: 1 }],
    metadata,
    subscription_data: subscriptionData,
  };
  if (customerId) {
    baseParams.customer = customerId;
  } else {
    baseParams.customer_email = normalizedEmail;
  }

  const promoFields = await buildCheckoutPromoFields(stripe, promotionCode);

  if (checkoutUi === 'embedded') {
    const returnUrl = process.env.STRIPE_RETURN_URL;
    if (!returnUrl || !returnUrl.includes('{CHECKOUT_SESSION_ID}')) {
      throw new Error(
        'STRIPE_RETURN_URL é obrigatório no .env para checkout embedded (inclua {CHECKOUT_SESSION_ID})',
      );
    }
    const session = await stripe.checkout.sessions.create({
      ...baseParams,
      ...promoFields,
      ui_mode: 'embedded',
      return_url: returnUrl,
    });
    const clientSecret = session.client_secret;
    if (!clientSecret) {
      throw new Error('Sessão embedded sem client_secret');
    }
    return { clientSecret, sessionId: session.id };
  }

  const successUrl = process.env.STRIPE_SUCCESS_URL;
  const cancelUrl = process.env.STRIPE_CANCEL_URL;
  if (!successUrl || !cancelUrl) {
    throw new Error('STRIPE_SUCCESS_URL e STRIPE_CANCEL_URL são obrigatórios no .env');
  }

  const session = await stripe.checkout.sessions.create({
    ...baseParams,
    ...promoFields,
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  return { url: session.url, sessionId: session.id };
}

module.exports = { createSubscriptionCheckoutSession };
