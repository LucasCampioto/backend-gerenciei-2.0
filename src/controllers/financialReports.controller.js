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

async function getMonthlyRevenue(req, res, next) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const currentYear = new Date().getUTCFullYear();
    const year = parseInt(req.query.year, 10) || currentYear;

    if (year < 2000 || year > currentYear + 1) {
      return res.status(400).json({
        success: false,
        message: 'Ano inválido',
      });
    }

    const startOfYear = new Date(Date.UTC(year, 0, 1));
    const endOfYear = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    const salesByMonth = await Sale.aggregate([
      {
        $match: {
          userId: userObjectId,
          createdAt: { $gte: startOfYear, $lte: endOfYear },
        },
      },
      {
        $group: {
          _id: { $month: '$createdAt' },
          faturamentoBruto: { $sum: '$totalValue' },
          faturamentoLiquido: { $sum: '$netValue' },
          comissao: { $sum: '$commissionValue' },
          quantidadeVendas: { $sum: 1 },
        },
      },
    ]);

    const byMonth = {};
    for (const row of salesByMonth) {
      byMonth[row._id] = row;
    }

    const data = [];
    for (let mes = 1; mes <= 12; mes++) {
      const row = byMonth[mes];
      data.push({
        ano: year,
        mes,
        mesLabel: `${MONTH_LABELS[mes - 1]}/${year}`,
        faturamentoBruto: round2(row?.faturamentoBruto ?? 0),
        faturamentoLiquido: round2(row?.faturamentoLiquido ?? 0),
        comissao: round2(row?.comissao ?? 0),
        quantidadeVendas: row?.quantidadeVendas ?? 0,
      });
    }

    const totais = {
      faturamentoBruto: round2(data.reduce((sum, r) => sum + r.faturamentoBruto, 0)),
      faturamentoLiquido: round2(data.reduce((sum, r) => sum + r.faturamentoLiquido, 0)),
      comissao: round2(data.reduce((sum, r) => sum + r.comissao, 0)),
      quantidadeVendas: data.reduce((sum, r) => sum + r.quantidadeVendas, 0),
    };

    res.json({
      success: true,
      data,
      totais,
    });
  } catch (error) {
    next(error);
  }
}

