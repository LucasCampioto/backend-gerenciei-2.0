const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const User = require('../models/User');
const { getEvents } = require('../services/googleCalendar.service');
const { buildSaleItemsAllocationStages } = require('../utils/saleAggregation');

const TZ = 'America/Sao_Paulo';

const MONTH_LABELS_SHORT = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

const DAY_LABELS = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
];

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function parseDateRange(startDate, endDate) {
  const range = {};

  if (startDate) {
    range.$gte = new Date(startDate);
  }

  if (endDate) {
    const parsedEnd = new Date(endDate);
    if (typeof endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(endDate.trim())) {
      parsedEnd.setUTCHours(23, 59, 59, 999);
    }
    range.$lte = parsedEnd;
  }

  return range;
}

function dayLabelFromMongo(dayOfWeek) {
  if (!dayOfWeek || dayOfWeek < 1 || dayOfWeek > 7) return '—';
  return DAY_LABELS[dayOfWeek - 1];
}

function saleLocalDatePartsStage() {
  return {
    $addFields: {
      saleMonth: { $month: { date: '$createdAt', timezone: TZ } },
      saleDayOfWeek: { $dayOfWeek: { date: '$createdAt', timezone: TZ } },
    },
  };
}

function dateKeyInTz(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(date));
}

function hourInTz(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date(date));
  const hourPart = parts.find((p) => p.type === 'hour');
  const hour = hourPart ? parseInt(hourPart.value, 10) : 0;
  return hour === 24 ? 0 : hour;
}

function calendarQueryBounds(startDate, endDate) {
  const start = String(startDate).trim();
  const end = String(endDate).trim();
  return {
    timeMin: new Date(`${start}T00:00:00-03:00`).toISOString(),
    timeMax: new Date(`${end}T23:59:59.999-03:00`).toISOString(),
  };
}

function parseEventClient(event) {
  const summary = (event.summary || '').trim();
  const guest = (event.attendees || []).find(
    (attendee) => attendee.displayName && attendee.displayName !== event.creator?.displayName
  );
  const clientName = summary || guest?.displayName || 'Sem nome';
  const telefone =
    extractPhoneFromText(event.description) ||
    extractPhoneFromText(event.location) ||
    null;

  return { clientName, telefone };
}

function extractPhoneFromText(text) {
  if (!text || typeof text !== 'string') return null;

  const candidates = text.match(
    /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9?\d{4})[-.\s]?\d{4}/g
  );

  if (!candidates) return null;

  const phone = candidates.find((item) => item.replace(/\D/g, '').length >= 10);
  return phone ? phone.trim() : null;
}

function formatEventHorario(timing) {
  if (timing.isAllDay) return 'Dia inteiro';
  return `${String(timing.hour).padStart(2, '0')}h`;
}

function parseCalendarEventTiming(event) {
  if (!event?.start) return null;

  const isAllDay = event.isAllDay || /^\d{4}-\d{2}-\d{2}$/.test(event.start);

  if (isAllDay) {
    const dateKey = event.start.slice(0, 10);
    let durationHours = 1;

    if (event.end && /^\d{4}-\d{2}-\d{2}$/.test(event.end)) {
      const startMs = new Date(`${dateKey}T12:00:00-03:00`).getTime();
      const endMs = new Date(`${event.end.slice(0, 10)}T12:00:00-03:00`).getTime();
      const days = Math.max(Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)), 1);
      durationHours = days;
    }

    return {
      isAllDay: true,
      dateKey,
      hour: null,
      durationHours,
    };
  }

  const start = new Date(event.start);
  if (Number.isNaN(start.getTime())) return null;

  const end = event.end ? new Date(event.end) : null;
  const durationHours = end && !Number.isNaN(end.getTime())
    ? Math.max((end.getTime() - start.getTime()) / (1000 * 60 * 60), 0.5)
    : 0.5;

  return {
    isAllDay: false,
    dateKey: dateKeyInTz(start),
    hour: hourInTz(start),
    durationHours,
  };
}

