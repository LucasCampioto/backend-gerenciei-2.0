const { Router } = require('express');
const { getPricingBase, upsertPricingBase } = require('../services/simulation/pricingBases');
const { authenticate } = require('../middleware/auth.middleware');

const router = Router();
router.use(authenticate);

router.get('/pricing-bases/:procedureId', async (req, res) => {
  try {
    const procedureId = String(req.params.procedureId || '').trim();
    if (!procedureId) {
      res.status(400).json({ message: 'procedureId é obrigatório' });
      return;
    }
    const pricingBase = await getPricingBase(req.userId, procedureId);
    res.json({ pricingBase });
  } catch (e) {
    console.error('[pricing-bases GET]', e);
    res.status(500).json({ message: 'Erro ao buscar simulação base' });
  }
});

router.put('/pricing-bases/:procedureId', async (req, res) => {
  try {
    const procedureId = String(req.params.procedureId || '').trim();
    if (!procedureId) {
      res.status(400).json({ message: 'procedureId é obrigatório' });
      return;
    }
    const pricingBase = await upsertPricingBase(req.userId, procedureId, req.body || {});
    res.json({ pricingBase });
  } catch (e) {
    console.error('[pricing-bases PUT]', e);
    res.status(500).json({ message: 'Erro ao salvar simulação base' });
  }
});

module.exports = router;