async function getSalesByProcedure(req, res, next) {
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

    const rows = await Sale.aggregate([
      {
        $match: {
          userId: userObjectId,
          createdAt,
        },
      },
      {
        $addFields: {
          items: {
            $map: {
              input: '$items',
              as: 'item',
              in: {
                $mergeObjects: [
                  '$$item',
                  {
                    netValueAllocated: {
                      $cond: [
                        { $gt: ['$totalValue', 0] },
                        {
                          $multiply: [
                            '$netValue',
                            { $divide: ['$$item.totalValue', '$totalValue'] },
                          ],
                        },
                        0,
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      },
      { $unwind: '$items' },
      {
        $group: {
          _id: {
            procedureId: '$items.procedureId',
            procedureName: '$items.procedureName',
          },
          quantidade: { $sum: '$items.quantity' },
          faturamentoBruto: { $sum: '$items.totalValue' },
          faturamentoLiquido: { $sum: '$items.netValueAllocated' },
        },
      },
      { $sort: { quantidade: -1, faturamentoBruto: -1 } },
    ]);

    const data = rows.map((row) => ({
      procedureId: row._id.procedureId ? row._id.procedureId.toString() : null,
      procedureName: row._id.procedureName || 'Sem nome',
      quantidade: row.quantidade,
      faturamentoBruto: round2(row.faturamentoBruto),
      faturamentoLiquido: round2(row.faturamentoLiquido),
    }));

    const totais = {
      quantidade: data.reduce((sum, r) => sum + r.quantidade, 0),
      faturamentoBruto: round2(data.reduce((sum, r) => sum + r.faturamentoBruto, 0)),
      faturamentoLiquido: round2(data.reduce((sum, r) => sum + r.faturamentoLiquido, 0)),
    };

    res.json({
      success: true,
      data,
      totais,
    });
  } catch (error) {
    next(error);
  }
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
        comissao: { $sum: '$commissionValue' },
        quantidadeVendas: { $sum: 1 },
      },
    },
  ]);

  const quantidadeVendas = result?.quantidadeVendas ?? 0;
  const faturamentoLiquido = result?.faturamentoLiquido ?? 0;

  return {
    faturamentoBruto: round2(result?.faturamentoBruto ?? 0),
    faturamentoLiquido: round2(faturamentoLiquido),
    comissao: round2(result?.comissao ?? 0),
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

async function getTopProcedures(userObjectId, start, end, limit = 3) {
  const rows = await Sale.aggregate([
    {
      $match: {
        userId: userObjectId,
        createdAt: { $gte: start, $lte: end },
      },
    },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.procedureName',
        quantidade: { $sum: '$items.quantity' },
        faturamentoBruto: { $sum: '$items.totalValue' },
      },
    },
    { $sort: { quantidade: -1, faturamentoBruto: -1 } },
    { $limit: limit },
  ]);

  return rows.map((row) => ({
    procedureName: row._id || 'Sem nome',
    quantidade: row.quantidade,
    faturamentoBruto: round2(row.faturamentoBruto),
  }));
}

async function getTopEmployees(userObjectId, start, end, limit = 3) {
  const rows = await Sale.aggregate([
    {
      $match: {
        userId: userObjectId,
        createdAt: { $gte: start, $lte: end },
        employeeId: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: { employeeId: '$employeeId', employeeName: '$employeeName' },
        quantidadeVendas: { $sum: 1 },
        faturamentoLiquido: { $sum: '$netValue' },
      },
    },
    { $sort: { faturamentoLiquido: -1 } },
    { $limit: limit },
  ]);

  return rows.map((row) => ({
    employeeId: row._id.employeeId ? row._id.employeeId.toString() : null,
    employeeName: row._id.employeeName || 'Colaborador',
    quantidadeVendas: row.quantidadeVendas,
    faturamentoLiquido: round2(row.faturamentoLiquido),
  }));
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

function buildPeriodMeta(start, end) {
  const startLabel = formatDateBr(start);
  const endLabel = formatDateBr(end);
  const sameDay = startLabel === endLabel;

  return {
    ano: start.getUTCFullYear(),
    mes: start.getUTCMonth() + 1,
    mesLabel: sameDay ? startLabel : `${startLabel} a ${endLabel}`,
  };
}

async function getExecutiveDashboard(req, res, next) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const { startDate, endDate } = req.query;

    let currentRange;
    let previousRange;
    let currentMeta;
    let previousMeta;

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
      currentMeta = buildPeriodMeta(currentRange.start, currentRange.end);
      previousMeta = buildPeriodMeta(previousRange.start, previousRange.end);
    } else {
      const now = new Date();
      const currentYear = now.getUTCFullYear();
      const currentMonth = now.getUTCMonth() + 1;
      const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
      const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

      currentRange = getMonthUtcRange(currentYear, currentMonth);
      previousRange = getMonthUtcRange(prevYear, prevMonth);
      currentMeta = {
        ano: currentYear,
        mes: currentMonth,
        mesLabel: `${MONTH_LABELS[currentMonth - 1]}/${currentYear}`,
      };
      previousMeta = {
        ano: prevYear,
        mes: prevMonth,
        mesLabel: `${MONTH_LABELS[prevMonth - 1]}/${prevYear}`,
      };
    }

    const [
      currentSales,
      previousSales,
      currentExpenses,
      previousExpenses,
      topProcedures,
      topEmployees,
    ] = await Promise.all([
      aggregateSalesSummary(userObjectId, currentRange.start, currentRange.end),
      aggregateSalesSummary(userObjectId, previousRange.start, previousRange.end),
      aggregateExpensesTotal(userObjectId, currentRange.start, currentRange.end),
      aggregateExpensesTotal(userObjectId, previousRange.start, previousRange.end),
      getTopProcedures(userObjectId, currentRange.start, currentRange.end),
      getTopEmployees(userObjectId, currentRange.start, currentRange.end),
    ]);

    const currentLucro = round2(currentSales.faturamentoLiquido - currentExpenses);
    const previousLucro = round2(previousSales.faturamentoLiquido - previousExpenses);

    res.json({
      success: true,
      data: {
        mesAtual: {
          ...currentMeta,
          ...currentSales,
          gastos: currentExpenses,
          lucro: currentLucro,
        },
        mesAnterior: {
          ...previousMeta,
          ...previousSales,
          gastos: previousExpenses,
          lucro: previousLucro,
        },
        variacoes: {
          faturamentoLiquido: calcVariation(
            currentSales.faturamentoLiquido,
            previousSales.faturamentoLiquido
          ),
          quantidadeVendas: calcVariation(
            currentSales.quantidadeVendas,
            previousSales.quantidadeVendas
          ),
          gastos: calcVariation(currentExpenses, previousExpenses),
          lucro: calcVariation(currentLucro, previousLucro),
          ticketMedio: calcVariation(currentSales.ticketMedio, previousSales.ticketMedio),
        },
        topProcedures,
        topEmployees,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getEmployeePerformance(req, res, next) {
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

    const rows = await Sale.aggregate([
      {
        $match: {
          userId: userObjectId,
          createdAt,
          employeeId: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: { employeeId: '$employeeId', employeeName: '$employeeName' },
          quantidadeVendas: { $sum: 1 },
          faturamentoBruto: { $sum: '$totalValue' },
          faturamentoLiquido: { $sum: '$netValue' },
          comissao: { $sum: '$commissionValue' },
        },
      },
      { $sort: { faturamentoLiquido: -1, quantidadeVendas: -1 } },
    ]);

    const data = rows.map((row) => {
      const quantidadeVendas = row.quantidadeVendas;
      const faturamentoLiquido = row.faturamentoLiquido ?? 0;
      return {
        employeeId: row._id.employeeId ? row._id.employeeId.toString() : null,
        employeeName: row._id.employeeName || 'Colaborador',
        quantidadeVendas,
        faturamentoBruto: round2(row.faturamentoBruto),
        faturamentoLiquido: round2(faturamentoLiquido),
        comissao: round2(row.comissao),
        ticketMedio:
          quantidadeVendas > 0 ? round2(faturamentoLiquido / quantidadeVendas) : 0,
      };
    });

    const totais = {
      quantidadeVendas: data.reduce((sum, r) => sum + r.quantidadeVendas, 0),
      faturamentoBruto: round2(data.reduce((sum, r) => sum + r.faturamentoBruto, 0)),
      faturamentoLiquido: round2(data.reduce((sum, r) => sum + r.faturamentoLiquido, 0)),
      comissao: round2(data.reduce((sum, r) => sum + r.comissao, 0)),
    };

    res.json({ success: true, data, totais });
  } catch (error) {
    next(error);
  }
}

async function getPaymentMethods(req, res, next) {
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

    const rows = await Sale.aggregate([
      {
        $match: {
          userId: userObjectId,
          createdAt,
        },
      },
      {
        $group: {
          _id: '$paymentMethod',
          quantidadeVendas: { $sum: 1 },
          faturamentoBruto: { $sum: '$totalValue' },
          faturamentoLiquido: { $sum: '$netValue' },
        },
      },
      { $sort: { faturamentoLiquido: -1 } },
    ]);

    const totalLiquido = rows.reduce((sum, r) => sum + (r.faturamentoLiquido ?? 0), 0);

    const data = rows.map((row) => ({
      paymentMethod: row._id || 'Não informado',
      quantidadeVendas: row.quantidadeVendas,
      faturamentoBruto: round2(row.faturamentoBruto),
      faturamentoLiquido: round2(row.faturamentoLiquido),
      percentual:
        totalLiquido > 0
          ? round2((row.faturamentoLiquido / totalLiquido) * 100)
          : 0,
    }));

    const totais = {
      quantidadeVendas: data.reduce((sum, r) => sum + r.quantidadeVendas, 0),
      faturamentoBruto: round2(data.reduce((sum, r) => sum + r.faturamentoBruto, 0)),
      faturamentoLiquido: round2(totalLiquido),
    };

    res.json({ success: true, data, totais });
  } catch (error) {
    next(error);
  }
}

async function getProceduresByPaymentMethod(req, res, next) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const { startDate, endDate, paymentMethod } = req.query;

    if (!startDate || !endDate || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'startDate, endDate e paymentMethod são obrigatórios',
      });
    }

    const createdAt = parseDateRange(startDate, endDate);
    if (!createdAt.$gte || !createdAt.$lte) {
      return res.status(400).json({
        success: false,
        message: 'Datas inválidas',
      });
    }

    const rows = await Sale.aggregate([
      {
        $match: {
          userId: userObjectId,
          createdAt,
          paymentMethod,
        },
      },
      {
        $addFields: {
          items: {
            $map: {
              input: '$items',
              as: 'item',
              in: {
                $mergeObjects: [
                  '$$item',
                  {
                    netValueAllocated: {
                      $cond: [
                        { $gt: ['$totalValue', 0] },
                        {
                          $multiply: [
                            '$netValue',
                            { $divide: ['$$item.totalValue', '$totalValue'] },
                          ],
                        },
                        0,
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      },
      { $unwind: '$items' },
      {
        $group: {
          _id: {
            procedureId: '$items.procedureId',
            procedureName: '$items.procedureName',
          },
          quantidade: { $sum: '$items.quantity' },
          faturamentoBruto: { $sum: '$items.totalValue' },
          faturamentoLiquido: { $sum: '$items.netValueAllocated' },
        },
      },
      { $sort: { quantidade: -1, faturamentoBruto: -1 } },
    ]);

    const data = rows.map((row) => ({
      procedureId: row._id.procedureId ? row._id.procedureId.toString() : null,
      procedureName: row._id.procedureName || 'Sem nome',
      quantidade: row.quantidade,
      faturamentoBruto: round2(row.faturamentoBruto),
      faturamentoLiquido: round2(row.faturamentoLiquido),
    }));

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function getMonthComparison(req, res, next) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const monthsCount = Math.min(Math.max(parseInt(req.query.months, 10) || 12, 2), 24);

    const now = new Date();
    let year = now.getUTCFullYear();
    let month = now.getUTCMonth() + 1;

    const months = [];
    for (let i = 0; i < monthsCount; i++) {
      months.unshift({ year, month });
      month -= 1;
      if (month === 0) {
        month = 12;
        year -= 1;
      }
    }

    const data = [];
    for (const { year: y, month: m } of months) {
      const range = getMonthUtcRange(y, m);
      const [sales, gastos] = await Promise.all([
        aggregateSalesSummary(userObjectId, range.start, range.end),
        aggregateExpensesTotal(userObjectId, range.start, range.end),
      ]);
      const lucro = round2(sales.faturamentoLiquido - gastos);

      data.push({
        ano: y,
        mes: m,
        mesLabel: `${MONTH_LABELS[m - 1]}/${y}`,
        faturamentoBruto: sales.faturamentoBruto,
        faturamentoLiquido: sales.faturamentoLiquido,
        quantidadeVendas: sales.quantidadeVendas,
        ticketMedio: sales.ticketMedio,
        gastos,
        lucro,
      });
    }

    const withVariations = data.map((row, index) => {
      if (index === 0) {
        return {
          ...row,
          variacaoFaturamentoLiquido: null,
          variacaoQuantidadeVendas: null,
          variacaoLucro: null,
        };
      }

      const previous = data[index - 1];
      return {
        ...row,
        variacaoFaturamentoLiquido: calcVariation(
          row.faturamentoLiquido,
          previous.faturamentoLiquido
        ),
        variacaoQuantidadeVendas: calcVariation(
          row.quantidadeVendas,
          previous.quantidadeVendas
        ),
        variacaoLucro: calcVariation(row.lucro, previous.lucro),
      };
    });

    res.json({
      success: true,
      data: withVariations,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getMonthlyRevenue,
  getSalesByProcedure,
  getExecutiveDashboard,
  getEmployeePerformance,
  getPaymentMethods,
  getProceduresByPaymentMethod,
  getMonthComparison,
};
