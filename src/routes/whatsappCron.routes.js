const express = require('express');
const router = express.Router();
const { processRemindersCron } = require('../controllers/whatsapp.controller');

function authenticateWhatsAppCron(req, res, next) {
  const expected = String(process.env.WHATSAPP_CRON_SECRET || '').trim();
  if (!expected) {
    return res.status(503).json({
      success: false,
      error: 'WHATSAPP_CRON_SECRET não configurada no servidor.',
      code: 'CRON_NOT_CONFIGURED',
    });
  }

  const header =
    req.headers['x-cron-secret'] ||
    req.headers['X-Cron-Secret'] ||
    '';
  const provided = String(header).trim();
  if (!provided || provided !== expected) {
    return res.status(401).json({
      success: false,
      error: 'Cron secret inválido.',
    });
  }

  return next();
}

router.post('/process-reminders', authenticateWhatsAppCron, processRemindersCron);

module.exports = router;
