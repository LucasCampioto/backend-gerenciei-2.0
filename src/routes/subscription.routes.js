const { Router } = require('express');
const { isStripeConfigured, getStripe } = require('../services/simulation/stripeClient');
const { listPlans } = require('../services/simulation/subscriptionPlans');
const { createSubscriptionCheckoutSession } = require('../services/simulation/checkoutSessions');
const {
  findUserByEmail,
  findUserById,
  findUserByStripeSubscriptionId,
} = require('../services/simulation/usersBilling');
const { LEGAL_VERSION } = require('../legal/version');
const {
  createBillingPortalSessionForUser,
  getCurrentSubscriptionSummary,
} = require('../services/simulation/subscriptionManagement');
const { provisionUserFromCheckoutSession } = require('../services/simulation/subscriptionWebhook');
const { authenticate } = require('../middleware/auth.middleware');
const { isSubscriptionBypassUser } = require('../services/simulation/subscriptionBypass');
const { resolvePlanTier } = require('../services/simulation/planEntitlements');
const User = require('../models/User');

function localSubscriptionSummary(user) {
  const subscriptionId = String(user.stripeSubscriptionId || '').trim();
  const customerId = String(user.stripeCustomerId || '').trim();
  return {
    hasSubscription: Boolean(subscriptionId && customerId),
    status: user.subscriptionStatus || 'none',
    subscriptionId: subscriptionId || null,
    customerId: customerId || null,
    trialEndsAt: user.trialEndsAt ? user.trialEndsAt.toISOString() : null,
    cancelAtPeriodEnd: user.cancelAtPeriodEnd === true,
    currentPeriodEnd: user.currentPeriodEnd ? user.currentPeriodEnd.toISOString() : null,
    currentPrice: null,
    planTier: resolvePlanTier(user),
  };
}

function bypassSubscriptionSummary(user) {
  return {
    hasSubscription: true,
    status: 'active',
    subscriptionId: null,
    customerId: null,
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    currentPrice: {
      id: 'admin_bypass',
      nickname: 'Administrador',
      currency: null,
      amountCents: null,
      recurringInterval: null,
      recurringIntervalCount: null,
      productId: null,
      productName: 'Conta administrador (sem cobrança)',
    },
    billingBypass: true,
    planTier: resolvePlanTier(user),
  };
}

function loginUrlDefault() {
  const explicit = (process.env.FRONTEND_LOGIN_URL || '').trim();
  if (explicit) return explicit;
  const origin = (process.env.CORS_ORIGIN || '').trim() || 'http://localhost:8080';
  return `${origin.replace(/\/$/, '')}/login`;
}

const router = Router();

router.get('/plans', async (_req, res) => {
  try {
    if (!isStripeConfigured()) {
      res.status(503).json({ message: 'Pagamentos não configurados (STRIPE_SECRET_KEY)' });
      return;
    }
    const plans = await listPlans();
    res.json(plans);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Erro ao listar planos' });
  }
});

