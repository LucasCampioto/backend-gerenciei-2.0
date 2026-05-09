const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const Expense = require('../models/Expense');

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

async function getAnnualBalance(req, res, next) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const maxYear = new Date().getUTCFullYear();

    const [salesByYear, expensesByYear] = await Promise.all([
      Sale.aggregate([
        { $match: { userId: userObjectId } },
        {
          $group: {
            _id: { $year: '$createdAt' },
            lucro: { $sum: '$netValue' }
          }
        }
      ]),
      Expense.aggregate([
        { $match: { userId: userObjectId } },
        {
          $group: {
            _id: { $year: '$createdAt' },
            custo: { $sum: '$value' }
          }
        }
      ])
    ]);

    const lucroByYear = {};
    for (const row of salesByYear) {
      const y = row._id;
      if (typeof y === 'number' && y <= maxYear) {
        lucroByYear[y] = row.lucro ?? 0;
      }
    }

    const custoByYear = {};
    for (const row of expensesByYear) {
      const y = row._id;
      if (typeof y === 'number' && y <= maxYear) {
        custoByYear[y] = row.custo ?? 0;
      }
    }

    const yearsWithData = new Set([
      ...Object.keys(lucroByYear).map(Number),
      ...Object.keys(custoByYear).map(Number)
    ]);

    let minYear = maxYear;
    if (yearsWithData.size > 0) {
      minYear = Math.min(...[...yearsWithData].filter((y) => y <= maxYear));
    }

    if (minYear < 2000) {
      minYear = 2000;
    }

    const data = [];
    for (let ano = minYear; ano <= maxYear; ano++) {
      const lucro = lucroByYear[ano] ?? 0;
      const custo = custoByYear[ano] ?? 0;
      data.push({
        ano,
        lucro: round2(lucro),
        custo: round2(custo),
        totalLiquido: round2(lucro - custo)
      });
    }

    res.json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getAnnualBalance };
