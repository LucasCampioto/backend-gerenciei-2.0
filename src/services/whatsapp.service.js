const WhatsAppSettings = require('../models/WhatsAppSettings');
const WhatsAppReminderLog = require('../models/WhatsAppReminderLog');
const Client = require('../models/Client');
const User = require('../models/User');
const { getEvents } = require('./googleCalendar.service');
const wame = require('./wame.client');
const { stripPhoneDigits, isValidBrazilianPhone } = require('../utils/phoneMatch');

const CLINIC_TZ = 'America/Sao_Paulo';
const TEST_RATE_LIMIT_MS = 30_000;
/** Confirmação diária: só dispara a partir das 8:30 (America/Sao_Paulo). */
const DAILY_REMINDER_HOUR_SP = 8;
const DAILY_REMINDER_MINUTE_SP = 30;

function dayKeySp(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function clinicHourSp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CLINIC_TZ,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === 'hour')?.value || 0);
}

function clinicMinuteSp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CLINIC_TZ,
    minute: '2-digit',
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === 'minute')?.value || 0);
}

function todayRangeSp(date = new Date()) {
  const dayKey = dayKeySp(date);
  return {
    timeMin: new Date(`${dayKey}T00:00:00-03:00`).toISOString(),
    timeMax: new Date(`${dayKey}T23:59:59.999-03:00`).toISOString(),
  };
}

function isPastDailyReminderHour(date = new Date()) {
  const hour = clinicHourSp(date);
  if (hour > DAILY_REMINDER_HOUR_SP) return true;
  if (hour < DAILY_REMINDER_HOUR_SP) return false;
  return clinicMinuteSp(date) >= DAILY_REMINDER_MINUTE_SP;
}

