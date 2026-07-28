const mongoose = require('mongoose');
const AiUsageEvent = require('../../models/AiUsageEvent');
const User = require('../../models/User');
const { computeGenerationCostUsd } = require('./aiUsageCost');

function safeInt(n) {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

function normalizeAttempt(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const httpStatusRaw = raw.http_status ?? raw.httpStatus;
  const httpStatus =
    httpStatusRaw != null && Number.isFinite(Number(httpStatusRaw))
      ? Number(httpStatusRaw)
      : null;

  const tokenSource = String(raw.token_source ?? raw.tokenSource ?? 'unavailable');
  const billableRaw = raw.billable;
  let billable = billableRaw === true;
  if (billableRaw === undefined) {
    billable =
      httpStatus !== 400 &&
      httpStatus !== 500 &&
      tokenSource !== 'unavailable' &&
      (safeInt(raw.prompt_token_count ?? raw.promptTokenCount) > 0 ||
        safeInt(raw.candidates_token_count ?? raw.candidatesTokenCount) > 0);
  }

  return {
    modelId: String(raw.model_id ?? raw.modelId ?? ''),
    transport: raw.transport === 'agno' ? 'agno' : 'genai',
    attemptNumber: safeInt(raw.attempt_number ?? raw.attemptNumber) || 1,
    outcome: raw.outcome === 'success' ? 'success' : 'failed',
    tokenSource:
      tokenSource === 'google_usage_metadata' || tokenSource === 'agno_provider_metrics'
        ? tokenSource
        : 'unavailable',
    httpStatus,
    billable,
    promptTokenCount: safeInt(raw.prompt_token_count ?? raw.promptTokenCount),
    candidatesTokenCount: safeInt(raw.candidates_token_count ?? raw.candidatesTokenCount),
    totalTokenCount: safeInt(raw.total_token_count ?? raw.totalTokenCount),
    thoughtsTokenCount: safeInt(raw.thoughts_token_count ?? raw.thoughtsTokenCount),
    cachedContentTokenCount: safeInt(
      raw.cached_content_token_count ?? raw.cachedContentTokenCount,
    ),
    latencyMs:
      raw.latency_ms != null && Number.isFinite(Number(raw.latency_ms))
        ? Number(raw.latency_ms)
        : raw.latencyMs != null && Number.isFinite(Number(raw.latencyMs))
          ? Number(raw.latencyMs)
          : null,
    errorMessage: String(raw.error_message ?? raw.errorMessage ?? '').slice(0, 500),
  };
}

function parseUsageReport(agentData) {
  const report = agentData?.usage_report ?? agentData?.usageReport;
  if (!report || typeof report !== 'object') {
    return { attempts: [], successfulModelId: '', successfulTransport: '' };
  }

  const attempts = Array.isArray(report.attempts)
    ? report.attempts.map(normalizeAttempt).filter(Boolean)
    : [];

  return {
    attempts,
    successfulModelId: String(report.successful_model_id ?? report.successfulModelId ?? ''),
    successfulTransport: String(
      report.successful_transport ?? report.successfulTransport ?? '',
    ),
  };
}

function aggregateAttempts(attempts) {
  let promptTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let billableAttempts = 0;
  let successfulAttempts = 0;

  for (const att of attempts) {
    if (att.outcome === 'success') successfulAttempts += 1;
    if (!att.billable) continue;
    billableAttempts += 1;
    promptTokens += att.promptTokenCount;
    outputTokens += att.candidatesTokenCount + att.thoughtsTokenCount;
    totalTokens += att.totalTokenCount || att.promptTokenCount + att.candidatesTokenCount;
  }

  return {
    promptTokens,
    outputTokens,
    totalTokens,
    agentAttempts: attempts.length,
    billableAttempts,
    successfulAttempts,
  };
}

/**
 * Grava evento de uso de IA (fire-and-forget).
 */
async function recordGenerationUsage({
  userId,
  eventType,
  outcome,
  parsed,
  agentData,
  pairId,
  latencyMs,
  agentHttpStatus,
}) {
  const user = await User.findById(userId).lean();
  if (!user) return;

  const { attempts, successfulModelId } = parseUsageReport(agentData);
  const totals = aggregateAttempts(attempts);
  const { estimatedCostUsd, pricingSnapshot } = computeGenerationCostUsd(
    attempts,
    successfulModelId,
  );

  let clientObjectId = null;
  const clientIdStr = String(parsed?.clientId || parsed?.patientId || '').trim();
  if (clientIdStr && mongoose.isValidObjectId(clientIdStr)) {
    clientObjectId = new mongoose.Types.ObjectId(clientIdStr);
  }

  const doc = await AiUsageEvent.create({
    userId,
    userEmail: user.email || '',
    userName: user.name || '',
    accountType: user.accountType || 'official',
    stripeSubscriptionId: user.stripeSubscriptionId || '',

    eventType: eventType === 'preview' ? 'preview' : 'simulation',
    outcome: outcome === 'success' ? 'success' : 'failed',

    clientId: clientObjectId,
    procedureTypes: Array.isArray(parsed?.tipos) ? parsed.tipos : [],
    practiceProfile: String(parsed?.practiceProfile || ''),
    intensityPct:
      parsed?.intensidadePct != null && Number.isFinite(parsed.intensidadePct)
        ? parsed.intensidadePct
        : null,
    regioes: String(parsed?.regioes || ''),
    enhancePairId: String(pairId || ''),
    inputImageBytes: parsed?.fileBuffer?.length ?? 0,
    latencyMs: safeInt(latencyMs),

    attempts,
    ...totals,
    estimatedCostUsd,
    pricingSnapshot,
  });

  console.log('[aiUsage] evento gravado', {
    id: String(doc._id),
    userId: String(userId),
    eventType,
    outcome,
    agentAttempts: totals.agentAttempts,
    estimatedCostUsd,
  });

  void agentHttpStatus;
}

/**
 * Não bloqueia a resposta HTTP do enhance.
 */
function recordGenerationUsageAsync(payload) {
  void recordGenerationUsage(payload).catch((err) => {
    console.error('[aiUsage] falha ao gravar evento', err?.message);
  });
}

module.exports = {
  parseUsageReport,
  recordGenerationUsage,
  recordGenerationUsageAsync,
};
