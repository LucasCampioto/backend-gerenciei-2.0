const Sale = require('../models/Sale');
const Client = require('../models/Client');
const WhatsAppSettings = require('../models/WhatsAppSettings');
const outbox = require('./whatsappOutbox.service');
const { stripPhoneDigits, isValidBrazilianPhone } = require('../utils/phoneMatch');

const CLINIC_TZ = 'America/Sao_Paulo';
/** Disparo diário a partir das 11h (America/Sao_Paulo). */
const INACTIVE_RETURN_HOUR_SP = 11;
/** Limite por clínica por passagem do cron (evita blast massivo). */
const MAX_PER_USER = 30;

function dayKeySp(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date instanceof Date ? date : new Date(date));
}

function clinicHourSp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CLINIC_TZ,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === 'hour')?.value || 0);
}

function daysBetween(from, to) {
  const a = new Date(from);
  const b = new Date(to);
  const ms = b.getTime() - a.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

function formatClinicDate(date) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: CLINIC_TZ,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date instanceof Date ? date : new Date(date));
  } catch {
    return '';
  }
}

function renderInactiveReturnTemplate(template, vars = {}) {
  return String(template || '')
    .replace(/\{\{\s*nome\s*\}\}/gi, vars.nome || '')
    .replace(/\{\{\s*dias\s*\}\}/gi, vars.dias != null ? String(vars.dias) : '')
    .replace(/\{\{\s*data\s*\}\}/gi, vars.data || '')
    .replace(/\{\{\s*ultima_venda\s*\}\}/gi, vars.data || '');
}

function resolvePhone(client, salePhone) {
  const fromClient = String(client?.phone || '').trim();
  if (fromClient) return fromClient;
  return String(salePhone || '').trim();
}

/**
 * Clientes com última venda há mais de N dias (padrão 30).
 */
async function findInactiveClients(userId, inactiveDays) {
  const windowDays = Math.max(1, Number(inactiveDays) || WhatsAppSettings.INACTIVE_RETURN_DAYS);
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const rows = await Sale.aggregate([
    {
      $match: {
        userId,
        clientId: { $exists: true, $ne: null },
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$clientId',
        lastSaleAt: { $first: '$createdAt' },
        clientName: { $first: '$clientName' },
        clientPhone: { $first: '$clientPhone' },
      },
    },
    { $match: { lastSaleAt: { $lte: cutoff } } },
    { $sort: { lastSaleAt: 1 } },
    { $limit: MAX_PER_USER * 3 },
  ]);

  if (!rows.length) return [];

  const clientIds = rows.map((r) => r._id);
  const clients = await Client.find({
    _id: { $in: clientIds },
    userId,
  })
    .select('name phone whatsappOptOut')
    .lean();

  const byId = new Map(clients.map((c) => [String(c._id), c]));

  const result = [];
  for (const row of rows) {
    const client = byId.get(String(row._id));
    if (!client) continue;
    if (client.whatsappOptOut) continue;

    const phone = resolvePhone(client, row.clientPhone);
    if (!isValidBrazilianPhone(phone) && stripPhoneDigits(phone).length < 10) continue;

    const lastSaleAt = new Date(row.lastSaleAt);
    const dias = daysBetween(lastSaleAt, now);
    if (dias < windowDays) continue;

    result.push({
      clientId: client._id,
      name: client.name || row.clientName || '',
      phone,
      lastSaleAt,
      dias,
      lastSaleDayKey: dayKeySp(lastSaleAt),
    });
  }

  result.sort((a, b) => b.dias - a.dias);
  return result.slice(0, MAX_PER_USER);
}

async function enqueueInactiveReturnForClient(userId, settings, target) {
  const template =
    String(settings.inactiveReturnTemplate || '').trim() ||
    WhatsAppSettings.DEFAULT_INACTIVE_RETURN_TEMPLATE;

  const message = renderInactiveReturnTemplate(template, {
    nome: outbox.firstName(target.name),
    dias: target.dias,
    data: formatClinicDate(target.lastSaleAt),
  });

  if (!message.trim()) {
    return { queued: false, reason: 'empty_message' };
  }

  return outbox.enqueue({
    userId,
    clientId: target.clientId,
    phone: target.phone,
    message,
    kind: 'inactive_return',
    scheduledAt: new Date(),
    dedupeKey: `inactive_return:${target.clientId}:${target.lastSaleDayKey}`,
    sourceRef: String(target.clientId),
    meta: {
      lastSaleAt: target.lastSaleAt,
      dias: target.dias,
      inactiveDays: WhatsAppSettings.INACTIVE_RETURN_DAYS,
    },
  });
}

/**
 * Enfileira WhatsApp para clientes sem compra há +30 dias.
 * Só roda a partir das 11h (America/Sao_Paulo). Uma mensagem por episódio
 * de inatividade (dedupe pela data da última venda).
 */
async function processInactiveReturnFollowUps() {
  if (clinicHourSp() < INACTIVE_RETURN_HOUR_SP) {
    return { skipped: 'before_11am', processed: 0, queued: 0, users: 0 };
  }

  const eligibleSettings = await WhatsAppSettings.find({
    inactiveReturnEnabled: true,
    status: 'connected',
  });

  let queued = 0;
  let skipped = 0;
  let processed = 0;

  for (const settings of eligibleSettings) {
    const targets = await findInactiveClients(
      settings.userId,
      WhatsAppSettings.INACTIVE_RETURN_DAYS,
    );

    for (const target of targets) {
      processed += 1;
      const result = await enqueueInactiveReturnForClient(
        settings.userId,
        settings,
        target,
      );
      if (result.queued) queued += 1;
      else skipped += 1;
    }
  }

  return {
    inactiveDays: WhatsAppSettings.INACTIVE_RETURN_DAYS,
    processed,
    queued,
    skipped,
    users: eligibleSettings.length,
  };
}

module.exports = {
  INACTIVE_RETURN_HOUR_SP,
  MAX_PER_USER,
  dayKeySp,
  renderInactiveReturnTemplate,
  findInactiveClients,
  processInactiveReturnFollowUps,
};
