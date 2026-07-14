const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const User = require('../models/User');
const DailyBriefing = require('../models/DailyBriefing');
const { getEvents } = require('../services/googleCalendar.service');
const { buildActionQueue } = require('../services/actionQueue.service');

function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function formatDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
      `Caixa do dia: ${todaySales.count} venda${todaySales.count === 1 ? '' : 's'} · R$ ${Number(todaySales.netValue).toFixed(2).replace('.', ',')}.`
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
      items.push(`Faturamento líquido acima de ontem (+R$ ${delta.toFixed(2).replace('.', ',')}).`);
    } else if (delta < 0) {
      items.push(`Faturamento líquido abaixo de ontem (−R$ ${Math.abs(delta).toFixed(2).replace('.', ',')}).`);
    } else if (todaySales.count > 0) {
      items.push('Faturamento líquido igual ao de ontem até agora.');
    }
  }

  return items.slice(0, 4);
}

async function getDailyHome(req, res, next) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const todayStart = startOfDay();
    const todayEnd = endOfDay();
    const yesterdayStart = startOfDay(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const yesterdayEnd = endOfDay(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const todayKey = formatDateKey();
    const yesterdayKey = formatDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));

    const user = await User.findById(req.userId)
      .select('googleCalendarConnected googleCalendarId name')
      .lean();

    let todayEvents = [];
    let calendarConnected = Boolean(user?.googleCalendarConnected);

    if (calendarConnected) {
      try {
        const calendarId = user.googleCalendarId || 'primary';
        const rawEvents = await getEvents(req.userId, {
          calendarId,
          timeMin: todayStart.toISOString(),
          timeMax: todayEnd.toISOString(),
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

    const [todaySales, yesterdaySales, yesterdayBriefing, queue] = await Promise.all([
      aggregateSalesForRange(userObjectId, todayStart, todayEnd),
      aggregateSalesForRange(userObjectId, yesterdayStart, yesterdayEnd),
      DailyBriefing.findOne({ userId: userObjectId, date: yesterdayKey }).lean(),
      buildActionQueue(req.userId).catch(() => ({ items: [], dueReturnsCount: 0 })),
    ]);

    const briefingItems = buildBriefingItems({
      todayEventsCount: todayEvents.length,
      todaySales,
      yesterdaySales,
      actionQueueCount: queue.items.length,
      dueReturnsCount: queue.dueReturnsCount,
    });

    await DailyBriefing.findOneAndUpdate(
      { userId: userObjectId, date: todayKey },
      { $set: { items: briefingItems } },
      { upsert: true, new: true }
    );

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
        actionQueue: queue.items.slice(0, 8),
        actionQueueCount: queue.items.length,
        dueReturnsCount: queue.dueReturnsCount,
        briefing: {
          date: todayKey,
          items: briefingItems,
        },
        yesterdayBriefing: yesterdayBriefing
          ? { date: yesterdayBriefing.date, items: yesterdayBriefing.items || [] }
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getDailyHome };
