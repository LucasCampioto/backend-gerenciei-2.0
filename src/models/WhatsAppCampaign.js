const mongoose = require('mongoose');

const OBJECTIVES = [
  'increase_sales',
  'warm_leads',
  'reactivate',
  'discount_objection',
  'engage',
];

const STATUSES = [
  'pending_approval',
  'approved',
  'rejected',
  'sending',
  'done',
  'cancelled',
];

const messageVariantSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    label: { type: String, default: '' },
    body: { type: String, required: true },
  },
  { _id: false }
);

const whatsAppCampaignSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    dateKey: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },
    status: {
      type: String,
      enum: STATUSES,
      default: 'pending_approval',
      index: true,
    },
    objective: {
      type: String,
      enum: OBJECTIVES,
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    reason: {
      type: String,
      default: '',
    },
    audienceSummary: {
      type: String,
      default: '',
    },
    audienceRule: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    clientIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Client',
      },
    ],
    messageVariants: {
      type: [messageVariantSchema],
      default: [],
    },
    selectedVariantId: {
      type: String,
      default: '',
    },
    suggestedSendAt: {
      type: Date,
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
    agentRunId: {
      type: String,
      default: '',
    },
    source: {
      type: String,
      enum: ['agent', 'rule_fallback'],
      default: 'rule_fallback',
    },
    stats: {
      queued: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

whatsAppCampaignSchema.index({ userId: 1, dateKey: 1, status: 1 });

module.exports = mongoose.model('WhatsAppCampaign', whatsAppCampaignSchema);
module.exports.OBJECTIVES = OBJECTIVES;
module.exports.STATUSES = STATUSES;
module.exports.MAX_LEADS_PER_CAMPAIGN = 30;
