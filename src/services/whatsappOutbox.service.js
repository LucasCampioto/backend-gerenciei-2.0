const WhatsAppOutbox = require('../models/WhatsAppOutbox');
const WhatsAppSettings = require('../models/WhatsAppSettings');
const Client = require('../models/Client');
const wame = require('./wame.client');
const { stripPhoneDigits, isValidBrazilianPhone, toNationalPhoneDigits } = require('../utils/phoneMatch');

const FREQUENCY_CAP_MS = 24 * 60 * 60 * 1000;
const MAX_BATCH = 80;

function firstName(fullName = '') {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  return parts[0] || fullName || 'cliente';
}

/**
 * Contato recente = mesmo telefone (últimos 11 dígitos).
 * Não usa clientId sozinho: o lead da campanha pode ter telefone diferente
 * do cadastro e bloquearia o número certo após um envio no número errado.
 */
async function wasContactedRecently(userId, clientId, phone) {
  const since = new Date(Date.now() - FREQUENCY_CAP_MS);
  const phoneDigits = toNationalPhoneDigits(phone);
  if (phoneDigits.length < 10) return false;

  const recent = await WhatsAppOutbox.findOne({
    userId,
    status: 'sent',
    sentAt: { $gte: since },
    phone: new RegExp(`${phoneDigits}$`),
  })
    .select('_id')
    .lean();
  return Boolean(recent);
}

/**
 * Enfileira mensagem. Idempotente via dedupeKey quando informado.
 * @returns {{ queued: boolean, item?: object, reason?: string }}
 */
async function enqueue({
  userId,
  clientId = null,
  phone,
  message,
  kind,
  scheduledAt = new Date(),
  dedupeKey = '',
  campaignId = null,
  sourceRef = '',
  meta = {},
}) {
  const digits = stripPhoneDigits(phone || '');
  if (!isValidBrazilianPhone(phone) && digits.length < 10) {
    return { queued: false, reason: 'invalid_phone' };
  }

  if (clientId) {
    const client = await Client.findOne({ _id: clientId, userId })
      .select('whatsappOptOut phone name')
      .lean();
    if (client?.whatsappOptOut) {
      return { queued: false, reason: 'opt_out' };
    }
  }

  const intl = wame.toInternationalPhone(phone);
  try {
    const item = await WhatsAppOutbox.create({
      userId,
      clientId,
      phone: intl,
      message: String(message || '').trim(),
      kind,
      status: 'pending',
      scheduledAt: scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt),
      dedupeKey: dedupeKey || '',
      campaignId,
      sourceRef,
      meta,
    });
    return { queued: true, item };
  } catch (error) {
    if (error?.code === 11000) {
      return { queued: false, reason: 'duplicate' };
    }
    throw error;
  }
}

async function claimNextDue(now) {
  return WhatsAppOutbox.findOneAndUpdate(
    {
      status: 'pending',
      scheduledAt: { $lte: now },
    },
    {
      $set: { status: 'sending', lockedAt: now, error: '' },
    },
    {
      sort: { scheduledAt: 1 },
      new: true,
    }
  );
}

async function processDueOutbox({ limit = MAX_BATCH } = {}) {
  const now = new Date();
  const batchLimit = Math.min(Number(limit) || MAX_BATCH, MAX_BATCH);

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let processed = 0;

  for (let i = 0; i < batchLimit; i += 1) {
    const item = await claimNextDue(now);
    if (!item) break;
    processed += 1;

    const settings = await WhatsAppSettings.findOne({ userId: item.userId })
      .select('+wameInstanceKey status')
      .lean();
    const instanceKey = String(settings?.wameInstanceKey || '').trim();

    if (!settings || settings.status !== 'connected' || !instanceKey) {
      item.status = 'skipped';
      item.error = !instanceKey ? 'wame_not_configured' : 'whatsapp_not_connected';
      item.lockedAt = null;
      await item.save();
      skipped += 1;
      continue;
    }

    // Campanhas aprovadas pelo usuário não entram no teto de 24h —
    // senão a 2ª campanha do dia some como "Pulado" (frequency_cap).
    if (
      item.kind !== 'daily_campaign' &&
      (await wasContactedRecently(item.userId, item.clientId, item.phone))
    ) {
      item.status = 'skipped';
      item.error = 'frequency_cap_24h';
      item.lockedAt = null;
      await item.save();
      skipped += 1;
      continue;
    }

    if (item.clientId) {
      const client = await Client.findOne({ _id: item.clientId, userId: item.userId })
        .select('whatsappOptOut')
        .lean();
      if (client?.whatsappOptOut) {
        item.status = 'skipped';
        item.error = 'opt_out';
        item.lockedAt = null;
        await item.save();
        skipped += 1;
        continue;
      }
    }

    try {
      await wame.sendText(item.phone, item.message, instanceKey);
      item.status = 'sent';
      item.sentAt = new Date();
      item.error = '';
      item.lockedAt = null;
      await item.save();
      sent += 1;

      if (item.campaignId) {
        await mongooseBumpCampaignStat(item.campaignId, 'sent');
      }
    } catch (error) {
      item.status = 'failed';
      item.error = error.message || 'send_failed';
      item.lockedAt = null;
      await item.save();
      failed += 1;
      if (error.code === 'WAME_NOT_CONNECTED') {
        await WhatsAppSettings.updateOne(
          { userId: item.userId },
          { $set: { status: 'disconnected', connectedPhone: '', lastQr: '' } }
        );
      }
      if (item.campaignId) {
        await mongooseBumpCampaignStat(item.campaignId, 'failed');
      }
    }
  }

  return { processed, sent, failed, skipped };
}

