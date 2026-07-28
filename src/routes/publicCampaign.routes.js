const express = require('express');
const router = express.Router();
const {
  publicGet,
  publicLead,
  publicLeadPhoto,
  publicEvent,
} = require('../controllers/campaign.controller');

router.get('/:slug', publicGet);
router.post('/:slug/leads', publicLead);
router.post('/:slug/leads/:leadId/photo', publicLeadPhoto);
router.post('/:slug/events', publicEvent);

module.exports = router;