function normalizeName(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleSegments(summary = '') {
  return String(summary)
    .split('/')
    .map((part) => normalizeName(part))
    .filter((part) => part.length >= 3);
}

/** Nome completo no título: trecho antes da "/" (já normalizado). */
function eventFullNameHint(summary = '') {
  const segments = titleSegments(summary);
  if (segments.length > 0) return segments[0];
  return normalizeName(summary);
}

function preferClienteThenLonger(a, b) {
  if (a.category === 'cliente' && b.category !== 'cliente') return -1;
  if (b.category === 'cliente' && a.category !== 'cliente') return 1;
  return normalizeName(b.name).length - normalizeName(a.name).length;
}

function matchScore(candidateName, hint) {
  const name = normalizeName(candidateName);
  const h = normalizeName(hint);
  if (name.length < 3 || h.length < 3) return 0;

  // Nome completo idêntico após normalização (Letícia = Leticia, maiúsculas, espaços).
  if (name === h) return h.length + 200;

  const nameWords = name.split(' ').filter(Boolean);
  const hintWords = h.split(' ').filter(Boolean);

  // Todos os tokens do hint (nome no evento) batem no cadastro — prioriza nome completo.
  if (
    hintWords.length >= 2 &&
    hintWords.every((hw) => nameWords.some((nw) => nw === hw))
  ) {
    return hintWords.join(' ').length + 120;
  }

  if (name.includes(h) || h.includes(name)) {
    return Math.min(name.length, h.length) + 50;
  }

  const prefixHit = hintWords.some(
    (hw) =>
      hw.length >= 4 && nameWords.some((nw) => nw.startsWith(hw) || hw.startsWith(nw))
  );
  return prefixHit ? Math.min(name.length, h.length) : 0;
}

function formatClinicDate(date) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: CLINIC_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function formatClinicTime(date) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: CLINIC_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function renderTemplate(template, vars = {}) {
  const source = String(template || WhatsAppSettings.DEFAULT_TEMPLATE);
  return source
    .replace(/\{\{\s*nome\s*\}\}/gi, vars.nome || '')
    .replace(/\{\{\s*data\s*\}\}/gi, vars.data || '')
    .replace(/\{\{\s*horario\s*\}\}/gi, vars.horario || '')
    .replace(/\{\{\s*horário\s*\}\}/gi, vars.horario || '')
    .replace(/\{\{\s*campanha\s*\}\}/gi, vars.campanha || '')
    .replace(/\{\{\s*tipo\s*\}\}/gi, vars.tipo || '');
}

function firstName(fullName = '') {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  return parts[0] || fullName || 'cliente';
}

async function getOrCreateSettings(userId) {
  let settings = await WhatsAppSettings.findOne({ userId }).select('+wameInstanceKey');
  if (!settings) {
    settings = await WhatsAppSettings.create({ userId });
    // reload with hidden field
    settings = await WhatsAppSettings.findOne({ userId }).select('+wameInstanceKey');
  }
  return settings;
}

function resolveInstanceKey(settings) {
  return String(settings?.wameInstanceKey || '').trim();
}

function assertTenantConfigured(settings) {
  const key = resolveInstanceKey(settings);
  wame.assertInstanceKey(key);
  return key;
}

function mergeFunnelTemplates(stored) {
  const base = { ...WhatsAppSettings.DEFAULT_FUNNEL_TEMPLATES };
  const raw = stored?.toObject?.() || stored || {};
  for (const key of WhatsAppSettings.FUNNEL_TEMPLATE_KEYS) {
    if (typeof raw[key] === 'string' && raw[key].trim()) {
      base[key] = raw[key].trim();
    }
  }
  return base;
}

function serializeSettings(settings) {
  return {
    status: settings.status,
    connectedPhone: settings.connectedPhone || '',
    hasInstanceKey: Boolean(resolveInstanceKey(settings)),
    remindersEnabled: Boolean(settings.remindersEnabled),
    messageTemplate: settings.messageTemplate || WhatsAppSettings.DEFAULT_TEMPLATE,
    defaultTemplate: WhatsAppSettings.DEFAULT_TEMPLATE,
    funnelWelcomeEnabled: Boolean(settings.funnelWelcomeEnabled),
    funnelTemplates: mergeFunnelTemplates(settings.funnelTemplates),
    defaultFunnelTemplates: WhatsAppSettings.DEFAULT_FUNNEL_TEMPLATES,
    simulationInviteEnabled: Boolean(settings.simulationInviteEnabled),
    simulationInviteTemplate:
      settings.simulationInviteTemplate ||
      WhatsAppSettings.DEFAULT_SIMULATION_INVITE_TEMPLATE,
    defaultSimulationInviteTemplate: WhatsAppSettings.DEFAULT_SIMULATION_INVITE_TEMPLATE,
    noShowFollowUpEnabled: Boolean(settings.noShowFollowUpEnabled),
    noShowFollowUpTemplate:
      settings.noShowFollowUpTemplate ||
      WhatsAppSettings.DEFAULT_NO_SHOW_FOLLOW_UP_TEMPLATE,
    defaultNoShowFollowUpTemplate: WhatsAppSettings.DEFAULT_NO_SHOW_FOLLOW_UP_TEMPLATE,
    updatedAt: settings.updatedAt,
  };
}

async function getSettings(userId) {
  const settings = await getOrCreateSettings(userId);
  return {
    ...serializeSettings(settings),
    configured: Boolean(resolveInstanceKey(settings)),
  };
}

async function updateSettings(userId, payload = {}) {
  const settings = await getOrCreateSettings(userId);
  if (payload.messageTemplate !== undefined) {
    const next = String(payload.messageTemplate || '').trim();
    if (!next) {
      const err = new Error('Template de mensagem não pode ficar vazio.');
      err.statusCode = 400;
      throw err;
    }
    if (next.length > 2000) {
      const err = new Error('Template muito longo (máx. 2000 caracteres).');
      err.statusCode = 400;
      throw err;
    }
    settings.messageTemplate = next;
  }
  if (payload.remindersEnabled !== undefined) {
    settings.remindersEnabled = Boolean(payload.remindersEnabled);
  }
  if (payload.funnelWelcomeEnabled !== undefined) {
    settings.funnelWelcomeEnabled = Boolean(payload.funnelWelcomeEnabled);
  }
  if (payload.simulationInviteEnabled !== undefined) {
    settings.simulationInviteEnabled = Boolean(payload.simulationInviteEnabled);
  }
  if (payload.simulationInviteTemplate !== undefined) {
    const next = String(payload.simulationInviteTemplate || '').trim();
    if (!next) {
      const err = new Error('Template de simulação não pode ficar vazio.');
      err.statusCode = 400;
      throw err;
    }
    if (next.length > 2000) {
      const err = new Error('Template de simulação muito longo (máx. 2000 caracteres).');
      err.statusCode = 400;
      throw err;
    }
    settings.simulationInviteTemplate = next;
  }
  if (payload.noShowFollowUpEnabled !== undefined) {
    settings.noShowFollowUpEnabled = Boolean(payload.noShowFollowUpEnabled);
  }
  if (payload.noShowFollowUpTemplate !== undefined) {
    const next = String(payload.noShowFollowUpTemplate || '').trim();
    if (!next) {
      const err = new Error('Template de no-show não pode ficar vazio.');
      err.statusCode = 400;
      throw err;
    }
    if (next.length > 2000) {
      const err = new Error('Template de no-show muito longo (máx. 2000 caracteres).');
      err.statusCode = 400;
      throw err;
    }
    settings.noShowFollowUpTemplate = next;
  }
  if (payload.funnelTemplates && typeof payload.funnelTemplates === 'object') {
    const next = mergeFunnelTemplates(settings.funnelTemplates);
    for (const key of WhatsAppSettings.FUNNEL_TEMPLATE_KEYS) {
      if (payload.funnelTemplates[key] !== undefined) {
        const text = String(payload.funnelTemplates[key] || '').trim();
        if (!text) {
          const err = new Error(`Template "${key}" não pode ficar vazio.`);
          err.statusCode = 400;
          throw err;
        }
        if (text.length > 2000) {
          const err = new Error(`Template "${key}" muito longo (máx. 2000).`);
          err.statusCode = 400;
          throw err;
        }
        next[key] = text;
      }
    }
    settings.funnelTemplates = next;
  }
  await settings.save();
  return serializeSettings(settings);
}

async function markDisconnected(settings, { clearAutomations = false } = {}) {
  settings.status = 'disconnected';
  settings.connectedPhone = '';
  settings.lastQr = '';
  if (clearAutomations) {
    settings.remindersEnabled = false;
  }
  await settings.save();
  return settings;
}

async function syncStatusFromWame(settings) {
  try {
    const instanceKey = assertTenantConfigured(settings);
    const info = await wame.getInstance(instanceKey);
    if (info.status === 'connected') {
      settings.status = 'connected';
      if (info.phone) settings.connectedPhone = info.phone;
      settings.lastQr = '';
    } else if (info.qr || info.status === 'qr') {
      settings.status = 'qr';
      if (info.qr) settings.lastQr = info.qr;
      if (!info.phone) settings.connectedPhone = '';
    } else if (settings.status === 'qr') {
      // Mantém aguardando leitura — GET transitório sem QR não derruba o fluxo
    } else {
      settings.status = info.status || 'disconnected';
      if (settings.status === 'disconnected' || settings.status === 'failed') {
        settings.connectedPhone = '';
        settings.lastQr = '';
      }
    }
    await settings.save();
    const qr =
      settings.status === 'qr'
        ? info.qr || settings.lastQr || null
        : null;
    return { settings, qr };
  } catch (error) {
    if (error.code === 'WAME_NOT_CONFIGURED') throw error;

    if (error.code === 'WAME_NOT_CONNECTED') {
      await markDisconnected(settings);
      return {
        settings,
        qr: null,
        error: error.message,
      };
    }

    if (settings.status !== 'qr') {
      settings.status = 'failed';
      await settings.save();
    }
    return {
      settings,
      qr: settings.status === 'qr' ? settings.lastQr || null : null,
      error: error.message,
    };
  }
}

async function connect(userId) {
  const settings = await getOrCreateSettings(userId);
  const instanceKey = assertTenantConfigured(settings);
  const info = await wame.connectInstance(instanceKey);
  if (info.status === 'connected') {
    settings.status = 'connected';
    if (info.phone) settings.connectedPhone = info.phone;
    settings.lastQr = '';
  } else {
    settings.status = 'qr';
    if (info.qr) settings.lastQr = info.qr;
  }
  await settings.save();
  return {
    ...serializeSettings(settings),
    qr: settings.status === 'qr' ? info.qr || settings.lastQr || null : null,
  };
}

async function getStatus(userId) {
  const settings = await getOrCreateSettings(userId);
  try {
    assertTenantConfigured(settings);
  } catch (error) {
    return {
      ...serializeSettings(settings),
      qr: null,
      providerError: error.message,
      configured: false,
      hasInstanceKey: false,
    };
  }
  const { settings: synced, qr, error } = await syncStatusFromWame(settings);
  return {
    ...serializeSettings(synced),
    qr: synced.status === 'qr' ? qr || synced.lastQr || null : null,
    providerError: error || null,
    configured: true,
  };
}

async function disconnect(userId) {
  const settings = await getOrCreateSettings(userId);
  const instanceKey = resolveInstanceKey(settings);
  try {
    if (instanceKey) {
      await wame.disconnectInstance(instanceKey);
    }
  } catch (error) {
    console.warn('[whatsapp] disconnect WAME:', error.message);
  }
  settings.status = 'disconnected';
  settings.connectedPhone = '';
  settings.remindersEnabled = false;
  settings.lastQr = '';
  await settings.save();
  return serializeSettings(settings);
}

async function matchClientForEvent(userId, summary) {
  const clients = await Client.find({ userId }).select('_id name phone category').lean();
  if (!clients.length) return null;

  const text = normalizeName(summary);
  const fullNameHint = eventFullNameHint(summary);
  const digits = String(summary || '').replace(/\D/g, '');

  // Telefone no título continua sendo o desempate mais seguro.
  const byPhone = clients.find((client) => {
    const phone = stripPhoneDigits(client.phone);
    return phone.length >= 8 && digits.includes(phone);
  });
  if (byPhone) return byPhone;

  // 1) Nome completo igual após normalização (acentos, case, espaços).
  if (fullNameHint) {
    const exactFull = clients
      .filter((client) => normalizeName(client.name) === fullNameHint)
      .sort(preferClienteThenLonger);
    if (exactFull[0]) return exactFull[0];
  }

  // 2) Nome completo do cadastro contido no título do evento.
  const contained = clients
    .filter((client) => {
      const name = normalizeName(client.name);
      const words = name.split(' ').filter(Boolean);
      // Exige nome composto (nome + sobrenome) para evitar falso positivo só com "Ana".
      return words.length >= 2 && name.length >= 5 && text.includes(name);
    })
    .sort(preferClienteThenLonger);
  if (contained[0]) return contained[0];

  // 3) Fallback: score no trecho de nome do título (já normalizado).
  const hints = fullNameHint ? [fullNameHint] : [];
  let best = null;
  let bestScore = 0;
  for (const client of clients) {
    for (const hint of hints) {
      let score = matchScore(client.name, hint);
      if (client.category === 'cliente') score += 5;
      if (score > bestScore) {
        best = client;
        bestScore = score;
      }
    }
  }
  // Só aceita fallback forte (nome completo / contains), não só prefixo frouxo.
  return bestScore >= 50 ? best : null;
}

async function sendTestMessage(userId, { phone, nome } = {}) {
  const settings = await getOrCreateSettings(userId);
  const instanceKey = assertTenantConfigured(settings);
  const { settings: synced } = await syncStatusFromWame(settings);

  if (synced.status !== 'connected') {
    const err = new Error(
      'WhatsApp desconectado. Reconecte via QR Code em Conexão antes de enviar um teste.'
    );
    err.statusCode = 409;
    err.code = 'WHATSAPP_NOT_CONNECTED';
    throw err;
  }

  if (synced.lastTestSentAt) {
    const elapsed = Date.now() - new Date(synced.lastTestSentAt).getTime();
    if (elapsed < TEST_RATE_LIMIT_MS) {
      const waitSec = Math.ceil((TEST_RATE_LIMIT_MS - elapsed) / 1000);
      const err = new Error(`Aguarde ${waitSec}s antes de enviar outro teste.`);
      err.statusCode = 429;
      err.code = 'TEST_RATE_LIMIT';
      throw err;
    }
  }

  const user = await User.findById(userId).select('phone').lean();
  const targetPhone = phone || user?.phone || '';
  if (!isValidBrazilianPhone(targetPhone) && stripPhoneDigits(targetPhone).length < 10) {
    const err = new Error('Informe um telefone válido com DDD para o teste.');
    err.statusCode = 400;
    throw err;
  }

  const sampleAt = new Date(Date.now() + 60 * 60 * 1000);
  const message = renderTemplate(synced.messageTemplate, {
    nome: firstName(nome || 'Maria'),
    data: formatClinicDate(sampleAt),
    horario: formatClinicTime(sampleAt),
  });

  try {
    await wame.sendText(targetPhone, message, instanceKey);
  } catch (error) {
    if (error.code === 'WAME_NOT_CONNECTED') {
      await markDisconnected(synced);
      const err = new Error(
        'WhatsApp desconectou. Reconecte via QR Code em Conexão e tente de novo.'
      );
      err.statusCode = 409;
      err.code = 'WHATSAPP_NOT_CONNECTED';
      throw err;
    }
    throw error;
  }
  synced.lastTestSentAt = new Date();
  await synced.save();

  await WhatsAppReminderLog.create({
    userId,
    calendarEventId: `test-${Date.now()}`,
    eventStart: sampleAt,
    phone: wame.toInternationalPhone(targetPhone),
    message,
    status: 'test',
  });

  return {
    sent: true,
    phone: wame.toInternationalPhone(targetPhone),
    message,
  };
}

async function listReminderLogs(userId, limit = 30) {
  const logs = await WhatsAppReminderLog.find({ userId })
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 30, 100))
    .lean();

  const clientIds = [
    ...new Set(logs.map((l) => (l.clientId ? String(l.clientId) : '')).filter(Boolean)),
  ];
  const clients = clientIds.length
    ? await Client.find({ userId, _id: { $in: clientIds } })
        .select('_id name')
        .lean()
    : [];
  const byId = new Map(clients.map((c) => [String(c._id), c]));

  return logs.map((log) => {
    const client = log.clientId ? byId.get(String(log.clientId)) : null;
    return {
      id: String(log._id),
      calendarEventId: log.calendarEventId,
      eventStart: log.eventStart || null,
      clientId: log.clientId ? String(log.clientId) : null,
      name: client?.name || (log.status === 'test' ? 'Teste' : ''),
      phone: log.phone || '',
      message: log.message || '',
      status: log.status,
      error: log.error || '',
      sentAt: log.status === 'sent' || log.status === 'test' ? log.createdAt : null,
      createdAt: log.createdAt || null,
    };
  });
}