async function mongooseBumpCampaignStat(campaignId, field) {
  try {
    const WhatsAppCampaign = require('../models/WhatsAppCampaign');
    await WhatsAppCampaign.updateOne(
      { _id: campaignId },
      { $inc: { [`stats.${field}`]: 1 } }
    );
  } catch {
    /* ignore */
  }
}

async function listOutbox(userId, { limit = 40, kind, campaignId } = {}) {
  const query = { userId };
  if (kind) query.kind = kind;
  if (campaignId) query.campaignId = campaignId;
  const rows = await WhatsAppOutbox.find(query)
    .sort({ sentAt: -1, scheduledAt: -1, createdAt: -1 })
    .limit(Math.min(Number(limit) || 40, 200))
    .lean();

  const clientIds = [
    ...new Set(rows.map((r) => (r.clientId ? String(r.clientId) : '')).filter(Boolean)),
  ];
  const clients = clientIds.length
    ? await Client.find({ userId, _id: { $in: clientIds } })
        .select('_id name phone')
        .lean()
    : [];
  const byId = new Map(clients.map((c) => [String(c._id), c]));

  return rows.map((row) => {
    const client = row.clientId ? byId.get(String(row.clientId)) : null;
    return {
      id: String(row._id),
      status: row.status,
      phone: row.phone || '',
      name: client?.name || row.meta?.name || row.meta?.clientName || '',
      message: row.message || '',
      kind: row.kind,
      scheduledAt: row.scheduledAt || null,
      sentAt: row.sentAt || null,
      error: row.error || '',
      campaignId: row.campaignId ? String(row.campaignId) : null,
      createdAt: row.createdAt || null,
    };
  });
}

/**
 * Disparos de uma campanha com nome do cliente (para auditoria na UI).
 */
async function listCampaignDispatches(userId, campaignId, { limit = 100 } = {}) {
  if (!campaignId) return [];
  return listOutbox(userId, {
    campaignId,
    limit: Math.min(Number(limit) || 100, 200),
  });
}

function campaignDedupeKey(campaignId, lead) {
  if (lead?.clientId) return `campaign:${campaignId}:${lead.clientId}`;
  const digits = stripPhoneDigits(lead?.phone || '');
  return `campaign:${campaignId}:p:${digits}`;
}

/**
 * Cancela disparos reabríveis da campanha (libera dedupeKey para reenfileirar).
 * Por padrão: pending. Também pode incluir skipped/failed após edição.
 */
async function cancelPendingForCampaign(userId, campaignId, { alsoStatuses = [] } = {}) {
  if (!campaignId) return { cancelled: 0 };
  const statuses = ['pending', ...alsoStatuses.filter((s) => s && s !== 'pending')];

  // Libera chaves de cancelados antigos para permitir reenfileirar o mesmo contato.
  await WhatsAppOutbox.updateMany(
    { userId, campaignId, status: 'cancelled', dedupeKey: { $gt: '' } },
    { $set: { dedupeKey: '' } }
  );

  // Reclaim sending travado (>5 min) como cancelável
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
  await WhatsAppOutbox.updateMany(
    {
      userId,
      campaignId,
      status: 'sending',
      lockedAt: { $lte: staleBefore },
    },
    {
      $set: {
        status: 'cancelled',
        error: 'campaign_updated_stale_sending',
        lockedAt: null,
        dedupeKey: '',
      },
    }
  );

  const result = await WhatsAppOutbox.updateMany(
    { userId, campaignId, status: { $in: statuses } },
    {
      $set: {
        status: 'cancelled',
        error: 'campaign_updated',
        lockedAt: null,
        dedupeKey: '',
      },
    }
  );
  return { cancelled: result.modifiedCount || 0 };
}

/**
 * Lista itens pending/sent da campanha (para sincronizar edição pós-aprovação).
 */
async function listCampaignOutboxRaw(userId, campaignId) {
  if (!campaignId) return [];
  return WhatsAppOutbox.find({ userId, campaignId })
    .select('status dedupeKey clientId phone message scheduledAt meta')
    .lean();
}

module.exports = {
  FREQUENCY_CAP_MS,
  firstName,
  wasContactedRecently,
  enqueue,
  processDueOutbox,
  listOutbox,
  listCampaignDispatches,
  campaignDedupeKey,
  cancelPendingForCampaign,
  listCampaignOutboxRaw,
};
