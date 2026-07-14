const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const Expense = require('../models/Expense');

const MONTH_LABELS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
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

function calcVariation(current, previous) {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return round2(((current - previous) / previous) * 100);
}

function getMonthUtcRange(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { start, end };
}

function formatDateIso(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateBr(date) {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function getPreviousPeriodRange(start, end) {
  const startMs = start.getTime();
  const endMs = end.getTime();
  const days = Math.max(1, Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1);

  const previousEnd = new Date(start);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  previousEnd.setUTCHours(23, 59, 59, 999);

  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - (days - 1));
  previousStart.setUTCHours(0, 0, 0, 0);

  return { start: previousStart, end: previousEnd };
}

function buildPeriodLabel(start, end) {
  if (
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCDate() === 1 &&
    end.getUTCDate() === new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate()
  ) {
    return `${MONTH_LABELS[start.getUTCMonth()]}/${start.getUTCFullYear()}`;
  }

  const startLabel = formatDateBr(start);
  const endLabel = formatDateBr(end);
  return startLabel === endLabel ? startLabel : `${startLabel} a ${endLabel}`;
}

async function aggregateSalesSummary(userObjectId, start, end) {
  const [result] = await Sale.aggregate([
    {
      $match: {
        userId: userObjectId,
        createdAt: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: null,
        faturamentoBruto: { $sum: '$totalValue' },
        faturamentoLiquido: { $sum: '$netValue' },
        quantidadeVendas: { $sum: 1 },
      },
    },
  ]);

  const quantidadeVendas = result?.quantidadeVendas ?? 0;
  const faturamentoLiquido = result?.faturamentoLiquido ?? 0;

  return {
    faturamentoBruto: round2(result?.faturamentoBruto ?? 0),
    faturamentoLiquido: round2(faturamentoLiquido),
    quantidadeVendas,
    ticketMedio: quantidadeVendas > 0 ? round2(faturamentoLiquido / quantidadeVendas) : 0,
  };
}

async function aggregateExpensesTotal(userObjectId, start, end) {
  const [result] = await Expense.aggregate([
    {
      $match: {
        userId: userObjectId,
        createdAt: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$value' },
      },
    },
  ]);

  return round2(result?.total ?? 0);
}

async function aggregateRecurrenceRate(userObjectId, start, end, windowDays = 30) {
  const salesByClient = await Sale.aggregate([
    {
      $match: {
        userId: userObjectId,
        createdAt: { $gte: start, $lte: end },
        clientId: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: '$clientId',
        saleDates: { $push: '$createdAt' },
        quantidadeVendas: { $sum: 1 },
      },
    },
  ]);

  if (salesByClient.length === 0) {
    return null;
  }

  let recorrentes = 0;

  for (const row of salesByClient) {
    if (row.quantidadeVendas < 2) continue;

    const saleDates = row.saleDates
      .map((d) => new Date(d))
      .sort((a, b) => a.getTime() - b.getTime());

    for (let i = 1; i < saleDates.length; i += 1) {
      const gapMs = saleDates[i].getTime() - saleDates[i - 1].getTime();
      const gapDays = Math.round(gapMs / (24 * 60 * 60 * 1000));
      if (gapDays <= windowDays) {
        recorrentes += 1;
        break;
      }
    }
  }

  return round2((recorrentes / salesByClient.length) * 100);
}

function buildInsights({
  quantidadeVendas,
  lucro,
  variacoes,
  taxaRecorrencia,
}) {
  const insights = [];
  let score = 70;

  if (quantidadeVendas === 0) {
    insights.push({
      severity: 'critical',
      title: 'Nenhuma venda no período',
      detail: 'Não houve vendas registradas neste intervalo. Confira o funil e a agenda.',
      ctaPath: '/dashboard',
    });
    score -= 30;
  }

  if (lucro < 0) {
    insights.push({
      severity: 'critical',
      title: 'Lucro negativo',
      detail: 'O resultado do período está negativo. Revise gastos e margem.',
      ctaPath: '/lucro',
    });
    score -= 20;
  }

  if (variacoes.lucro < -10) {
    insights.push({
      severity: 'warning',
      title: `Lucro caiu ${Math.abs(variacoes.lucro)}% vs período anterior`,
      detail: 'Compare o mês atual com o anterior para entender a queda.',
      ctaPath: '/comparativo-mensal',
    });
    score -= 12;
  } else if (variacoes.lucro > 10) {
    insights.push({
      severity: 'positive',
      title: `Lucro subiu ${variacoes.lucro}% vs período anterior`,
      detail: 'Bom ritmo de resultado. Continue acompanhando custos e ticket médio.',
      ctaPath: '/comparativo-mensal',
    });
    score += 10;
  }

  if (variacoes.gastos > 20) {
    insights.push({
      severity: 'warning',
      title: `Gastos subiram ${variacoes.gastos}% vs período anterior`,
      detail: 'Os custos cresceram bastante. Revise categorias e despesas recorrentes.',
      ctaPath: '/gastos',
    });
    score -= 10;
  }

  if (variacoes.faturamentoLiquido < -10) {
    insights.push({
      severity: 'warning',
      title: `Faturamento caiu ${Math.abs(variacoes.faturamentoLiquido)}% vs período anterior`,
      detail: 'A receita líquida está abaixo do período anterior.',
      ctaPath: '/faturamento-mensal',
    });
    score -= 8;
  } else if (variacoes.faturamentoLiquido > 10) {
    insights.push({
      severity: 'positive',
      title: `Faturamento subiu ${variacoes.faturamentoLiquido}% vs período anterior`,
      detail: 'A receita líquida está em alta em relação ao período anterior.',
      ctaPath: '/faturamento-mensal',
    });
    score += 6;
  }

  if (taxaRecorrencia !== null && taxaRecorrencia < 20 && quantidadeVendas > 0) {
    insights.push({
      severity: 'warning',
      title: `Taxa de recorrência em ${taxaRecorrencia}%`,
      detail: 'Poucos clientes voltaram a comprar. Incentive retorno e reativação.',
      ctaPath: '/recorrencia-clientes',
    });
    score -= 10;
  } else if (taxaRecorrencia !== null && taxaRecorrencia >= 40) {
    insights.push({
      severity: 'positive',
      title: `Boa recorrência de clientes (${taxaRecorrencia}%)`,
      detail: 'Uma parcela saudável dos clientes está voltando a comprar.',
      ctaPath: '/recorrencia-clientes',
    });
    score += 6;
  }

  if (variacoes.ticketMedio < -10 && quantidadeVendas > 0) {
    insights.push({
      severity: 'info',
      title: `Ticket médio caiu ${Math.abs(variacoes.ticketMedio)}%`,
      detail: 'Clientes estão gastando menos por venda. Avalie mix e upsell.',
      ctaPath: '/mix-procedimentos',
    });
    score -= 4;
  }

  if (insights.length === 0) {
    insights.push({
      severity: 'info',
      title: 'Negócio estável no período',
      detail: 'Sem alertas críticos. Continue monitorando lucro, gastos e recorrência.',
      ctaPath: '/dashboard',
    });
  }

  const severityOrder = { critical: 0, warning: 1, info: 2, positive: 3 };
  insights.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    insights,
    score: clamp(Math.round(score), 0, 100),
  };
}

