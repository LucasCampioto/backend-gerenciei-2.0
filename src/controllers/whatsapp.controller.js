const { tenantFilter, tenantCreateFields, scopeUserId } = require('../utils/tenantScope');
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
    const data = await whatsappService.getSettings(scopeUserId(req));
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function updateSettings(req, res) {
  try {
    const data = await whatsappService.updateSettings(scopeUserId(req), req.body || {});
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function connect(req, res) {
  try {
    const data = await whatsappService.connect(scopeUserId(req));
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function getStatus(req, res) {
  try {
    const data = await whatsappService.getStatus(scopeUserId(req));
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function disconnect(req, res) {
  try {
    const data = await whatsappService.disconnect(scopeUserId(req));
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function testSend(req, res) {
  try {
    const data = await whatsappService.sendTestMessage(scopeUserId(req), {
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
    const data = await whatsappService.listReminderLogs(scopeUserId(req), req.query?.limit);
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function processRemindersCron(req, res) {
  try {
    const data = await whatsappService.processReminders();
    const results = Array.isArray(data?.results) ? data.results : [];
    // Resposta agregada para o cron externo — sem userId / detalhes por clínica.
    const summary = {
      skipped: Boolean(data?.skipped),
      ...(data?.reason ? { reason: data.reason } : {}),
      processedUsers: data?.processedUsers ?? results.length,
      sent: results.reduce((n, r) => n + (Number(r.sent) || 0), 0),
      failed: results.reduce(
        (n, r) => n + (Number(r.failed) || 0) + (r.error ? 1 : 0),
        0
      ),
      outbox: data?.outbox
        ? {
            processed: data.outbox.processed ?? 0,
            sent: data.outbox.sent ?? 0,
            failed: data.outbox.failed ?? 0,
            skipped: data.outbox.skipped ?? 0,
            ...(data.outbox.error ? { error: true } : {}),
          }
        : undefined,
      simulationSweep: data?.simulationSweep
        ? {
            queued: data.simulationSweep.queued ?? 0,
            skipped: data.simulationSweep.skipped ?? 0,
            ...(data.simulationSweep.error ? { error: true } : {}),
          }
        : undefined,
      noShowFollowUp: data?.noShowFollowUp
        ? {
            processed: data.noShowFollowUp.processed ?? 0,
            queued: data.noShowFollowUp.queued ?? 0,
            skipped: data.noShowFollowUp.skipped ?? 0,
            ...(data.noShowFollowUp.error ? { error: true } : {}),
          }
        : undefined,
    };
    return res.json({ success: true, data: summary });
  } catch (error) {
    return httpError(res, error);
  }
}

async function listCampaigns(req, res) {
  try {
    const campaignService = require('../services/whatsappCampaign.service');
    const data = await campaignService.listCampaigns(scopeUserId(req), {
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
    const data = await campaignService.getCampaignDetail(scopeUserId(req), req.params.id);
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function approveCampaign(req, res) {
  try {
    const campaignService = require('../services/whatsappCampaign.service');
    const data = await campaignService.approveCampaign(scopeUserId(req), req.params.id, {
      variantId: req.body?.variantId,
      sendAt: req.body?.sendAt,
      editedMessages: req.body?.editedMessages,
      leads: req.body?.leads,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function updateCampaignLeads(req, res) {
  try {
    const campaignService = require('../services/whatsappCampaign.service');
    const data = await campaignService.replaceCampaignLeads(
      scopeUserId(req),
      req.params.id,
      req.body?.leads
    );
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function updateCampaign(req, res) {
  try {
    const campaignService = require('../services/whatsappCampaign.service');
    const data = await campaignService.updateApprovedCampaign(scopeUserId(req), req.params.id, {
      variantId: req.body?.variantId,
      sendAt: req.body?.sendAt,
      editedMessages: req.body?.editedMessages,
      leads: req.body?.leads,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function rejectCampaign(req, res) {
  try {
    const campaignService = require('../services/whatsappCampaign.service');
    const data = await campaignService.rejectCampaign(scopeUserId(req), req.params.id);
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function cancelCampaign(req, res) {
  try {
    const campaignService = require('../services/whatsappCampaign.service');
    const data = await campaignService.cancelApprovedCampaign(scopeUserId(req), req.params.id);
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function generateCampaignsNow(req, res) {
  try {
    const campaignService = require('../services/whatsappCampaign.service');
    const data = await campaignService.generateDailyCampaigns(scopeUserId(req), { force: true });
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function listOutbox(req, res) {
  try {
    const outbox = require('../services/whatsappOutbox.service');
    const data = await outbox.listOutbox(scopeUserId(req), {
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
    const data = await whatsappService.setInstanceKey(scopeUserId(req), req.body?.instanceKey);
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
  updateCampaignLeads,
  updateCampaign,
  cancelCampaign,
  generateCampaignsNow,
  listOutbox,
};
