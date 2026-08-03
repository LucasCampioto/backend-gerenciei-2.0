/**
 * Cron local de lembretes WhatsApp — só para teste/dev.
 * Ative com WHATSAPP_LOCAL_CRON=1. Em produção use cron externo no endpoint.
 */
const whatsappService = require('../services/whatsapp.service');

const DEFAULT_INTERVAL_MS = 60_000;

function isEnabled() {
  const flag = String(process.env.WHATSAPP_LOCAL_CRON || '').trim().toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

function intervalMs() {
  const parsed = parseInt(process.env.WHATSAPP_LOCAL_CRON_INTERVAL_MS, 10);
  if (Number.isFinite(parsed) && parsed >= 15_000) return parsed;
  return DEFAULT_INTERVAL_MS;
}

async function tick() {
  try {
    const data = await whatsappService.processReminders();
    const sent = (data.results || []).reduce((sum, row) => sum + (row.sent || 0), 0);
    const failed = (data.results || []).reduce((sum, row) => sum + (row.failed || 0), 0);
    const outbox = data.outbox || {};
    const sim = data.simulationSweep || {};
    const noshow = data.noShowFollowUp || {};
    console.log(
      `[whatsapp-cron] users=${data.processedUsers || 0} remindersSent=${sent} remindersFailed=${failed} ` +
        `outboxSent=${outbox.sent || 0} outboxFailed=${outbox.failed || 0} outboxSkipped=${outbox.skipped || 0} ` +
        `simQueued=${sim.queued || 0} noShowQueued=${noshow.queued || 0}`
    );
  } catch (error) {
    console.warn('[whatsapp-cron] falha:', error.message);
  }
}

function startWhatsAppRemindersCron() {
  if (!isEnabled()) {
    return null;
  }

  const ms = intervalMs();
  console.log(
    `[whatsapp-cron] ativo — consultando agenda a cada ${Math.round(ms / 1000)}s`
  );

  // Primeira passagem após 5s (dá tempo do Mongo estabilizar).
  const boot = setTimeout(() => {
    tick();
  }, 5_000);

  const timer = setInterval(tick, ms);
  if (typeof timer.unref === 'function') timer.unref();
  if (typeof boot.unref === 'function') boot.unref();

  return timer;
}

module.exports = {
  startWhatsAppRemindersCron,
};
