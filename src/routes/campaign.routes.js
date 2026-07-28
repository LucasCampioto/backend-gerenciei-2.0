const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  list,
  getOne,
  stats,
  create,
  themeSuggestions,
  generate,
  update,
  publish,
  remove,
  removeLead,
  generateLeadSimulation,
} = require('../controllers/campaign.controller');

router.use(authenticate);

router.get('/', list);
router.post('/', create);
router.post('/theme-suggestions', themeSuggestions);
router.get('/:id/stats', stats);
router.delete('/:id/leads/:leadId', removeLead);
router.post('/:id/leads/:leadId/generate-simulation', generateLeadSimulation);
router.get('/:id', getOne);
router.put('/:id', update);
router.delete('/:id', remove);
router.post('/:id/generate', generate);
router.post('/:id/publish', publish);

module.exports = router;
