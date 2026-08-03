const CalendarNoShow = require('../models/CalendarNoShow');
const WhatsAppSettings = require('../models/WhatsAppSettings');
const Client = require('../models/Client');
const outbox = require('./whatsappOutbox.service');
const { stripPhoneDigits, isValidBrazilianPhone } = require('../utils/phoneMatch');

function matchClientForEvent(userId, title) {
  return require('./whatsapp.service').matchClientForEvent(userId, title);
}

const CLINIC_TZ = 'America/Sao_Paulo';
/** Follow-up de no-show: só dispara a partir das 10h (America/Sao_Paulo). */
const NOSHOW_FOLLOWUP_HOUR_SP = 10;

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

function startOfDaySpIso(dayKey) {
  return new Date(`${dayKey}T00:00:00-03:00`);
}

function endOfDaySpIso(dayKey) {
  return new Date(`${dayKey}T23:59:59.999-03:00`);
}

function yesterdayKeySp(date = new Date()) {
  const todayStart = startOfDaySpIso(dayKeySp(date));
  const y = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  return dayKeySp(y);
}

function renderNoShowTemplate(template, vars = {}) {
  return String(template || '')
    .replace(/\{\{\s*nome\s*\}\}/gi, vars.nome || '')
    .replace(/\{\{\s*data\s*\}\}/gi, vars.data || '')
    .replace(/\{\{\s*horario\s*\}\}/gi, vars.horario || '')
    .replace(/\{\{\s*horário\s*\}\}/gi, vars.horario || '');
}

function formatClinicDate(date) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: CLINIC_TZ,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  } catch {
    return '';
  }
}

function formatClinicTime(date) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: CLINIC_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return '';
  }
}

function serializeNoShow(doc) {
  const obj = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(obj._id),
    calendarEventId: obj.calendarEventId,
    eventStart: obj.eventStart,
    eventTitle: obj.eventTitle || '',
    clientId: obj.clientId ? String(obj.clientId) : null,
    phone: obj.phone || '',
    followUpStatus: obj.followUpStatus,
    followUpError: obj.followUpError || '',
    markedAt: obj.markedAt,
  };
}

/**
 * Marca evento como não compareceu (idempotente).
 */
async function markNoShow(userId, {
  calendarEventId,
  eventStart,
  eventTitle = '',
  summary = '',
} = {}) {
  if (!calendarEventId) {
    const err = new Error('calendarEventId é obrigatório');
    err.statusCode = 400;
    throw err;
  }

  const title = eventTitle || summary || '';
  const start = eventStart ? new Date(eventStart) : null;
  const client = await matchClientForEvent(userId, title);

  const existing = await CalendarNoShow.findOne({ userId, calendarEventId });
  if (existing) {
    return {
      ...serializeNoShow(existing),
      alreadyMarked: true,
      clientName: client?.name || null,
    };
  }

  const doc = await CalendarNoShow.create({
    userId,
    calendarEventId,
    eventStart: start && !Number.isNaN(start.getTime()) ? start : null,
    eventTitle: title,
    clientId: client?._id || null,
    phone: client?.phone || '',
    followUpStatus: 'pending',
    markedAt: new Date(),
  });

  return {
    ...serializeNoShow(doc),
    alreadyMarked: false,
    clientName: client?.name || null,
  };
}

async function unmarkNoShow(userId, calendarEventId) {
  const doc = await CalendarNoShow.findOne({ userId, calendarEventId });
  if (!doc) {
    const err = new Error('Registro de no-show não encontrado');
    err.statusCode = 404;
    throw err;
  }
  if (doc.followUpStatus === 'queued' || doc.followUpStatus === 'sent') {
    const err = new Error('Não é possível desmarcar: follow-up já foi enfileirado ou enviado.');
    err.statusCode = 409;
    throw err;
  }
  await CalendarNoShow.deleteOne({ _id: doc._id });
  return { deleted: true, calendarEventId };
}

async function listNoShows(userId, { eventIds, from, to } = {}) {
  const query = { userId };
  if (Array.isArray(eventIds) && eventIds.length) {
    query.calendarEventId = { $in: eventIds.map(String) };
  }
  if (from || to) {
    query.eventStart = {};
    if (from) query.eventStart.$gte = new Date(from);
    if (to) query.eventStart.$lte = new Date(to);
  }
  const rows = await CalendarNoShow.find(query).sort({ eventStart: -1 }).lean();
  return rows.map(serializeNoShow);
}

