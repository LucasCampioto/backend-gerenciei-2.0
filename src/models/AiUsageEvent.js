const mongoose = require('mongoose');

const attemptSchema = new mongoose.Schema(
  {
    modelId: { type: String, default: '' },
    transport: { type: String, enum: ['agno', 'genai'], default: 'genai' },
    attemptNumber: { type: Number, default: 1 },
    outcome: { type: String, enum: ['success', 'failed'], default: 'failed' },
    tokenSource: {
      type: String,
      enum: ['google_usage_metadata', 'agno_provider_metrics', 'unavailable'],
      default: 'unavailable',
    },
    httpStatus: { type: Number, default: null },
    billable: { type: Boolean, default: false },
    promptTokenCount: { type: Number, default: 0 },
    candidatesTokenCount: { type: Number, default: 0 },
    totalTokenCount: { type: Number, default: 0 },
    thoughtsTokenCount: { type: Number, default: 0 },
    cachedContentTokenCount: { type: Number, default: 0 },
    latencyMs: { type: Number, default: null },
    errorMessage: { type: String, default: '' },
  },
  { _id: false },
);

const pricingSnapshotSchema = new mongoose.Schema(
  {
    inputUsdPer1M: { type: Number, required: true },
    imageOutputUsdPer1M: { type: Number, required: true },
    usdToBrl: { type: Number, default: null },
    modelId: { type: String, default: '' },
  },
  { _id: false },
);

const aiUsageEventSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userEmail: { type: String, default: '' },
    userName: { type: String, default: '' },
    accountType: { type: String, enum: ['official', 'partner_test'], default: 'official' },
    stripeSubscriptionId: { type: String, default: '' },

    eventType: { type: String, enum: ['preview', 'simulation'], required: true },
    outcome: { type: String, enum: ['success', 'failed'], required: true },

    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
    procedureTypes: { type: [String], default: [] },
    practiceProfile: { type: String, default: '' },
    intensityPct: { type: Number, default: null },
    regioes: { type: String, default: '' },
    enhancePairId: { type: String, default: '' },
    inputImageBytes: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },

    attempts: { type: [attemptSchema], default: [] },
    promptTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    agentAttempts: { type: Number, default: 0 },
    billableAttempts: { type: Number, default: 0 },
    successfulAttempts: { type: Number, default: 0 },

    estimatedCostUsd: { type: Number, default: 0 },
    pricingSnapshot: { type: pricingSnapshotSchema, default: null },
  },
  { timestamps: true },
);

aiUsageEventSchema.index({ userId: 1, createdAt: -1 });
aiUsageEventSchema.index({ eventType: 1, outcome: 1, createdAt: -1 });
aiUsageEventSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AiUsageEvent', aiUsageEventSchema);