router.post('/checkout', async (req, res) => {
  try {
    if (!isStripeConfigured()) {
      res.status(503).json({ message: 'Pagamentos não configurados (STRIPE_SECRET_KEY)' });
      return;
    }
    const {
      email,
      name,
      clinic,
      priceId,
      trialPeriodDays,
      checkoutUi,
      promotionCode,
      termsAccepted,
      termsVersion,
      patientDataResponsibilityAck,
    } = req.body || {};
    if (!email || !name || !priceId) {
      res.status(400).json({ message: 'email, name e priceId são obrigatórios' });
      return;
    }
    if (termsAccepted !== true) {
      res.status(400).json({ message: 'É necessário aceitar os Termos de Uso e a Política de Privacidade.' });
      return;
    }
    if (patientDataResponsibilityAck !== true) {
      res.status(400).json({
        message: 'É necessário declarar responsabilidade sobre o consentimento dos pacientes.',
      });
      return;
    }
    const effectiveTermsVersion = String(termsVersion || LEGAL_VERSION).trim();
    if (effectiveTermsVersion !== LEGAL_VERSION) {
      res.status(400).json({ message: 'Versão dos termos desatualizada. Recarregue a página e tente novamente.' });
      return;
    }
    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      res.status(409).json({
        message:
          'Já existe uma conta com este e-mail. Faça login para gerenciar ou ativar sua assinatura.',
        loginUrl: loginUrlDefault(),
      });
      return;
    }

    const ui = checkoutUi === 'embedded' ? 'embedded' : 'hosted';
    const envTrial = Number(process.env.TRIAL_PERIOD_DAYS);
    const bodyTrial = Number(trialPeriodDays);
    const effectiveTrialPeriodDays = Number.isFinite(bodyTrial)
      ? bodyTrial
      : Number.isFinite(envTrial)
        ? envTrial
        : undefined;

    const result = await createSubscriptionCheckoutSession({
      email,
      name,
      clinic,
      priceId,
      trialPeriodDays: effectiveTrialPeriodDays,
      checkoutUi: ui,
      promotionCode,
      termsVersion: effectiveTermsVersion,
      termsAcceptedAt: new Date().toISOString(),
    });

    if (ui === 'embedded') {
      if (!result.clientSecret) {
        res.status(500).json({ message: 'Sessão embedded sem client_secret' });
        return;
      }
      res.status(201).json({ clientSecret: result.clientSecret, sessionId: result.sessionId });
      return;
    }

    if (!result.url) {
      res.status(500).json({ message: 'Sessão de checkout sem URL' });
      return;
    }
    res.status(201).json({ url: result.url, sessionId: result.sessionId });
  } catch (e) {
    console.error(e);
    const msg = e.message || 'Erro ao criar checkout';
    if (msg.includes('inválido') || msg.includes('indisponível')) {
      res.status(400).json({ message: msg });
      return;
    }
    if (msg.includes('STRIPE_SUCCESS_URL') || msg.includes('STRIPE_CANCEL_URL')) {
      res.status(503).json({ message: msg });
      return;
    }
    if (msg.includes('STRIPE_RETURN_URL')) {
      res.status(503).json({ message: msg });
      return;
    }
    if (msg.includes('Cupom')) {
      res.status(400).json({ message: msg });
      return;
    }
    res.status(500).json({ message: 'Erro ao criar sessão de pagamento' });
  }
});

/** Parceiro/influenciador: ativa plano pago sem período trial (utilizador já autenticado). */
router.post('/checkout-official', authenticate, async (req, res) => {
  try {
    if (!isStripeConfigured()) {
      res.status(503).json({ message: 'Pagamentos não configurados (STRIPE_SECRET_KEY)' });
      return;
    }
    const user = await findUserById(req.userId);
    if (!user) {
      res.status(404).json({ message: 'Usuário não encontrado' });
      return;
    }
    if (String(user.accountType || '') !== 'partner_test') {
      res.status(403).json({ message: 'Disponível apenas para contas parceiro (teste)' });
      return;
    }
    if (String(user.stripeSubscriptionId || '').trim()) {
      res.status(409).json({ message: 'Conta já possui assinatura ativa ou em processamento' });
      return;
    }
    const { priceId, checkoutUi, promotionCode } = req.body || {};
    if (!priceId) {
      res.status(400).json({ message: 'priceId é obrigatório' });
      return;
    }
    const ui = checkoutUi === 'embedded' ? 'embedded' : 'hosted';
    const linkedCust = String(user.stripeCustomerId || '').trim() || null;
    const result = await createSubscriptionCheckoutSession({
      email: user.email,
      name: user.name,
      clinic: user.clinic,
      priceId,
      checkoutUi: ui,
      skipTrial: true,
      stripeCustomerId: linkedCust,
      promotionCode,
    });
    if (ui === 'embedded') {
      if (!result.clientSecret) {
        res.status(500).json({ message: 'Sessão embedded sem client_secret' });
        return;
      }
      res.status(201).json({ clientSecret: result.clientSecret, sessionId: result.sessionId });
      return;
    }
    if (!result.url) {
      res.status(500).json({ message: 'Sessão de checkout sem URL' });
      return;
    }
    res.status(201).json({ url: result.url, sessionId: result.sessionId });
  } catch (e) {
    console.error(e);
    const msg = e.message || 'Erro ao criar checkout';
    if (msg.includes('inválido') || msg.includes('indisponível')) {
      res.status(400).json({ message: msg });
      return;
    }
    if (msg.includes('STRIPE_SUCCESS_URL') || msg.includes('STRIPE_CANCEL_URL')) {
      res.status(503).json({ message: msg });
      return;
    }
    if (msg.includes('STRIPE_RETURN_URL')) {
      res.status(503).json({ message: msg });
      return;
    }
    if (msg.includes('Cupom')) {
      res.status(400).json({ message: msg });
      return;
    }
    res.status(500).json({ message: 'Erro ao criar sessão de pagamento' });
  }
});