async function enqueueFollowUpForDoc(doc, settings) {
  if (!settings?.noShowFollowUpEnabled) {
    return { queued: false, reason: 'disabled' };
  }
  if (settings.status !== 'connected') {
    return { queued: false, reason: 'not_connected' };
  }

  let client = null;
  if (doc.clientId) {
    client = await Client.findOne({ _id: doc.clientId, userId: doc.userId })
      .select('name phone whatsappOptOut')
      .lean();
  }
  if (!client) {
    client = await matchClientForEvent(doc.userId, doc.eventTitle || '');
  }

  if (!client?.phone) {
    doc.followUpStatus = 'skipped';
    doc.followUpError = 'cliente não encontrado';
    await doc.save();
    return { queued: false, reason: 'no_client' };
  }
  if (client.whatsappOptOut) {
    doc.followUpStatus = 'skipped';
    doc.followUpError = 'opt_out';
    await doc.save();
    return { queued: false, reason: 'opt_out' };
  }
  if (
    !isValidBrazilianPhone(client.phone) &&
    stripPhoneDigits(client.phone).length < 10
  ) {
    doc.followUpStatus = 'skipped';
    doc.followUpError = 'invalid_phone';
    await doc.save();
    return { queued: false, reason: 'invalid_phone' };
  }

  const template =
    String(settings.noShowFollowUpTemplate || '').trim() ||
    WhatsAppSettings.DEFAULT_NO_SHOW_FOLLOW_UP_TEMPLATE;
  const eventStart = doc.eventStart ? new Date(doc.eventStart) : new Date();
  const message = renderNoShowTemplate(template, {
    nome: outbox.firstName(client.name),
    data: formatClinicDate(eventStart),
    horario: formatClinicTime(eventStart),
  });
  if (!message.trim()) {
    doc.followUpStatus = 'skipped';
    doc.followUpError = 'empty_message';
    await doc.save();
    return { queued: false, reason: 'empty_message' };
  }

  const result = await outbox.enqueue({
    userId: doc.userId,
    clientId: client._id,
    phone: client.phone,
    message,
    kind: 'agenda_noshow',
    scheduledAt: new Date(),
    dedupeKey: `agenda_noshow:${doc.calendarEventId}`,
    sourceRef: doc.calendarEventId,
    meta: {
      calendarEventId: doc.calendarEventId,
      eventStart: doc.eventStart,
      eventTitle: doc.eventTitle,
    },
  });

  if (result.queued) {
    doc.followUpStatus = 'queued';
    doc.clientId = client._id;
    doc.phone = client.phone;
    doc.followUpError = '';
    await doc.save();
    return { queued: true };
  }

  if (result.reason === 'duplicate') {
    doc.followUpStatus = 'queued';
    doc.followUpError = '';
    await doc.save();
    return { queued: false, reason: 'duplicate' };
  }

  doc.followUpStatus = 'skipped';
  doc.followUpError = result.reason || 'enqueue_failed';
  await doc.save();
  return { queued: false, reason: result.reason || 'enqueue_failed' };
}

/**
 * Pega no-shows do dia anterior (fuso clínica) e enfileira mensagem de remarcação.
 * Só roda a partir das 10h (America/Sao_Paulo).
 */
async function processYesterdayNoShowFollowUps() {
  if (clinicHourSp() < NOSHOW_FOLLOWUP_HOUR_SP) {
    return { skipped: 'before_10am', processed: 0, queued: 0, users: 0 };
  }

  const yKey = yesterdayKeySp();
  const from = startOfDaySpIso(yKey);
  const to = endOfDaySpIso(yKey);

  const eligibleSettings = await WhatsAppSettings.find({
    noShowFollowUpEnabled: true,
    status: 'connected',
  });

  let queued = 0;
  let skipped = 0;
  let processed = 0;

  for (const settings of eligibleSettings) {
    const docs = await CalendarNoShow.find({
      userId: settings.userId,
      followUpStatus: 'pending',
      eventStart: { $gte: from, $lte: to },
    });

    for (const doc of docs) {
      processed += 1;
      const result = await enqueueFollowUpForDoc(doc, settings);
      if (result.queued) queued += 1;
      else skipped += 1;
    }
  }

  return { dateKey: yKey, processed, queued, skipped, users: eligibleSettings.length };
}

module.exports = {
  dayKeySp,
  yesterdayKeySp,
  renderNoShowTemplate,
  markNoShow,
  unmarkNoShow,
  listNoShows,
  processYesterdayNoShowFollowUps,
  enqueueFollowUpForDoc,
};
