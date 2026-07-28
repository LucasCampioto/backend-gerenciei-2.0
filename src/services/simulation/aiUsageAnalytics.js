const mongoose = require('mongoose');
const AiUsageEvent = require('../../models/AiUsageEvent');
const { getPricingConfig, usdToBrl } = require('./aiUsageCost');

function parseDateRange(from, to) {
  const filter = {};
  if (from) {
    const d = new Date(String(from));
    if (!Number.isNaN(d.getTime())) filter.$gte = d;
  }
  if (to) {
    const d = new Date(String(to));
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      filter.$lte = d;
    }
  }
  return Object.keys(filter).length ? filter : null;
}

function roundUsd(n) {
  return Math.round(Number(n || 0) * 1_000_000) / 1_000_000;
}

function safeAvg(total, count) {
  if (!count) return 0;
  return roundUsd(total / count);
}

async function getUsageSummary({ from, to } = {}) {
  const dateFilter = parseDateRange(from, to);
  const match = dateFilter ? { createdAt: dateFilter } : {};

  const [agg] = await AiUsageEvent.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        generations: { $sum: 1 },
        successfulGenerations: {
          $sum: { $cond: [{ $eq: ['$outcome', 'success'] }, 1, 0] },
        },
        failedGenerations: {
          $sum: { $cond: [{ $eq: ['$outcome', 'failed'] }, 1, 0] },
        },
        previewGenerations: {
          $sum: { $cond: [{ $eq: ['$eventType', 'preview'] }, 1, 0] },
        },
        simulationGenerations: {
          $sum: { $cond: [{ $eq: ['$eventType', 'simulation'] }, 1, 0] },
        },
        totalAgentAttempts: { $sum: '$agentAttempts' },
        billableAttempts: { $sum: '$billableAttempts' },
        totalCostUsd: { $sum: '$estimatedCostUsd' },
        previewCostUsd: {
          $sum: {
            $cond: [{ $eq: ['$eventType', 'preview'] }, '$estimatedCostUsd', 0],
          },
        },
        simulationCostUsd: {
          $sum: {
            $cond: [{ $eq: ['$eventType', 'simulation'] }, '$estimatedCostUsd', 0],
          },
        },
        successfulCostUsd: {
          $sum: {
            $cond: [{ $eq: ['$outcome', 'success'] }, '$estimatedCostUsd', 0],
          },
        },
        userIds: { $addToSet: '$userId' },
      },
    },
  ]);

  const totals = agg || {
    generations: 0,
    successfulGenerations: 0,
    failedGenerations: 0,
    previewGenerations: 0,
    simulationGenerations: 0,
    totalAgentAttempts: 0,
    billableAttempts: 0,
    totalCostUsd: 0,
    previewCostUsd: 0,
    simulationCostUsd: 0,
    successfulCostUsd: 0,
    userIds: [],
  };

  const activeUsers = totals.userIds?.length ?? 0;
  const pricing = getPricingConfig();

  return {
    period: { from: from || null, to: to || null },
    totals: {
      generations: totals.generations,
      successfulGenerations: totals.successfulGenerations,
      failedGenerations: totals.failedGenerations,
      previewGenerations: totals.previewGenerations,
      simulationGenerations: totals.simulationGenerations,
      totalAgentAttempts: totals.totalAgentAttempts,
      billableAttempts: totals.billableAttempts,
      totalCostUsd: roundUsd(totals.totalCostUsd),
      totalCostBrl: usdToBrl(totals.totalCostUsd, pricing),
    },
    averages: {
      costPerGenerationUsd: safeAvg(totals.totalCostUsd, totals.generations),
      costPerSuccessfulGenerationUsd: safeAvg(
        totals.successfulCostUsd,
        totals.successfulGenerations,
      ),
      costPerPreviewUsd: safeAvg(totals.previewCostUsd, totals.previewGenerations),
      costPerSimulationUsd: safeAvg(
        totals.simulationCostUsd,
        totals.simulationGenerations,
      ),
      attemptsPerGeneration: safeAvg(totals.totalAgentAttempts, totals.generations),
      billableAttemptsPerGeneration: safeAvg(totals.billableAttempts, totals.generations),
    },
    activeUsers,
    avgCostPerActiveUserUsd: safeAvg(totals.totalCostUsd, activeUsers),
    avgGenerationsPerActiveUser: activeUsers
      ? Math.round((totals.generations / activeUsers) * 100) / 100
      : 0,
  };
}