/** Só Stripe: sessão paga/complete. Não reflete webhook nem utilizador em MongoDB. */
router.get('/checkout-session/status', async (req, res) => {
  try {
    if (!isStripeConfigured()) {
      res.status(503).json({ subscription: false });
      return;
    }
    const sessionId = String(req.query.session_id || '').trim();
    if (!sessionId.startsWith('cs_') || sessionId.length < 10) {
      res.status(200).json({ subscription: false });
      return;
    }
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    const active =
      session.mode === 'subscription' &&
      session.status === 'complete' &&
      (session.payment_status === 'paid' || session.payment_status === 'no_payment_required');
    res.json({ subscription: active });
  } catch (e) {
    console.error('[checkout-session/status]', e?.message ?? e);
    res.json({ subscription: false });
  }
});

/**
 * Stripe + MongoDB: utilizador já tem stripeSubscriptionId da sessão.
 * Para a página de retorno do embedded checkout.
 */
router.get('/checkout-session/provisioned', async (req, res) => {
  try {
    if (!isStripeConfigured()) {
      res.status(503).json({ provisioned: false, phase: 'unavailable' });
      return;
    }
    const sessionId = String(req.query.session_id || '').trim();
    if (!sessionId.startsWith('cs_') || sessionId.length < 10) {
      res.status(200).json({ provisioned: false, phase: 'invalid_session' });
      return;
    }
    let session;
    try {
      session = await getStripe().checkout.sessions.retrieve(sessionId);
    } catch (e) {
      console.error('[checkout-session/provisioned] retrieve', e?.message ?? e);
      res.status(200).json({ provisioned: false, phase: 'invalid_session' });
      return;
    }

    const paymentOk =
      session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
    const checkoutOk = session.mode === 'subscription' && session.status === 'complete' && paymentOk;
    if (!checkoutOk) {
      res.status(200).json({ provisioned: false, phase: 'invalid_session' });
      return;
    }

    const subRef = session.subscription;
    const subscriptionId =
      typeof subRef === 'string' && subRef.trim()
        ? subRef.trim()
        : subRef && typeof subRef === 'object' && 'id' in subRef && subRef.id
          ? String(subRef.id).trim()
          : '';
    if (!subscriptionId) {
      res.status(200).json({ provisioned: false, phase: 'provisioning' });
      return;
    }

    let user = await findUserByStripeSubscriptionId(subscriptionId);
    if (user) {
      res.json({ provisioned: true });
      return;
    }

    try {
      await provisionUserFromCheckoutSession(session, { skipEmails: true });
      user = await findUserByStripeSubscriptionId(subscriptionId);
      if (user) {
        res.json({ provisioned: true });
        return;
      }
    } catch (e) {
      console.error('[checkout-session/provisioned] fallback provision', e?.message ?? e);
    }

    res.json({ provisioned: false, phase: 'provisioning' });
  } catch (e) {
    console.error('[checkout-session/provisioned]', e?.message ?? e);
    res.status(200).json({ provisioned: false, phase: 'provisioning' });
  }
});