function splitPeriodHalves(start, end) {
  const startMs = start.getTime();
  const endMs = end.getTime();
  const midMs = startMs + Math.floor((endMs - startMs) / 2);
  const mid = new Date(midMs);
  mid.setUTCHours(23, 59, 59, 999);
  const secondStart = new Date(midMs + 1);

  return {
    first: { start, end: mid },
    second: { start: secondStart, end },
  };
}

async function getSeasonality(req, res, next) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'startDate e endDate são obrigatórios',
      });
    }

    const createdAt = parseDateRange(startDate, endDate);
    if (!createdAt.$gte || !createdAt.$lte) {
      return res.status(400).json({
        success: false,
        message: 'Datas inválidas',
      });
    }

    const [heatmapRows, byMonthRows, byDayRows] = await Promise.all([
      Sale.aggregate([
        { $match: { userId: userObjectId, createdAt } },
        saleLocalDatePartsStage(),
        {
          $group: {
            _id: { month: '$saleMonth', dayOfWeek: '$saleDayOfWeek' },
            faturamentoLiquido: { $sum: '$netValue' },
            faturamentoBruto: { $sum: '$totalValue' },
            quantidadeVendas: { $sum: 1 },
          },
        },
      ]),
      Sale.aggregate([
        { $match: { userId: userObjectId, createdAt } },
        saleLocalDatePartsStage(),
        {
          $group: {
            _id: '$saleMonth',
            faturamentoLiquido: { $sum: '$netValue' },
            quantidadeVendas: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Sale.aggregate([
        { $match: { userId: userObjectId, createdAt } },
        saleLocalDatePartsStage(),
        {
          $group: {
            _id: '$saleDayOfWeek',
            faturamentoLiquido: { $sum: '$netValue' },
            faturamentoBruto: { $sum: '$totalValue' },
            quantidadeVendas: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const heatmap = heatmapRows
      .filter((row) => row._id.dayOfWeek >= 1 && row._id.dayOfWeek <= 7)
      .map((row) => ({
      month: row._id.month,
      monthLabel: MONTH_LABELS_SHORT[row._id.month - 1] ?? String(row._id.month),
      dayOfWeek: row._id.dayOfWeek,
      dayLabel: dayLabelFromMongo(row._id.dayOfWeek),
      faturamentoLiquido: round2(row.faturamentoLiquido),
      faturamentoBruto: round2(row.faturamentoBruto),
      quantidadeVendas: row.quantidadeVendas,
    }));

    const byMonth = byMonthRows
      .filter((row) => row._id >= 1 && row._id <= 12)
      .map((row) => ({
      month: row._id,
      monthLabel: MONTH_LABELS_SHORT[row._id - 1] ?? String(row._id),
      faturamentoLiquido: round2(row.faturamentoLiquido),
      quantidadeVendas: row.quantidadeVendas,
    }));

    const byDayOfWeek = byDayRows
      .filter((row) => row._id >= 1 && row._id <= 7)
      .map((row) => ({
      dayOfWeek: row._id,
      dayLabel: dayLabelFromMongo(row._id),
      faturamentoLiquido: round2(row.faturamentoLiquido),
      faturamentoBruto: round2(row.faturamentoBruto),
      quantidadeVendas: row.quantidadeVendas,
    }));

    const sortedByRevenue = [...byDayOfWeek].sort(
      (a, b) => b.faturamentoLiquido - a.faturamentoLiquido
    );
    const melhorDia = sortedByRevenue[0] ?? null;
    const piorDia = sortedByRevenue.length > 0
      ? sortedByRevenue[sortedByRevenue.length - 1]
      : null;

    const sortedByQty = [...byDayOfWeek].sort(
      (a, b) => b.quantidadeVendas - a.quantidadeVendas
    );

    res.json({
      success: true,
      data: {
        heatmap,
        byMonth,
        byDayOfWeek,
        melhorDia,
        piorDia,
        melhorDiaPorQuantidade: sortedByQty[0] ?? null,
        piorDiaPorQuantidade: sortedByQty.length > 0
          ? sortedByQty[sortedByQty.length - 1]
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getProcedureMix(req, res, next) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'startDate e endDate são obrigatórios',
      });
    }

    const createdAt = parseDateRange(startDate, endDate);
    if (!createdAt.$gte || !createdAt.$lte) {
      return res.status(400).json({
        success: false,
        message: 'Datas inválidas',
      });
    }

    const halves = splitPeriodHalves(createdAt.$gte, createdAt.$lte);

    const [mixRows, firstHalfRows, secondHalfRows, comboSales] = await Promise.all([
      Sale.aggregate([
        { $match: { userId: userObjectId, createdAt } },
        ...buildSaleItemsAllocationStages(),
        { $unwind: '$items' },
        {
          $group: {
            _id: {
              procedureId: '$items.procedureId',
              procedureName: '$items.procedureName',
            },
            quantidade: { $sum: '$items.quantity' },
            faturamentoBruto: { $sum: '$items.grossValueAllocated' },
            faturamentoLiquido: { $sum: '$items.netValueAllocated' },
          },
        },
        { $sort: { faturamentoLiquido: -1 } },
      ]),
      Sale.aggregate([
        {
          $match: {
            userId: userObjectId,
            createdAt: { $gte: halves.first.start, $lte: halves.first.end },
          },
        },
        ...buildSaleItemsAllocationStages(),
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.procedureName',
            faturamentoLiquido: { $sum: '$items.netValueAllocated' },
          },
        },
      ]),
      Sale.aggregate([
        {
          $match: {
            userId: userObjectId,
            createdAt: { $gte: halves.second.start, $lte: halves.second.end },
          },
        },
        ...buildSaleItemsAllocationStages(),
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.procedureName',
            faturamentoLiquido: { $sum: '$items.netValueAllocated' },
          },
        },
      ]),
      Sale.find({
        userId: userObjectId,
        createdAt,
        'items.1': { $exists: true },
      })
        .select('items totalValue netValue')
        .lean(),
    ]);

    const totalLiquido = mixRows.reduce((sum, row) => sum + row.faturamentoLiquido, 0);

    const mix = mixRows.map((row) => ({
      procedureId: row._id.procedureId ? row._id.procedureId.toString() : null,
      procedureName: row._id.procedureName || 'Sem nome',
      quantidade: row.quantidade,
      faturamentoBruto: round2(row.faturamentoBruto),
      faturamentoLiquido: round2(row.faturamentoLiquido),
      percentual: totalLiquido > 0
        ? round2((row.faturamentoLiquido / totalLiquido) * 100)
        : 0,
    }));

    const firstMap = Object.fromEntries(
      firstHalfRows.map((row) => [row._id || 'Sem nome', row.faturamentoLiquido])
    );
    const secondMap = Object.fromEntries(
      secondHalfRows.map((row) => [row._id || 'Sem nome', row.faturamentoLiquido])
    );

    const allProcedureNames = new Set([
      ...Object.keys(firstMap),
      ...Object.keys(secondMap),
    ]);

    const trends = [...allProcedureNames].map((procedureName) => {
      const primeiro = round2(firstMap[procedureName] ?? 0);
      const segundo = round2(secondMap[procedureName] ?? 0);
      let variacao = null;
      if (primeiro === 0 && segundo > 0) variacao = 100;
      else if (primeiro > 0) variacao = round2(((segundo - primeiro) / primeiro) * 100);
      else variacao = 0;

      return {
        procedureName,
        faturamentoPrimeiroPeriodo: primeiro,
        faturamentoSegundoPeriodo: segundo,
        variacao,
        tendencia: variacao === null || variacao === 0
          ? 'estavel'
          : variacao > 0
            ? 'alta'
            : 'queda',
      };
    }).sort((a, b) => Math.abs(b.variacao ?? 0) - Math.abs(a.variacao ?? 0));

    const comboMap = new Map();
    for (const sale of comboSales) {
      const names = sale.items
        .map((item) => item.procedureName)
        .filter(Boolean)
        .sort();
      if (names.length < 2) continue;

      const comboLabel = names.join(' + ');
      const current = comboMap.get(comboLabel) ?? {
        comboLabel,
        procedimentos: names,
        quantidade: 0,
        faturamentoBruto: 0,
        faturamentoLiquido: 0,
      };

      current.quantidade += 1;
      current.faturamentoBruto += sale.totalValue ?? 0;
      current.faturamentoLiquido += sale.netValue ?? 0;
      comboMap.set(comboLabel, current);
    }

    const combinations = [...comboMap.values()]
      .map((row) => ({
        comboLabel: row.comboLabel,
        procedimentos: row.procedimentos,
        quantidade: row.quantidade,
        faturamentoBruto: round2(row.faturamentoBruto),
        faturamentoLiquido: round2(row.faturamentoLiquido),
      }))
      .sort((a, b) => b.quantidade - a.quantidade || b.faturamentoLiquido - a.faturamentoLiquido)
      .slice(0, 20);

    res.json({
      success: true,
      data: {
        mix,
        trends,
        combinations,
        totais: {
          faturamentoLiquido: round2(totalLiquido),
          quantidadeProcedimentos: mix.reduce((sum, row) => sum + row.quantidade, 0),
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getCalendarOccupancy(req, res, next) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'startDate e endDate são obrigatórios',
      });
    }

    const createdAt = parseDateRange(startDate, endDate);
    if (!createdAt.$gte || !createdAt.$lte) {
      return res.status(400).json({
        success: false,
        message: 'Datas inválidas',
      });
    }

    const user = await User.findById(req.userId).select(
      'googleCalendarConnected googleCalendarId googleCalendarName'
    );

    if (!user?.googleCalendarConnected) {
      return res.status(400).json({
        success: false,
        code: 'CALENDAR_NOT_CONNECTED',
        error: 'Conecte o Google Calendar na Agenda para ver a ocupação.',
      });
    }

    const { timeMin, timeMax } = calendarQueryBounds(startDate, endDate);

    const [events, sales] = await Promise.all([
      getEvents(req.userId, {
        calendarId: user.googleCalendarId || 'primary',
        timeMin,
        timeMax,
        maxResults: 2500,
        singleEvents: true,
        orderBy: 'startTime',
      }),
      Sale.find({
        userId: userObjectId,
        createdAt,
      })
        .select('createdAt totalValue netValue')
        .lean(),
    ]);

    const eventsByHour = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      hourLabel: `${String(hour).padStart(2, '0')}h`,
      quantidadeEventos: 0,
    }));

    const salesByHour = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      hourLabel: `${String(hour).padStart(2, '0')}h`,
      quantidadeVendas: 0,
      faturamentoLiquido: 0,
    }));

    const eventsByDate = new Map();
    const salesByDate = new Map();

    let eventosComHorario = 0;
    let eventosDiaInteiro = 0;

    for (const sale of sales) {
      const dateKey = dateKeyInTz(sale.createdAt);
      const hour = hourInTz(sale.createdAt);

      salesByHour[hour].quantidadeVendas += 1;
      salesByHour[hour].faturamentoLiquido += sale.netValue ?? 0;

      const day = salesByDate.get(dateKey) ?? {
        date: dateKey,
        quantidadeVendas: 0,
        faturamentoLiquido: 0,
      };
      day.quantidadeVendas += 1;
      day.faturamentoLiquido += sale.netValue ?? 0;
      salesByDate.set(dateKey, day);
    }

    const eventosAgendaSemVenda = [];

    for (const event of events) {
      const timing = parseCalendarEventTiming(event);
      if (!timing) continue;

      if (timing.isAllDay) {
        eventosDiaInteiro += 1;
      } else if (timing.hour !== null) {
        eventosComHorario += 1;
        eventsByHour[timing.hour].quantidadeEventos += 1;
      }

      const day = eventsByDate.get(timing.dateKey) ?? {
        date: timing.dateKey,
        quantidadeEventos: 0,
        horasAgendadas: 0,
      };
      day.quantidadeEventos += 1;
      day.horasAgendadas += timing.durationHours;
      eventsByDate.set(timing.dateKey, day);

      const vendasNoDia = salesByDate.get(timing.dateKey)?.quantidadeVendas ?? 0;
      if (vendasNoDia === 0) {
        const { clientName, telefone } = parseEventClient(event);
        eventosAgendaSemVenda.push({
          date: timing.dateKey,
          horario: formatEventHorario(timing),
          clientName,
          telefone,
          titulo: event.summary || 'Sem título',
        });
      }
    }

    salesByHour.forEach((row) => {
      row.faturamentoLiquido = round2(row.faturamentoLiquido);
    });

    const allDates = new Set([...eventsByDate.keys(), ...salesByDate.keys()]);
    const dailyComparison = [...allDates]
      .sort()
      .map((date) => {
        const ev = eventsByDate.get(date) ?? { quantidadeEventos: 0, horasAgendadas: 0 };
        const sl = salesByDate.get(date) ?? { quantidadeVendas: 0, faturamentoLiquido: 0 };
        const quantidadeEventos = ev.quantidadeEventos ?? 0;
        const quantidadeVendas = sl.quantidadeVendas ?? 0;

        return {
          date,
          quantidadeEventos,
          horasAgendadas: round2(ev.horasAgendadas ?? 0),
          quantidadeVendas,
          faturamentoLiquido: round2(sl.faturamentoLiquido ?? 0),
          teveVendaNoDia: quantidadeEventos > 0 && quantidadeVendas > 0,
          agendaSemVenda: quantidadeEventos > 0 && quantidadeVendas === 0,
        };
      });

    const diasAgendaSemVenda = dailyComparison.filter((row) => row.agendaSemVenda);
    const diasComAgendaEVenda = dailyComparison.filter((row) => row.teveVendaNoDia).length;
    const horariosMaisCheios = [...eventsByHour]
      .filter((row) => row.quantidadeEventos > 0)
      .sort((a, b) => b.quantidadeEventos - a.quantidadeEventos)
      .slice(0, 5);

    const horariosMaisVendas = [...salesByHour]
      .filter((row) => row.quantidadeVendas > 0)
      .sort((a, b) => b.quantidadeVendas - a.quantidadeVendas)
      .slice(0, 5);

    const totalEventos = events.length;
    const totalVendas = sales.length;
    const diasComAgenda = dailyComparison.filter((row) => row.quantidadeEventos > 0).length;
    const diasComVenda = dailyComparison.filter((row) => row.quantidadeVendas > 0).length;

    res.json({
      success: true,
      data: {
        resumo: {
          totalEventos,
          totalVendas,
          eventosComHorario,
          eventosDiaInteiro,
          diasComAgenda,
          diasComVenda,
          diasComAgendaEVenda,
          diasAgendaSemVenda: diasAgendaSemVenda.length,
          taxaConversaoGeral: diasComAgenda > 0
            ? round2((diasComAgendaEVenda / diasComAgenda) * 100)
            : null,
          calendarId: user.googleCalendarId || 'primary',
          calendarName: user.googleCalendarName || 'Principal',
        },
        eventsByHour,
        salesByHour,
        horariosMaisCheios,
        horariosMaisVendas,
        dailyComparison,
        diasAgendaSemVenda: diasAgendaSemVenda.slice(0, 30),
        eventosAgendaSemVenda: eventosAgendaSemVenda
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(0, 50),
      },
    });
  } catch (error) {
    if (
      error.message?.includes('não conectou') ||
      error.message?.includes('Reconecte')
    ) {
      return res.status(400).json({
        success: false,
        code: 'CALENDAR_NOT_CONNECTED',
        error: error.message,
      });
    }
    next(error);
  }
}

module.exports = {
  getSeasonality,
  getProcedureMix,
  getCalendarOccupancy,
};