async function getUsageByUser({ from, to, limit = 50, sort = 'cost' } = {}) {
  const dateFilter = parseDateRange(from, to);
  const match = dateFilter ? { createdAt: dateFilter } : {};
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const sortField = sort === 'generations' ? 'generations' : 'totalCostUsd';

  const rows = await AiUsageEvent.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$userId',
        email: { $first: '$userEmail' },
        name: { $first: '$userName' },
        accountType: { $first: '$accountType' },
        generations: { $sum: 1 },
        previews: { $sum: { $cond: [{ $eq: ['$eventType', 'preview'] }, 1, 0] } },
        simulations: {
          $sum: { $cond: [{ $eq: ['$eventType', 'simulation'] }, 1, 0] },
        },
        failed: { $sum: { $cond: [{ $eq: ['$outcome', 'failed'] }, 1, 0] } },
        successful: { $sum: { $cond: [{ $eq: ['$outcome', 'success'] }, 1, 0] } },
        totalCostUsd: { $sum: '$estimatedCostUsd' },
        totalAgentAttempts: { $sum: '$agentAttempts' },
      },
    },
    { $sort: { [sortField]: -1 } },
    { $limit: lim },
  ]);

  const pricing = getPricingConfig();

  return {
    users: rows.map((r) => ({
      userId: String(r._id),
      email: r.email || '',
      name: r.name || '',
      accountType: r.accountType || 'official',
      generations: r.generations,
      previews: r.previews,
      simulations: r.simulations,
      failed: r.failed,
      successful: r.successful,
      totalCostUsd: roundUsd(r.totalCostUsd),
      totalCostBrl: usdToBrl(r.totalCostUsd, pricing),
      avgCostPerGenerationUsd: safeAvg(r.totalCostUsd, r.generations),
      totalAgentAttempts: r.totalAgentAttempts,
    })),
  };
}

async function getUsageByUserDetail(userId, { from, to, limit = 20 } = {}) {
  if (!mongoose.isValidObjectId(userId)) {
    return { error: 'userId inválido', status: 400 };
  }

  const dateFilter = parseDateRange(from, to);
  const match = { userId: new mongoose.Types.ObjectId(userId) };
  if (dateFilter) match.createdAt = dateFilter;

  const [summaryAgg, recent] = await Promise.all([
    AiUsageEvent.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          generations: { $sum: 1 },
          successful: { $sum: { $cond: [{ $eq: ['$outcome', 'success'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$outcome', 'failed'] }, 1, 0] } },
          previews: { $sum: { $cond: [{ $eq: ['$eventType', 'preview'] }, 1, 0] } },
          simulations: {
            $sum: { $cond: [{ $eq: ['$eventType', 'simulation'] }, 1, 0] },
          },
          totalCostUsd: { $sum: '$estimatedCostUsd' },
          successfulCostUsd: {
            $sum: {
              $cond: [{ $eq: ['$outcome', 'success'] }, '$estimatedCostUsd', 0],
            },
          },
          totalAgentAttempts: { $sum: '$agentAttempts' },
          email: { $first: '$userEmail' },
          name: { $first: '$userName' },
        },
      },
    ]),
    AiUsageEvent.find(match)
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(Number(limit) || 20, 1), 100))
      .lean(),
  ]);

  const s = summaryAgg[0] || {
    generations: 0,
    successful: 0,
    failed: 0,
    previews: 0,
    simulations: 0,
    totalCostUsd: 0,
    successfulCostUsd: 0,
    totalAgentAttempts: 0,
    email: '',
    name: '',
  };

  const pricing = getPricingConfig();

  return {
    userId: String(userId),
    email: s.email || '',
    name: s.name || '',
    summary: {
      generations: s.generations,
      successful: s.successful,
      failed: s.failed,
      previews: s.previews,
      simulations: s.simulations,
      totalCostUsd: roundUsd(s.totalCostUsd),
      totalCostBrl: usdToBrl(s.totalCostUsd, pricing),
      avgCostPerGenerationUsd: safeAvg(s.totalCostUsd, s.generations),
      avgCostPerSuccessfulGenerationUsd: safeAvg(s.successfulCostUsd, s.successful),
      totalAgentAttempts: s.totalAgentAttempts,
    },
    recentGenerations: recent.map((doc) => ({
      id: String(doc._id),
      eventType: doc.eventType,
      outcome: doc.outcome,
      estimatedCostUsd: roundUsd(doc.estimatedCostUsd),
      agentAttempts: doc.agentAttempts,
      billableAttempts: doc.billableAttempts,
      promptTokens: doc.promptTokens,
      outputTokens: doc.outputTokens,
      enhancePairId: doc.enhancePairId || undefined,
      procedureTypes: doc.procedureTypes,
      createdAt: doc.createdAt?.toISOString?.() ?? doc.createdAt,
    })),
  };
}

