const { Router } = require('express');
const { createRequireAdmin } = require('../middleware/adminKey.middleware');
const {
  createPartnerTestUser,
  findUserByEmail,
  userToPublic,
} = require('../services/simulation/usersBilling');
const { sendPartnerTestWelcomeEmail } = require('../services/simulation/email');
const {
  getUsageSummary,
  getUsageByUser,
  getUsageByUserDetail,
  getUsageDaily,
  listUsageGenerations,
} = require('../services/simulation/aiUsageAnalytics');

const router = Router();
router.use(createRequireAdmin());

router.post('/partner-users', async (req, res) => {
  try {
    const {
      email,
      name,
      clinic,
      password,
      simulationCredits,
      previewCredits,
      partnerTestExpiresAt,
      partnerTestDurationDays,
    } = req.body || {};
    const em = String(email || '').toLowerCase().trim();
    const nm = String(name || '').trim();
    if (!em || !nm) {
      res.status(400).json({ message: 'email e name são obrigatórios' });
      return;
    }
    const existing = await findUserByEmail(em);
    if (existing) {
      res.status(409).json({ message: 'Já existe uma conta com este e-mail' });
      return;
    }
    const { user, plainPassword } = await createPartnerTestUser({
      name: nm,
      clinic,
      email: em,
      password: password != null && String(password).length > 0 ? password : undefined,
      simulationCredits,
      previewCredits,
      partnerTestExpiresAt,
      partnerTestDurationDays,
    });
    if (plainPassword) {
      await sendPartnerTestWelcomeEmail({
        to: em,
        tempPassword: plainPassword,
        loginUrl: (process.env.SUBSCRIPTION_WELCOME_LOGIN_URL || '').trim() || undefined,
      });
    }
    res.status(201).json({ user: userToPublic(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Erro ao criar conta parceiro' });
  }
});

router.get('/usage/summary', async (req, res) => {
  try {
    const summary = await getUsageSummary({
      from: req.query.from,
      to: req.query.to,
    });
    res.json(summary);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Erro ao carregar resumo de uso de IA' });
  }
});

router.get('/usage/by-user/:userId', async (req, res) => {
  try {
    const detail = await getUsageByUserDetail(req.params.userId, {
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit,
    });
    if (detail.error) {
      res.status(detail.status).json({ message: detail.error });
      return;
    }
    res.json(detail);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Erro ao carregar uso por usuário' });
  }
});

router.get('/usage/by-user', async (req, res) => {
  try {
    const data = await getUsageByUser({
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit,
      sort: req.query.sort,
    });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Erro ao carregar ranking de uso' });
  }
});

router.get('/usage/daily', async (req, res) => {
  try {
    const data = await getUsageDaily({
      from: req.query.from,
      to: req.query.to,
    });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Erro ao carregar série diária' });
  }
});

router.get('/usage/generations', async (req, res) => {
  try {
    const data = await listUsageGenerations({
      from: req.query.from,
      to: req.query.to,
      page: req.query.page,
      limit: req.query.limit,
      eventType: req.query.eventType,
      outcome: req.query.outcome,
      userId: req.query.userId,
    });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Erro ao listar gerações' });
  }
});

module.exports = router;
