const WhatsAppSettings = require('../models/WhatsAppSettings');
const Client = require('../models/Client');
const outbox = require('./whatsappOutbox.service');
const { stripPhoneDigits, isValidBrazilianPhone } = require('../utils/phoneMatch');

const DELAY_MS_MIN = 60_000;
const DELAY_MS_MAX = 180_000;
const SWEEP_LIMIT = 30;

function renderTemplate(template, vars = {}) {
  return String(template || '')
    .replace(/\{\{\s*nome\s*\}\}/gi, vars.nome || '')
    .replace(/\{\{\s*procedimento\s*\}\}/gi, vars.procedimento || '');
}

function randomDelayMs() {
  return DELAY_MS_MIN + Math.floor(Math.random() * (DELAY_MS_MAX - DELAY_MS_MIN));
}

function procedureHint(client) {
  const list = client?.qualification?.procedureInterest;
  if (Array.isArray(list) && list.length && String(list[0] || '').trim()) {
    return String(list[0]).trim();
  }
  return 'procedimento';
}

/**
 * Enfileira convite de simulação para lead com interesse alto (quente).
 * Fire-and-forget safe.
 */
async function enqueueSimulationInvite(userId, clientId, { immediate = false } = {}) {
  try {
    const settings = await WhatsAppSettings.findOne({ userId });
    if (!settings?.simulationInviteEnabled) {
      return { queued: false, reason: 'disabled' };
    }
    if (settings.status !== 'connected') {
      return { queued: false, reason: 'not_connected' };
    }

    const client = await Client.findOne({ _id: clientId, userId })
      .select('name phone whatsappOptOut leadTemperature qualification')
      .lean();
    if (!client?.phone) return { queued: false, reason: 'no_client' };
    if (client.whatsappOptOut) return { queued: false, reason: 'opt_out' };
    if (client.leadTemperature !== 'quente') {
      return { queued: false, reason: 'not_hot' };
    }
    if (
      !isValidBrazilianPhone(client.phone) &&
      stripPhoneDigits(client.phone).length < 10
    ) {
      return { queued: false, reason: 'invalid_phone' };
    }

    const template =
      String(settings.simulationInviteTemplate || '').trim() ||
      WhatsAppSettings.DEFAULT_SIMULATION_INVITE_TEMPLATE;
    const message = renderTemplate(template, {
      nome: outbox.firstName(client.name),
      procedimento: procedureHint(client),
    });
    if (!message.trim()) return { queued: false, reason: 'empty_message' };

    const scheduledAt = immediate
      ? new Date()
      : new Date(Date.now() + randomDelayMs());

    return outbox.enqueue({
      userId,
      clientId: client._id,
      phone: client.phone,
      message,
      kind: 'simulation_invite',
      scheduledAt,
      dedupeKey: `simulation_invite:${client._id}`,
      sourceRef: String(client._id),
      meta: { temperature: 'quente' },
    });
  } catch (error) {
    console.warn('[whatsappSimulation] enqueue failed:', error.message);
    return { queued: false, reason: 'error', error: error.message };
  }
}

/**
 * Varre leads quentes elegíveis e enfileira convites (idempotente via dedupe).
 */
async function sweepSimulationInvites({ limit = SWEEP_LIMIT } = {}) {
  const eligibleSettings = await WhatsAppSettings.find({
    simulationInviteEnabled: true,
    status: 'connected',
  })
    .select('userId')
    .lean();

  let queued = 0;
  let skipped = 0;

  for (const settings of eligibleSettings) {
    const clients = await Client.find({
      userId: settings.userId,
      leadTemperature: 'quente',
      whatsappOptOut: { $ne: true },
      phone: { $exists: true, $nin: [null, ''] },
      pipelineStage: { $nin: ['won', 'lost'] },
    })
      .select('_id')
      .limit(limit)
      .lean();

    for (const client of clients) {
      const result = await enqueueSimulationInvite(settings.userId, client._id, {
        immediate: true,
      });
      if (result.queued) queued += 1;
      else skipped += 1;
    }
  }

  return { queued, skipped, users: eligibleSettings.length };
}

module.exports = {
  renderTemplate,
  enqueueSimulationInvite,
  sweepSimulationInvites,
};
