const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  getSettings,
  updateSettings,
  setInstanceKey,
  connect,
  getStatus,
  disconnect,
  testSend,
  reminderLogs,
  listCampaigns,
  getCampaign,
  approveCampaign,
  rejectCampaign,
  generateCampaignsNow,
  listOutbox,
} = require('../controllers/whatsapp.controller');

router.use(authenticate);

router.get('/settings', getSettings);
router.put('/settings', updateSettings);
router.put('/instance-key', setInstanceKey);
router.post('/connect', connect);
router.get('/status', getStatus);
router.post('/disconnect', disconnect);
router.post('/test-send', testSend);
router.get('/reminder-logs', reminderLogs);
router.get('/outbox', listOutbox);
router.get('/campaigns', listCampaigns);
router.post('/campaigns/generate', generateCampaignsNow);
router.get('/campaigns/:id', getCampaign);
router.post('/campaigns/:id/approve', approveCampaign);
router.post('/campaigns/:id/reject', rejectCampaign);

module.exports = router;
