const Stripe = require('stripe');

let _stripe;

function getStripe() {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY não configurada');
    }
    _stripe = new Stripe(key);
  }
  return _stripe;
}

function isStripeConfigured() {
  return Boolean((process.env.STRIPE_SECRET_KEY || '').trim());
}

module.exports = { getStripe, isStripeConfigured };
