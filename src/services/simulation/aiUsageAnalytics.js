const mongoose = require('mongoose');
const AiUsageEvent = require('../../models/AiUsageEvent');
const {
  getPricingConfig,
  usdToBrl,
  splitEventCost,
  roundUsd,
} = require('./aiUsageCost');

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

function safeAvg(total, count) {
  if (!count) return 0;
  return roundUsd(total / count);
}

function emptyTotals() {
  return {
    generations: 0,
    successfulGenerations: 0,
    failedGenerations: 0,
    previewGenerations: 0,
    simulationGenerations: 0,
    textGenerations: 0,
    totalAgentAttempts: 0,
    billableAttempts: 0,
    totalCostUsd: 0,
    imageCostUsd: 0,
    textCostUsd: 0,
    previewCostUsd: 0,
    simulationCostUsd: 0,
    successfulCostUsd: 0,
    promptTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    textPromptTokens: 0,
    textOutputTokens: 0,
    userIds: new Set(),
  };
}

function accumulateEvent(totals, doc, pricing) {
  const split = splitEventCost(doc, pricing);
  totals.generations += 1;
  if (doc.outcome === 'success') {
    totals.successfulGenerations += 1;
    totals.successfulCostUsd += split.totalCostUsd;
  }
  if (doc.outcome === 'failed') totals.failedGenerations += 1;
  if (doc.eventType === 'preview') {
    totals.previewGenerations += 1;
    totals.previewCostUsd += split.totalCostUsd;
  }
  if (doc.eventType === 'simulation') {
    totals.simulationGenerations += 1;
    totals.simulationCostUsd += split.totalCostUsd;
  }
  if (doc.eventType === 'text') {
    totals.textGenerations += 1;
    totals.textPromptTokens += Number(doc.promptTokens) || 0;
    totals.textOutputTokens += Number(doc.outputTokens) || 0;
  }
  totals.totalAgentAttempts += Number(doc.agentAttempts) || 0;
  totals.billableAttempts += Number(doc.billableAttempts) || 0;
  totals.totalCostUsd += split.totalCostUsd;
  totals.imageCostUsd += split.imageCostUsd;
  totals.textCostUsd += split.textCostUsd;
  totals.promptTokens += Number(doc.promptTokens) || 0;
  totals.outputTokens += Number(doc.outputTokens) || 0;
  totals.totalTokens += Number(doc.totalTokens) || 0;
  if (doc.userId) totals.userIds.add(String(doc.userId));
}

async function loadEvents(match, projection) {
  return AiUsageEvent.find(match)
    .select(
      projection ||
        'userId userEmail userName accountType eventType feature modality outcome attempts estimatedCostUsd pricingSnapshot agentAttempts billableAttempts promptTokens outputTokens totalTokens enhancePairId procedureTypes createdAt',
    )
    .lean();
}

