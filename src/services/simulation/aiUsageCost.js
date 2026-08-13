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
    /** GPT / Agno (texto) — defaults gpt-4o-mini approx */
    openaiInputUsdPer1M: parseEnvNumber('OPENAI_INPUT_USD_PER_1M', 0.15),
    openaiOutputUsdPer1M: parseEnvNumber('OPENAI_OUTPUT_USD_PER_1M', 0.6),
    usdToBrl: parseEnvNumber('USD_TO_BRL', 5.5),
  };
}

function safeInt(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function roundUsd(n) {
  return Math.round(Number(n || 0) * 1_000_000) / 1_000_000;
}

/**
 * Custo de uma tentativa:
 * - transport `agno` → texto (GPT / Agno)
 * - transport `genai` (ou outro) → imagem Gemini (input + saída imagem)
 */
function splitAttemptCost(attempt, pricing = getPricingConfig()) {
  if (!attempt?.billable) {
    return { imageCostUsd: 0, textCostUsd: 0, totalCostUsd: 0 };
  }
  const prompt = safeInt(attempt.promptTokenCount);
  const output = safeInt(attempt.candidatesTokenCount);
  const thoughts = safeInt(attempt.thoughtsTokenCount);
  const transport = String(attempt.transport || 'genai');

  if (transport === 'agno') {
    const textCostUsd =
      (prompt / 1_000_000) * pricing.openaiInputUsdPer1M +
      ((output + thoughts) / 1_000_000) * pricing.openaiOutputUsdPer1M;
    return {
      imageCostUsd: 0,
      textCostUsd: roundUsd(textCostUsd),
      totalCostUsd: roundUsd(textCostUsd),
    };
  }

  const inputCost = (prompt / 1_000_000) * pricing.inputUsdPer1M;
  const imageOut = ((output + thoughts) / 1_000_000) * pricing.imageOutputUsdPer1M;
  const imageCostUsd = roundUsd(inputCost + imageOut);
  return {
    imageCostUsd,
    textCostUsd: 0,
    totalCostUsd: imageCostUsd,
  };
}

/**
 * Custo USD de uma tentativa billable (compatível com recorder).
 */
function computeAttemptCostUsd(attempt, pricing = getPricingConfig()) {
  return splitAttemptCost(attempt, pricing).totalCostUsd;
}

/**
 * Soma custo de todas as tentativas billable de uma geração.
 */
function computeGenerationCostUsd(attempts, modelId, pricing = getPricingConfig()) {
  const list = Array.isArray(attempts) ? attempts : [];
  let estimatedCostUsd = 0;
  let imageCostUsd = 0;
  let textCostUsd = 0;
  for (const att of list) {
    const split = splitAttemptCost(att, pricing);
    estimatedCostUsd += split.totalCostUsd;
    imageCostUsd += split.imageCostUsd;
    textCostUsd += split.textCostUsd;
  }
  const primaryModel =
    modelId ||
    list.find((a) => a.outcome === 'success')?.modelId ||
    list[0]?.modelId ||
    '';

  return {
    estimatedCostUsd: roundUsd(estimatedCostUsd),
    imageCostUsd: roundUsd(imageCostUsd),
    textCostUsd: roundUsd(textCostUsd),
    pricingSnapshot: {
      inputUsdPer1M: pricing.inputUsdPer1M,
      imageOutputUsdPer1M: pricing.imageOutputUsdPer1M,
      openaiInputUsdPer1M: pricing.openaiInputUsdPer1M,
      openaiOutputUsdPer1M: pricing.openaiOutputUsdPer1M,
      usdToBrl: pricing.usdToBrl,
      modelId: String(primaryModel),
    },
  };
}

/** Recalcula split a partir do doc salvo (histórico). */
function splitEventCost(doc, pricing = getPricingConfig()) {
  const list = Array.isArray(doc?.attempts) ? doc.attempts : [];
  if (list.length) {
    let imageCostUsd = 0;
    let textCostUsd = 0;
    for (const att of list) {
      const s = splitAttemptCost(att, pricing);
      imageCostUsd += s.imageCostUsd;
      textCostUsd += s.textCostUsd;
    }
    const total = imageCostUsd + textCostUsd;
    // Se não houve billable, cai no estimado gravado (assume imagem)
    if (total <= 0 && Number(doc.estimatedCostUsd) > 0) {
      return {
        imageCostUsd: roundUsd(doc.estimatedCostUsd),
        textCostUsd: 0,
        totalCostUsd: roundUsd(doc.estimatedCostUsd),
      };
    }
    return {
      imageCostUsd: roundUsd(imageCostUsd),
      textCostUsd: roundUsd(textCostUsd),
      totalCostUsd: roundUsd(total || doc.estimatedCostUsd || 0),
    };
  }
  const fallback = Number(doc?.estimatedCostUsd) || 0;
  return {
    imageCostUsd: roundUsd(fallback),
    textCostUsd: 0,
    totalCostUsd: roundUsd(fallback),
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
  splitAttemptCost,
  splitEventCost,
  usdToBrl,
  roundUsd,
};