async function processRemindersForUser(userId, settings) {
  const user = await User.findById(userId)
    .select('googleCalendarConnected googleCalendarId')
    .lean();
  if (!user?.googleCalendarConnected) {
    return { userId: String(userId), skipped: 'calendar_not_connected', sent: 0 };
  }

  // Lote diário às 8:30 (fuso da clínica). Antes disso, não dispara.
  if (!isPastDailyReminderHour()) {
    return { userId: String(userId), skipped: 'before_830am', sent: 0 };
  }

  const { timeMin, timeMax } = todayRangeSp();
  const now = Date.now();

  let events = [];
  try {
    events = await getEvents(userId, {
      calendarId: user.googleCalendarId || 'primary',
      timeMin,
      timeMax,
      maxResults: 100,
      singleEvents: true,
      orderBy: 'startTime',
    });
  } catch (error) {
    console.warn(`[whatsapp] calendar events user=${userId}:`, error.message);
    return { userId: String(userId), skipped: 'calendar_error', error: error.message, sent: 0 };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const event of events) {
    if (event.isAllDay || !event.start || !event.id) {
      skipped += 1;
      continue;
    }

    const eventStart = new Date(event.start);
    if (Number.isNaN(eventStart.getTime())) {
      skipped += 1;
      continue;
    }

    // Só confirma horários que ainda não passaram.
    if (eventStart.getTime() <= now) {
      skipped += 1;
      continue;
    }

    const existing = await WhatsAppReminderLog.findOne({
      userId,
      calendarEventId: event.id,
    }).lean();
    if (existing) {
      skipped += 1;
      continue;
    }

    const client = await matchClientForEvent(userId, event.summary || '');
    if (!client?.phone) {
      try {
        await WhatsAppReminderLog.create({
          userId,
          calendarEventId: event.id,
          eventStart,
          message: '',
          status: 'skipped',
          error: 'cliente não encontrado',
        });
      } catch (error) {
        if (error?.code !== 11000) throw error;
      }
      skipped += 1;
      continue;
    }

    const message = renderTemplate(settings.messageTemplate, {
      nome: firstName(client.name),
      data: formatClinicDate(eventStart),
      horario: formatClinicTime(eventStart),
    });

    let claim;
    try {
      claim = await WhatsAppReminderLog.create({
        userId,
        calendarEventId: event.id,
        eventStart,
        clientId: client._id,
        phone: wame.toInternationalPhone(client.phone),
        message,
        status: 'sending',
      });
    } catch (error) {
      if (error?.code === 11000) {
        skipped += 1;
        continue;
      }
      throw error;
    }

    try {
      await wame.sendText(client.phone, message, resolveInstanceKey(settings));
      claim.status = 'sent';
      claim.error = '';
      await claim.save();
      sent += 1;
    } catch (error) {
      claim.status = 'failed';
      claim.error = error.message || 'falha no envio';
      await claim.save();
      failed += 1;
    }
  }

  return { userId: String(userId), sent, skipped, failed };
}

