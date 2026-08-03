const whatsappService = require('../services/whatsapp.service');

function httpError(res, error, fallbackStatus = 500) {
  const status = error.statusCode || fallbackStatus;
  return res.status(status).json({
    success: false,
    error: error.message || 'Erro interno',
    code: error.code || undefined,
  });
}

async function getSettings(req, res) {
  try {
    const data = await whatsappService.getSettings(req.userId);
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function updateSettings(req, res) {
  try {
    const data = await whatsappService.updateSettings(req.userId, req.body || {});
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function connect(req, res) {
  try {
    const data = await whatsappService.connect(req.userId);
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function getStatus(req, res) {
  try {
    const data = await whatsappService.getStatus(req.userId);
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function disconnect(req, res) {
  try {
    const data = await whatsappService.disconnect(req.userId);
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function testSend(req, res) {
  try {
    const data = await whatsappService.sendTestMessage(req.userId, {
      phone: req.body?.phone,
      nome: req.body?.nome,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function reminderLogs(req, res) {
  try {
    const data = await whatsappService.listReminderLogs(req.userId, req.query?.limit);
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function processRemindersCron(req, res) {
  try {
    const data = await whatsappService.processReminders();
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function listCampaigns(req, res) {
  try {
    const campaignService = require('../services/whatsappCampaign.service');
    const data = await campaignService.listCampaigns(req.userId, {
      dateKey: req.query?.date,
      status: req.query?.status,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function getCampaign(req, res) {
  try {
    const campaignService = require('../services/whatsappCampaign.service');
    const data = await campaignService.getCampaignDetail(req.userId, req.params.id);
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function approveCampaign(req, res) {
  try {
    const campaignService = require('../services/whatsappCampaign.service');
    const data = await campaignService.approveCampaign(req.userId, req.params.id, {
      variantId: req.body?.variantId,
      sendAt: req.body?.sendAt,
      editedMessages: req.body?.editedMessages,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function rejectCampaign(req, res) {
  try {
    const campaignService = require('../services/whatsappCampaign.service');
    const data = await campaignService.rejectCampaign(req.userId, req.params.id);
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function generateCampaignsNow(req, res) {
  try {
    const campaignService = require('../services/whatsappCampaign.service');
    const data = await campaignService.generateDailyCampaigns(req.userId, { force: true });
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function listOutbox(req, res) {
  try {
    const outbox = require('../services/whatsappOutbox.service');
    const data = await outbox.listOutbox(req.userId, {
      limit: req.query?.limit,
      kind: req.query?.kind,
      campaignId: req.query?.campaignId,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function setInstanceKey(req, res) {
  try {
    const data = await whatsappService.setInstanceKey(req.userId, req.body?.instanceKey);
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

module.exports = {
  getSettings,
  updateSettings,
  setInstanceKey,
  connect,
  getStatus,
  disconnect,
  testSend,
  reminderLogs,
  processRemindersCron,
  listCampaigns,
  getCampaign,
  approveCampaign,
  rejectCampaign,
  generateCampaignsNow,
  listOutbox,
};
