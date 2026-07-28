const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const User = require('../models/User');
const DailyBriefing = require('../models/DailyBriefing');
const { getEvents } = require('../services/googleCalendar.service');
const { buildActionQueue } = require('../services/actionQueue.service');
const {
  buildClosingQueue,
  runDailyAiAnalyses,
} = require('../services/commercialIntelligence.service');
const { buildAppointmentUpsells } = require('../services/appointmentUpsell.service');
const aiDailyCache = require('../services/aiDailyCache.service');

/** Clínica opera em horário de Brasília (sem DST desde 2019). */
const CLINIC_TZ_OFFSET = '-03:00';

function formatDateKeyInClinic(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date); // YYYY-MM-DD
}

function startOfDay(date = new Date()) {
  const key = formatDateKeyInClinic(date);
  return new Date(`${key}T00:00:00.000${CLINIC_TZ_OFFSET}`);
}

function endOfDay(date = new Date()) {
  const key = formatDateKeyInClinic(date);
  return new Date(`${key}T23:59:59.999${CLINIC_TZ_OFFSET}`);
}

function formatDateKey(date = new Date()) {
  return formatDateKeyInClinic(date);
}

function clinicYesterday(date = new Date()) {
  // Meio-dia em SP do dia atual, menos 24h → cai no dia civil anterior em SP
  const key = formatDateKeyInClinic(date);
  const noonToday = new Date(`${key}T12:00:00.000${CLINIC_TZ_OFFSET}`);
  return new Date(noonToday.getTime() - 24 * 60 * 60 * 1000);
}

function formatBRL(value) {
  return Number(value || 0).toFixed(2).replace('.', ',');
}

async function aggregateSalesForRange(userObjectId, start, end) {
  const rows = await Sale.aggregate([
    {
      $match: {
        userId: userObjectId,
        createdAt: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        netValue: { $sum: '$netValue' },
        totalValue: { $sum: '$totalValue' },
      },
    },
  ]);

  return {
    count: rows[0]?.count ?? 0,
    netValue: rows[0]?.netValue ?? 0,
    totalValue: rows[0]?.totalValue ?? 0,
  };
}

function buildBriefingItems({
  todayEventsCount,
  todaySales,
  yesterdaySales,
  actionQueueCount,
  dueReturnsCount,
}) {
  const items = [];

  if (todayEventsCount > 0) {
    items.push(
      todayEventsCount === 1
        ? '1 agendamento na agenda hoje.'
        : `${todayEventsCount} agendamentos na agenda hoje.`
    );
  } else {
    items.push('Nenhum agendamento na agenda para hoje.');
  }

  if (todaySales.count > 0) {
    items.push(
      `Caixa do dia: ${todaySales.count} venda${todaySales.count === 1 ? '' : 's'} · R$ ${formatBRL(todaySales.netValue)}.`
    );
  } else {
    items.push('Ainda não há vendas registradas hoje.');
  }

  if (actionQueueCount > 0) {
    items.push(
      `${actionQueueCount} ação${actionQueueCount === 1 ? '' : 'ões'} na fila do CRM.`
    );
  }

  if (dueReturnsCount > 0) {
    items.push(
      `${dueReturnsCount} retorno${dueReturnsCount === 1 ? '' : 's'} devido${dueReturnsCount === 1 ? '' : 's'} nos próximos dias.`
    );
  }

  if (yesterdaySales.count > 0 || todaySales.count > 0) {
    const delta = todaySales.netValue - yesterdaySales.netValue;
    if (delta > 0) {
      items.push(`Faturamento líquido acima de ontem (+R$ ${formatBRL(delta)}).`);
    } else if (delta < 0) {
      items.push(`Faturamento líquido abaixo de ontem (−R$ ${formatBRL(Math.abs(delta))}).`);
    } else if (todaySales.count > 0) {
      items.push('Faturamento líquido igual ao de ontem até agora.');
    }
  }

  return items.slice(0, 4);
}

/** Resumo ao vivo de ontem (não usa briefing congelado). */
function buildYesterdaySummaryItems(yesterdaySales) {
  if (yesterdaySales.count > 0) {
    return [
      `Caixa de ontem: ${yesterdaySales.count} venda${yesterdaySales.count === 1 ? '' : 's'} · R$ ${formatBRL(yesterdaySales.netValue)}.`,
    ];
  }
  return ['Nenhuma venda registrada ontem.'];
}

