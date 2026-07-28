const { getStripe } = require('./stripeClient');

/** IDs permitidos (opcional). Se vazio, lista preços recorrentes ativos. */
function getConfiguredPriceIds() {
  const raw = process.env.STRIPE_PRICE_IDS || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function priceToDto(price) {
  const product = price.product;
  const productName =
    typeof product === 'object' && product && !product.deleted ? product.name || 'Plano' : 'Plano';
  const recurring = price.recurring;
  const trialFromMeta = price.metadata?.trial_period_days
    ? Number(price.metadata.trial_period_days)
    : 0;
  return {
    id: price.id,
    productName,
    unitAmount: price.unit_amount,
    currency: price.currency,
    interval: recurring?.interval || null,
    intervalCount: recurring?.interval_count || 1,
    trialPeriodDays: Number.isFinite(trialFromMeta) && trialFromMeta > 0 ? trialFromMeta : 0,
  };
}

async function listPlans() {
  const stripe = getStripe();
  const configured = getConfiguredPriceIds();

  if (configured.length > 0) {
    const prices = await Promise.all(configured.map((id) => stripe.prices.retrieve(id, { expand: ['product'] })));
    const active = prices.filter((p) => p.active && p.type === 'recurring');
    return active.map(priceToDto);
  }

  const list = await stripe.prices.list({
    active: true,
    type: 'recurring',
    limit: 30,
    expand: ['data.product'],
  });
  return list.data.map(priceToDto);
}

async function isAllowedPriceId(priceId) {
  const id = String(priceId || '').trim();
  if (!id) return false;
  const configured = getConfiguredPriceIds();
  if (configured.length > 0) return configured.includes(id);
  try {
    const p = await getStripe().prices.retrieve(id);
    return p.active === true && p.type === 'recurring';
  } catch {
    return false;
  }
}

module.exports = {
  getConfiguredPriceIds,
  listPlans,
  isAllowedPriceId,
};