router.get('/current', authenticate, async (req, res) => {
  try {
    const user = await findUserById(req.userId);
    if (!user) {
      res.status(404).json({ message: 'Usuário não encontrado' });
      return;
    }

    // Contas admin (SUBSCRIPTION_BYPASS_USER_IDS): isentas de Stripe/assinatura.
    if (isSubscriptionBypassUser(user)) {
      res.json(bypassSubscriptionSummary(user));
      return;
    }

    if (!isStripeConfigured()) {
      const subscriptionId = String(user.stripeSubscriptionId || '').trim();
      const customerId = String(user.stripeCustomerId || '').trim();
      // Sem Stripe: ainda dá para refletir estado local (ex.: sem assinatura).
      if (!subscriptionId || !customerId) {
        res.json(localSubscriptionSummary(user));
        return;
      }
      res.status(503).json({ message: 'Pagamentos não configurados (STRIPE_SECRET_KEY)' });
      return;
    }

    const current = await getCurrentSubscriptionSummary(user);
    res.json(current);
  } catch (e) {
    console.error(e);
    const msg = e.message || '';
    if (msg.includes('No such subscription')) {
      res.status(404).json({ message: 'Assinatura não encontrada no Stripe' });
      return;
    }
    res.status(500).json({ message: 'Erro ao carregar assinatura atual' });
  }
});

router.post('/portal', authenticate, async (req, res) => {
  try {
    const user = await findUserById(req.userId);
    if (!user) {
      res.status(404).json({ message: 'Usuário não encontrado' });
      return;
    }

    if (isSubscriptionBypassUser(user)) {
      res.status(400).json({ message: 'Conta administrador não utiliza portal de cobrança.' });
      return;
    }

    if (!isStripeConfigured()) {
      res.status(503).json({ message: 'Pagamentos não configurados (STRIPE_SECRET_KEY)' });
      return;
    }

    const portal = await createBillingPortalSessionForUser(user);
    res.status(201).json(portal);
  } catch (e) {
    console.error(e);
    const msg = e.message || 'Erro ao abrir portal de assinatura';
    if (msg.includes('sem cliente Stripe')) {
      res.status(400).json({ message: msg });
      return;
    }
    if (msg.includes('STRIPE_BILLING_PORTAL_RETURN_URL')) {
      res.status(503).json({ message: msg });
      return;
    }
    res.status(500).json({ message: 'Erro ao abrir portal de assinatura' });
  }
});

/** Admin-only: simula plano (gestao/profissional/…) sem Stripe. */
router.put('/simulate-plan-tier', authenticate, async (req, res) => {
  try {
    const user = await findUserById(req.userId);
    if (!user) {
      res.status(404).json({ message: 'Usuário não encontrado' });
      return;
    }
    if (!isSubscriptionBypassUser(user)) {
      res.status(403).json({ message: 'Apenas conta administrador pode simular plano.' });
      return;
    }

    const allowed = new Set(['gestao', 'profissional', 'enterprise', 'legado']);
    const tier = String(req.body?.planTier || '')
      .trim()
      .toLowerCase();
    if (!allowed.has(tier)) {
      res.status(400).json({
        message: 'planTier inválido. Use: gestao, profissional, enterprise ou legado.',
      });
      return;
    }

    await User.findByIdAndUpdate(user._id, { $set: { planTier: tier } });
    const updated = await findUserById(req.userId);
    res.json({
      success: true,
      planTier: tier,
      subscription: bypassSubscriptionSummary(updated),
    });
  } catch (e) {
    console.error('[simulate-plan-tier]', e?.message ?? e);
    res.status(500).json({ message: 'Erro ao simular plano' });
  }
});

module.exports = router;