async function getBusinessHealth(req, res, next) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const { startDate, endDate } = req.query;

    let currentRange;
    let previousRange;
    let periodLabel;

    if (startDate && endDate) {
      const createdAt = parseDateRange(startDate, endDate);
      if (!createdAt.$gte || !createdAt.$lte) {
        return res.status(400).json({
          success: false,
          message: 'Datas inválidas',
        });
      }

      currentRange = { start: createdAt.$gte, end: createdAt.$lte };
      previousRange = getPreviousPeriodRange(currentRange.start, currentRange.end);
      periodLabel = buildPeriodLabel(currentRange.start, currentRange.end);
    } else {
      const now = new Date();
      const currentYear = now.getUTCFullYear();
      const currentMonth = now.getUTCMonth() + 1;
      const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
      const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

      currentRange = getMonthUtcRange(currentYear, currentMonth);
      previousRange = getMonthUtcRange(prevYear, prevMonth);
      periodLabel = `${MONTH_LABELS[currentMonth - 1]}/${currentYear}`;
    }

    const [currentSales, previousSales, currentExpenses, previousExpenses, taxaRecorrencia] =
      await Promise.all([
        aggregateSalesSummary(userObjectId, currentRange.start, currentRange.end),
        aggregateSalesSummary(userObjectId, previousRange.start, previousRange.end),
        aggregateExpensesTotal(userObjectId, currentRange.start, currentRange.end),
        aggregateExpensesTotal(userObjectId, previousRange.start, previousRange.end),
        aggregateRecurrenceRate(userObjectId, currentRange.start, currentRange.end),
      ]);

    const lucro = round2(currentSales.faturamentoLiquido - currentExpenses);
    const previousLucro = round2(previousSales.faturamentoLiquido - previousExpenses);

    const variacoes = {
      faturamentoLiquido: calcVariation(
        currentSales.faturamentoLiquido,
        previousSales.faturamentoLiquido
      ),
      quantidadeVendas: calcVariation(
        currentSales.quantidadeVendas,
        previousSales.quantidadeVendas
      ),
      gastos: calcVariation(currentExpenses, previousExpenses),
      lucro: calcVariation(lucro, previousLucro),
      ticketMedio: calcVariation(currentSales.ticketMedio, previousSales.ticketMedio),
    };

    const { insights, score } = buildInsights({
      quantidadeVendas: currentSales.quantidadeVendas,
      lucro,
      variacoes,
      taxaRecorrencia,
    });

    res.json({
      success: true,
      data: {
        period: {
          startDate: formatDateIso(currentRange.start),
          endDate: formatDateIso(currentRange.end),
          label: periodLabel,
        },
        score,
        kpis: {
          faturamentoLiquido: currentSales.faturamentoLiquido,
          lucro,
          quantidadeVendas: currentSales.quantidadeVendas,
          ticketMedio: currentSales.ticketMedio,
          gastos: currentExpenses,
          ...(taxaRecorrencia !== null ? { taxaRecorrencia } : {}),
        },
        variacoes: {
          faturamentoLiquido: variacoes.faturamentoLiquido,
          quantidadeVendas: variacoes.quantidadeVendas,
          gastos: variacoes.gastos,
          lucro: variacoes.lucro,
          ticketMedio: variacoes.ticketMedio,
        },
        insights,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getBusinessHealth,
};