async function loadTodayEvents(user) {
  let todayEvents = [];
  let calendarConnected = Boolean(user?.googleCalendarConnected);

  if (calendarConnected) {
    try {
      const calendarId = user.googleCalendarId || 'primary';
      const rawEvents = await getEvents(user._id || user.id, {
        calendarId,
        timeMin: startOfDay().toISOString(),
        timeMax: endOfDay().toISOString(),
        maxResults: 50,
      });
      todayEvents = (rawEvents || []).map((event) => ({
        id: event.id,
        title: event.title || event.summary || 'Sem título',
        summary: event.summary || event.title || 'Sem título',
        start: event.start,
        end: event.end,
        description: event.description || '',
        location: event.location || '',
      }));
    } catch {
      calendarConnected = false;
      todayEvents = [];
    }
  }

  return { todayEvents, calendarConnected };
}

async function getDailyHome(req, res, next) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const todayStart = startOfDay();
    const todayEnd = endOfDay();
    const yDay = clinicYesterday();
    const yesterdayStart = startOfDay(yDay);
    const yesterdayEnd = endOfDay(yDay);
    const todayKey = formatDateKey();
    const yesterdayKey = formatDateKey(yDay);

    const user = await User.findById(req.userId)
      .select('googleCalendarConnected googleCalendarId name')
      .lean();

    // Calendar + fila de regras + vendas + briefing ontem + caches de IA em paralelo.
    const [
      calendarResult,
      ruleQueue,
      todaySales,
      yesterdaySales,
      directorCache,
      upsellsCache,
      closingRankCache,
    ] = await Promise.all([
      loadTodayEvents({ ...user, _id: req.userId }),
      buildActionQueue(req.userId).catch(() => ({ items: [], dueReturnsCount: 0 })),
      aggregateSalesForRange(userObjectId, todayStart, todayEnd),
      aggregateSalesForRange(userObjectId, yesterdayStart, yesterdayEnd),
      aiDailyCache.getDaily(req.userId, 'director'),
      aiDailyCache.getDaily(req.userId, 'upsells'),
      aiDailyCache.getDaily(req.userId, 'closing_rank'),
    ]);

    let { todayEvents, calendarConnected } = calendarResult;

    // Sempre sincroniza regras/valores (sem LLM). Ranking Agno só no job diário.
    const closingQueue = await buildClosingQueue(req.userId, {
      refresh: true,
      ruleQueue,
      runAiRank: false,
    }).catch(() => ({
      items: [],
      count: 0,
      totalExpectedValue: 0,
    }));

    const visibleClosingItems = closingQueue.items.slice(0, 6);
    const visibleClosingTotal = visibleClosingItems.reduce(
      (sum, item) => sum + (item.expectedValue || 0),
      0
    );

    const briefingItems = buildBriefingItems({
      todayEventsCount: todayEvents.length,
      todaySales,
      yesterdaySales,
      actionQueueCount: closingQueue.count || ruleQueue.items.length,
      dueReturnsCount: ruleQueue.dueReturnsCount,
    });

    // Upsells: cache do dia ou heurística rápida (sem LLM).
    let appointmentUpsells = upsellsCache?.payload?.items || [];
    if (!upsellsCache?.payload) {
      appointmentUpsells = await buildAppointmentUpsells(req.userId, todayEvents, {
        skipCache: true,
        useAi: false,
      }).catch(() => []);
    }

    const upsellByEvent = new Map(
      appointmentUpsells.map((recommendation) => [
        recommendation.eventId,
        recommendation,
      ])
    );
    todayEvents = todayEvents.map((event) => ({
      ...event,
      upsellRecommendation: upsellByEvent.get(event.id) || null,
    }));

    // Diretor: cache do dia ou narrativa rule-based rápida (sem LLM no request).
    const directorFacts = {
      queueCount: closingQueue.count,
      revenueAtRisk: visibleClosingTotal,
      todayNet: todaySales.netValue,
      todaySalesCount: todaySales.count,
      dueReturnsCount: ruleQueue.dueReturnsCount,
      topActions: visibleClosingItems.slice(0, 5),
      anomalies: [],
    };

    let director = directorCache?.payload || null;
    if (!director) {
      director = {
        narrative: [
          closingQueue.count > 0
            ? `Você tem ${closingQueue.count} contato${closingQueue.count === 1 ? '' : 's'} prioritário${closingQueue.count === 1 ? '' : 's'} hoje${visibleClosingTotal > 0 ? `, somando cerca de R$ ${Math.round(visibleClosingTotal).toLocaleString('pt-BR')} em receita potencial.` : '.'}`
            : 'A fila comercial está limpa — nenhum contato prioritário pendente.',
          todaySales.count > 0
            ? `Hoje já ${todaySales.count === 1 ? 'foi' : 'foram'} ${todaySales.count} venda${todaySales.count === 1 ? '' : 's'}, com caixa líquido de R$ ${Math.round(todaySales.netValue).toLocaleString('pt-BR')}.`
            : 'Ainda não há vendas registradas hoje; priorize os contatos de maior valor.',
        ].join(' '),
        anomalies: [],
        ownerActions: visibleClosingItems.slice(0, 3).map((a) => ({
          title: a.clientName
            ? `${a.suggestedAction || 'Contato'} — ${a.clientName}`
            : a.suggestedAction || a.reason,
          clientId: a.clientId,
          expectedValue: a.expectedValue || 0,
          why: a.expectedValueReason
            ? `${a.reason} · ${a.expectedValueReason}`
            : a.reason,
        })),
        revenueAtRisk: visibleClosingTotal,
        source: 'rule',
        fromCache: false,
      };
    } else {
      director = { ...director, fromCache: true };
    }

    // Persiste briefing rule-based só se mudou.
    const existingBriefing = await DailyBriefing.findOne({
      userId: userObjectId,
      date: todayKey,
    }).lean();
    const nextItems = briefingItems.slice(0, 4);
    const sameItems = existingBriefing
      && JSON.stringify(existingBriefing.items || []) === JSON.stringify(nextItems);
    if (!sameItems) {
      await DailyBriefing.findOneAndUpdate(
        { userId: userObjectId, date: todayKey },
        { $set: { items: nextItems } },
        { upsert: true, new: true }
      );
    }

    res.json({
      success: true,
      data: {
        date: todayKey,
        greetingName: user?.name?.split(' ')[0] || 'usuário',
        calendarConnected,
        todayEvents,
        todaySales: {
          count: todaySales.count,
          netValue: todaySales.netValue,
          totalValue: todaySales.totalValue,
        },
        yesterdaySales: {
          count: yesterdaySales.count,
          netValue: yesterdaySales.netValue,
        },
        actionQueue: (closingQueue.items.length ? closingQueue.items : ruleQueue.items).slice(0, 8),
        actionQueueCount: closingQueue.count || ruleQueue.items.length,
        dueReturnsCount: ruleQueue.dueReturnsCount,
        closingQueue: {
          items: visibleClosingItems,
          count: closingQueue.count,
          totalExpectedValue: visibleClosingTotal,
        },
        director,
        briefing: {
          date: todayKey,
          items: nextItems,
        },
        // Sempre ao vivo (não reaproveita briefing congelado do dia anterior)
        yesterdayBriefing: {
          date: yesterdayKey,
          items: buildYesterdaySummaryItems(yesterdaySales),
        },
        aiCache: {
          closingRank: Boolean(closingRankCache?.payload),
          director: Boolean(directorCache?.payload),
          upsells: Boolean(upsellsCache?.payload),
        },
      },
    });

    // Primeira abertura do dia: dispara análises de IA em background.
    const needsDailyAi = !closingRankCache?.payload
      || !directorCache?.payload
      || !upsellsCache?.payload;
    if (needsDailyAi) {
      setImmediate(() => {
        runDailyAiAnalyses(req.userId, {
          todayEvents,
          directorFacts,
        }).catch((err) => {
          console.warn('[home] daily AI skipped:', err.message);
        });
      });
    }
  } catch (error) {
    next(error);
  }
}

module.exports = { getDailyHome };