async function getUsageDaily({ from, to } = {}) {
  const dateFilter = parseDateRange(from, to);
  const match = dateFilter ? { createdAt: dateFilter } : {};

  const rows = await AiUsageEvent.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'America/Sao_Paulo' },
        },
        generations: { $sum: 1 },
        successfulGenerations: {
          $sum: { $cond: [{ $eq: ['$outcome', 'success'] }, 1, 0] },
        },
        agentAttempts: { $sum: '$agentAttempts' },
        costUsd: { $sum: '$estimatedCostUsd' },
        activeUsers: { $addToSet: '$userId' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const pricing = getPricingConfig();

  return {
    days: rows.map((r) => ({
      date: r._id,
      generations: r.generations,
      successfulGenerations: r.successfulGenerations,
      agentAttempts: r.agentAttempts,
      costUsd: roundUsd(r.costUsd),
      costBrl: usdToBrl(r.costUsd, pricing),
      activeUsers: r.activeUsers?.length ?? 0,
    })),
  };
}

async function listUsageGenerations({
  from,
  to,
  page = 1,
  limit = 50,
  eventType,
  outcome,
  userId,
} = {}) {
  const dateFilter = parseDateRange(from, to);
  const filter = {};
  if (dateFilter) filter.createdAt = dateFilter;
  if (eventType === 'preview' || eventType === 'simulation') filter.eventType = eventType;
  if (outcome === 'success' || outcome === 'failed') filter.outcome = outcome;
  if (userId && mongoose.isValidObjectId(userId)) {
    filter.userId = new mongoose.Types.ObjectId(userId);
  }

  const pg = Math.max(Number(page) || 1, 1);
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const skip = (pg - 1) * lim;

  const [items, total] = await Promise.all([
    AiUsageEvent.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(lim)
      .lean(),
    AiUsageEvent.countDocuments(filter),
  ]);

  return {
    page: pg,
    limit: lim,
    total,
    items: items.map((doc) => ({
      id: String(doc._id),
      userId: String(doc.userId),
      userEmail: doc.userEmail,
      eventType: doc.eventType,
      outcome: doc.outcome,
      estimatedCostUsd: roundUsd(doc.estimatedCostUsd),
      agentAttempts: doc.agentAttempts,
      billableAttempts: doc.billableAttempts,
      promptTokens: doc.promptTokens,
      outputTokens: doc.outputTokens,
      enhancePairId: doc.enhancePairId || undefined,
      procedureTypes: doc.procedureTypes,
      attempts: doc.attempts,
      createdAt: doc.createdAt?.toISOString?.() ?? doc.createdAt,
    })),
  };
}

module.exports = {
  getUsageSummary,
  getUsageByUser,
  getUsageByUserDetail,
  getUsageDaily,
  listUsageGenerations,
};
