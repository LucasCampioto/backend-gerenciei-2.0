/**
 * Loop de aprendizado leve: agrega feedback/outcomes das ações comerciais
 * para afinar heurísticas e prompts (Fase 4).
 */
const CommercialAction = require('../models/CommercialAction');
const mongoose = require('mongoose');

async function getLearningSignals(userId, { days = 30 } = {}) {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const since = new Date();
  since.setDate(since.getDate() - days);

  const rows = await CommercialAction.aggregate([
    {
      $match: {
        userId: userObjectId,
        updatedAt: { $gte: since },
      },
    },
    {
      $group: {
        _id: {
          source: '$source',
          feedback: '$feedback',
          outcome: '$outcome',
          agentName: '$agentName',
        },
        count: { $sum: 1 },
        realizedRevenue: { $sum: '$realizedRevenue' },
        avgExpectedValue: { $avg: '$expectedValue' },
      },
    },
  ]);

  const accepted = rows
    .filter((r) => r._id.feedback === 'accepted')
    .reduce((sum, r) => sum + r.count, 0);
  const edited = rows
    .filter((r) => r._id.feedback === 'edited')
    .reduce((sum, r) => sum + r.count, 0);
  const rejected = rows
    .filter((r) => r._id.feedback === 'rejected')
    .reduce((sum, r) => sum + r.count, 0);
  const won = rows
    .filter((r) => r._id.outcome === 'won')
    .reduce((sum, r) => sum + r.count, 0);

  const totalFeedback = accepted + edited + rejected;
  const acceptRate = totalFeedback > 0 ? accepted / totalFeedback : null;

  return {
    days,
    acceptRate,
    counts: { accepted, edited, rejected, won, totalFeedback },
    byBucket: rows.map((r) => ({
      source: r._id.source,
      feedback: r._id.feedback,
      outcome: r._id.outcome,
      agentName: r._id.agentName,
      count: r.count,
      realizedRevenue: r.realizedRevenue,
      avgExpectedValue: r.avgExpectedValue,
    })),
    promptHints: [
      acceptRate != null && acceptRate < 0.4
        ? 'Taxa de aceitação baixa: encurtar scripts e priorizar expectedValue mais conservador.'
        : null,
      edited > accepted
        ? 'Muitas edições: manter tom, mas deixar campos de preço/mensagem mais abertos.'
        : null,
      won > 0
        ? 'Há wins atribuídos — reforçar padrões dos agents que geraram outcome won.'
        : null,
    ].filter(Boolean),
  };
}

module.exports = { getLearningSignals };
