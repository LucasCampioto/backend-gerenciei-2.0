function parseEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function getPricingConfig() {
  return {
    inputUsdPer1M: parseEnvNumber('GEMINI_INPUT_USD_PER_1M', 0.3),
    imageOutputUsdPer1M: parseEnvNumber('GEMINI_IMAGE_OUTPUT_USD_PER_1M', 30),
    usdToBrl: parseEnvNumber('USD_TO_BRL', 5.5),
  };
}

function safeInt(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/**
 * Custo USD de uma tentativa billable (tokens reais; output só se houver candidates).
 */
function computeAttemptCostUsd(attempt, pricing = getPricingConfig()) {
  if (!attempt?.billable) return 0;
  const prompt = safeInt(attempt.promptTokenCount);
  const output = safeInt(attempt.candidatesTokenCount);
  const thoughts = safeInt(attempt.thoughtsTokenCount);
  const inputCost = (prompt / 1_000_000) * pricing.inputUsdPer1M;
  const outputCost = ((output + thoughts) / 1_000_000) * pricing.imageOutputUsdPer1M;
  return inputCost + outputCost;
}

/**
 * Soma custo de todas as tentativas billable de uma geração.
 */
function computeGenerationCostUsd(attempts, modelId, pricing = getPricingConfig()) {
  const list = Array.isArray(attempts) ? attempts : [];
  let estimatedCostUsd = 0;
  for (const att of list) {
    estimatedCostUsd += computeAttemptCostUsd(att, pricing);
  }
  const primaryModel =
    modelId ||
    list.find((a) => a.outcome === 'success')?.modelId ||
    list[0]?.modelId ||
    '';

  return {
    estimatedCostUsd: Math.round(estimatedCostUsd * 1_000_000) / 1_000_000,
    pricingSnapshot: {
      inputUsdPer1M: pricing.inputUsdPer1M,
      imageOutputUsdPer1M: pricing.imageOutputUsdPer1M,
      usdToBrl: pricing.usdToBrl,
      modelId: String(primaryModel),
    },
  };
}

function usdToBrl(amountUsd, pricing = getPricingConfig()) {
  const usd = Number(amountUsd);
  if (!Number.isFinite(usd)) return 0;
  return Math.round(usd * pricing.usdToBrl * 100) / 100;
}

module.exports = {
  getPricingConfig,
  computeAttemptCostUsd,
  computeGenerationCostUsd,
  usdToBrl,
};
