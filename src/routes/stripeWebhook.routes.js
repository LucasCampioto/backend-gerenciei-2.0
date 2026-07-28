const { getStripe, isStripeConfigured } = require('../services/simulation/stripeClient');
const { handleStripeEvent } = require('../services/simulation/subscriptionWebhook');

async function stripeWebhookHandler(req, res) {
  if (!isStripeConfigured()) {
    res.status(503).json({ message: 'STRIPE_SECRET_KEY não configurada' });
    return;
  }
  const secret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!secret) {
    res.status(500).json({ message: 'STRIPE_WEBHOOK_SECRET não configurada' });
    return;
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    res.status(400).json({ message: 'Assinatura ausente' });
    return;
  }

  let event;
  try {
    const rawBody = req.body;
    if (!Buffer.isBuffer(rawBody)) {
      res.status(400).json({ message: 'Body inválido' });
      return;
    }
    event = getStripe().webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    console.error('[stripe webhook] assinatura', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    await handleStripeEvent(event);
    res.json({ received: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Erro ao processar evento' });
  }
}

module.exports = { stripeWebhookHandler };