async function getUsageSummary({ from, to } = {}) {
  const dateFilter = parseDateRange(from, to);
  const match = dateFilter ? { createdAt: dateFilter } : {};
  const pricing = getPricingConfig();
  const events = await loadEvents(match);
  const totals = emptyTotals();
  for (const doc of events) accumulateEvent(totals, doc, pricing);

  const activeUsers = totals.userIds.size;

  return {
    period: { from: from || null, to: to || null },
    totals: {
      generations: totals.generations,
      successfulGenerations: totals.successfulGenerations,
      failedGenerations: totals.failedGenerations,
      previewGenerations: totals.previewGenerations,
      simulationGenerations: totals.simulationGenerations,
      textGenerations: totals.textGenerations,
      totalAgentAttempts: totals.totalAgentAttempts,
      billableAttempts: totals.billableAttempts,
      totalCostUsd: roundUsd(totals.totalCostUsd),
      totalCostBrl: usdToBrl(totals.totalCostUsd, pricing),
      imageCostUsd: roundUsd(totals.imageCostUsd),
      imageCostBrl: usdToBrl(totals.imageCostUsd, pricing),
      textCostUsd: roundUsd(totals.textCostUsd),
      textCostBrl: usdToBrl(totals.textCostUsd, pricing),
      promptTokens: totals.promptTokens,
      outputTokens: totals.outputTokens,
      totalTokens: totals.totalTokens,
      textPromptTokens: totals.textPromptTokens,
      textOutputTokens: totals.textOutputTokens,
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
  const pricing = getPricingConfig();
  const events = await loadEvents(match);

  const byUser = new Map();
  for (const doc of events) {
    const uid = String(doc.userId);
    if (!byUser.has(uid)) {
      byUser.set(uid, {
        userId: uid,
        email: doc.userEmail || '',
        name: doc.userName || '',
        accountType: doc.accountType || 'official',
        generations: 0,
        previews: 0,
        simulations: 0,
        textCalls: 0,
        failed: 0,
        successful: 0,
        totalCostUsd: 0,
        imageCostUsd: 0,
        textCostUsd: 0,
        promptTokens: 0,
        outputTokens: 0,
        textPromptTokens: 0,
        textOutputTokens: 0,
        totalAgentAttempts: 0,
      });
    }
    const row = byUser.get(uid);
    const split = splitEventCost(doc, pricing);
    row.generations += 1;
    if (doc.eventType === 'preview') row.previews += 1;
    if (doc.eventType === 'simulation') row.simulations += 1;
    if (doc.eventType === 'text') {
      row.textCalls += 1;
      row.textPromptTokens += Number(doc.promptTokens) || 0;
      row.textOutputTokens += Number(doc.outputTokens) || 0;
    }
    if (doc.outcome === 'failed') row.failed += 1;
    if (doc.outcome === 'success') row.successful += 1;
    row.totalCostUsd += split.totalCostUsd;
    row.imageCostUsd += split.imageCostUsd;
    row.textCostUsd += split.textCostUsd;
    row.promptTokens += Number(doc.promptTokens) || 0;
    row.outputTokens += Number(doc.outputTokens) || 0;
    row.totalAgentAttempts += Number(doc.agentAttempts) || 0;
    if (doc.userEmail) row.email = doc.userEmail;
    if (doc.userName) row.name = doc.userName;
  }

  const sortField =
    sort === 'generations'
      ? 'generations'
      : sort === 'image'
        ? 'imageCostUsd'
        : sort === 'text'
          ? 'textCostUsd'
          : 'totalCostUsd';

  const users = [...byUser.values()]
    .sort((a, b) => (b[sortField] || 0) - (a[sortField] || 0))
    .slice(0, lim)
    .map((r) => ({
      ...r,
      totalCostUsd: roundUsd(r.totalCostUsd),
      totalCostBrl: usdToBrl(r.totalCostUsd, pricing),
      imageCostUsd: roundUsd(r.imageCostUsd),
      imageCostBrl: usdToBrl(r.imageCostUsd, pricing),
      textCostUsd: roundUsd(r.textCostUsd),
      textCostBrl: usdToBrl(r.textCostUsd, pricing),
      avgCostPerGenerationUsd: safeAvg(r.totalCostUsd, r.generations),
    }));

  return { users };
}

async function getUsageByUserDetail(userId, { from, to, limit = 20 } = {}) {
  if (!mongoose.isValidObjectId(userId)) {
    return { error: 'userId inválido', status: 400 };
  }

  const dateFilter = parseDateRange(from, to);
  const match = { userId: new mongoose.Types.ObjectId(userId) };
  if (dateFilter) match.createdAt = dateFilter;

  const pricing = getPricingConfig();
  const events = await loadEvents(match);
  const totals = emptyTotals();
  let email = '';
  let name = '';
  for (const doc of events) {
    accumulateEvent(totals, doc, pricing);
    if (doc.userEmail) email = doc.userEmail;
    if (doc.userName) name = doc.userName;
  }

  const recent = events
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, Math.min(Math.max(Number(limit) || 20, 1), 100));

  return {
    userId: String(userId),
    email,
    name,
    summary: {
      generations: totals.generations,
      successful: totals.successfulGenerations,
      failed: totals.failedGenerations,
      previews: totals.previewGenerations,
      simulations: totals.simulationGenerations,
      textCalls: totals.textGenerations,
      totalCostUsd: roundUsd(totals.totalCostUsd),
      totalCostBrl: usdToBrl(totals.totalCostUsd, pricing),
      imageCostUsd: roundUsd(totals.imageCostUsd),
      imageCostBrl: usdToBrl(totals.imageCostUsd, pricing),
      textCostUsd: roundUsd(totals.textCostUsd),
      textCostBrl: usdToBrl(totals.textCostUsd, pricing),
      promptTokens: totals.promptTokens,
      outputTokens: totals.outputTokens,
      totalTokens: totals.totalTokens,
      textPromptTokens: totals.textPromptTokens,
      textOutputTokens: totals.textOutputTokens,
      avgCostPerGenerationUsd: safeAvg(totals.totalCostUsd, totals.generations),
      avgCostPerSuccessfulGenerationUsd: safeAvg(
        totals.successfulCostUsd,
        totals.successfulGenerations,
      ),
      totalAgentAttempts: totals.totalAgentAttempts,
    },
    recentGenerations: recent.map((doc) => {
      const split = splitEventCost(doc, pricing);
      return {
        id: String(doc._id),
        eventType: doc.eventType,
        feature: doc.feature || doc.eventType,
        modality: doc.modality || (doc.eventType === 'text' ? 'text' : 'image'),
        outcome: doc.outcome,
        estimatedCostUsd: roundUsd(split.totalCostUsd),
        estimatedCostBrl: usdToBrl(split.totalCostUsd, pricing),
        imageCostUsd: split.imageCostUsd,
        imageCostBrl: usdToBrl(split.imageCostUsd, pricing),
        textCostUsd: split.textCostUsd,
        textCostBrl: usdToBrl(split.textCostUsd, pricing),
        agentAttempts: doc.agentAttempts,
        billableAttempts: doc.billableAttempts,
        promptTokens: doc.promptTokens,
        outputTokens: doc.outputTokens,
        totalTokens: doc.totalTokens,
        enhancePairId: doc.enhancePairId || undefined,
        procedureTypes: doc.procedureTypes,
        createdAt: doc.createdAt?.toISOString?.() ?? doc.createdAt,
      };
    }),
  };
}

async function getUsageDaily({ from, to } = {}) {
  const dateFilter = parseDateRange(from, to);
  const match = dateFilter ? { createdAt: dateFilter } : {};
  const pricing = getPricingConfig();
  const events = await loadEvents(match);

  const byDay = new Map();
  for (const doc of events) {
    const key = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(doc.createdAt));
    if (!byDay.has(key)) {
      byDay.set(key, {
        date: key,
        generations: 0,
        successfulGenerations: 0,
        agentAttempts: 0,
        costUsd: 0,
        imageCostUsd: 0,
        textCostUsd: 0,
        userIds: new Set(),
      });
    }
    const row = byDay.get(key);
    const split = splitEventCost(doc, pricing);
    row.generations += 1;
    if (doc.outcome === 'success') row.successfulGenerations += 1;
    row.agentAttempts += Number(doc.agentAttempts) || 0;
    row.costUsd += split.totalCostUsd;
    row.imageCostUsd += split.imageCostUsd;
    row.textCostUsd += split.textCostUsd;
    if (doc.userId) row.userIds.add(String(doc.userId));
  }

  const days = [...byDay.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({
      date: r.date,
      generations: r.generations,
      successfulGenerations: r.successfulGenerations,
      agentAttempts: r.agentAttempts,
      costUsd: roundUsd(r.costUsd),
      costBrl: usdToBrl(r.costUsd, pricing),
      imageCostUsd: roundUsd(r.imageCostUsd),
      imageCostBrl: usdToBrl(r.imageCostUsd, pricing),
      textCostUsd: roundUsd(r.textCostUsd),
      textCostBrl: usdToBrl(r.textCostUsd, pricing),
      activeUsers: r.userIds.size,
    }));

  return { days };
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
  if (eventType === 'preview' || eventType === 'simulation' || eventType === 'text') {
    filter.eventType = eventType;
  }
  if (outcome === 'success' || outcome === 'failed') filter.outcome = outcome;
  if (userId && mongoose.isValidObjectId(userId)) {
    filter.userId = new mongoose.Types.ObjectId(userId);
  }

  const pg = Math.max(Number(page) || 1, 1);
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const skip = (pg - 1) * lim;
  const pricing = getPricingConfig();

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
    items: items.map((doc) => {
      const split = splitEventCost(doc, pricing);
      return {
        id: String(doc._id),
        userId: String(doc.userId),
        userEmail: doc.userEmail,
        eventType: doc.eventType,
        feature: doc.feature || doc.eventType,
        modality: doc.modality || (doc.eventType === 'text' ? 'text' : 'image'),
        outcome: doc.outcome,
        estimatedCostUsd: roundUsd(split.totalCostUsd),
        imageCostUsd: split.imageCostUsd,
        textCostUsd: split.textCostUsd,
        agentAttempts: doc.agentAttempts,
        billableAttempts: doc.billableAttempts,
        promptTokens: doc.promptTokens,
        outputTokens: doc.outputTokens,
        totalTokens: doc.totalTokens,
        enhancePairId: doc.enhancePairId || undefined,
        procedureTypes: doc.procedureTypes,
        attempts: doc.attempts,
        createdAt: doc.createdAt?.toISOString?.() ?? doc.createdAt,
      };
    }),
  };
}

module.exports = {
  getUsageSummary,
  getUsageByUser,
  getUsageByUserDetail,
  getUsageDaily,
  listUsageGenerations,
};