async function processReminders() {
  const { acquireLock, releaseLock } = require('./cronLock.service');
  const outboxService = require('./whatsappOutbox.service');
  const lockId = 'whatsapp-reminders';
  const owner = await acquireLock(lockId);
  if (!owner) {
    return { skipped: true, reason: 'lock_held', processedUsers: 0, results: [] };
  }

  let results = [];

  try {
    const eligible = await WhatsAppSettings.find({
      remindersEnabled: true,
      status: 'connected',
      wameInstanceKey: { $exists: true, $nin: [null, ''] },
    }).select('+wameInstanceKey');

    for (const settings of eligible) {
      try {
        const result = await processRemindersForUser(settings.userId, settings);
        results.push(result);
      } catch (error) {
        results.push({
          userId: String(settings.userId),
          sent: 0,
          error: error.message,
        });
      }
    }

    const outbox = await outboxService.processDueOutbox().catch((error) => {
      console.warn('[whatsapp] outbox failed:', error.message);
      return { processed: 0, sent: 0, failed: 0, skipped: 0, error: error.message };
    });

    const simulationSweep = await require('./whatsappSimulation.service')
      .sweepSimulationInvites()
      .catch((error) => {
        console.warn('[whatsapp] simulation sweep failed:', error.message);
        return { queued: 0, skipped: 0, error: error.message };
      });

    const noShowFollowUp = await require('./calendarNoShow.service')
      .processYesterdayNoShowFollowUps()
      .catch((error) => {
        console.warn('[whatsapp] no-show follow-up failed:', error.message);
        return { processed: 0, queued: 0, skipped: 0, error: error.message };
      });

    return {
      processedUsers: results.length,
      results,
      outbox,
      simulationSweep,
      noShowFollowUp,
    };
  } finally {
    await releaseLock(lockId, owner);
  }
}

async function setInstanceKey(userId, instanceKey) {
  const key = String(instanceKey || '').trim();
  if (!key || key.length < 8) {
    const err = new Error('Informe uma instance key válida da WAME.');
    err.statusCode = 400;
    throw err;
  }
  if (key.length > 200) {
    const err = new Error('Instance key inválida.');
    err.statusCode = 400;
    throw err;
  }
  const settings = await getOrCreateSettings(userId);
  settings.wameInstanceKey = key;
  await settings.save();
  return {
    ...serializeSettings(settings),
    configured: true,
    hasInstanceKey: true,
  };
}

module.exports = {
  DEFAULT_TEMPLATE: WhatsAppSettings.DEFAULT_TEMPLATE,
  setInstanceKey,
  DEFAULT_FUNNEL_TEMPLATES: WhatsAppSettings.DEFAULT_FUNNEL_TEMPLATES,
  normalizeName,
  matchScore,
  renderTemplate,
  matchClientForEvent,
  getSettings,
  updateSettings,
  connect,
  getStatus,
  disconnect,
  sendTestMessage,
  listReminderLogs,
  processReminders,
};
