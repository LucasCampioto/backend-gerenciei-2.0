const mongoose = require('mongoose');

const KINDS = [
  'funnel_welcome',
  'daily_campaign',
  'agenda_reminder',
  'simulation_invite',
  'agenda_noshow',
  'test',
];

const STATUSES = ['pending', 'sending', 'sent', 'skipped', 'failed', 'cancelled'];

const whatsAppOutboxSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      default: null,
      index: true,
    },
    phone: {
      type: String,
      trim: true,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    kind: {
      type: String,
      enum: KINDS,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: STATUSES,
      default: 'pending',
      index: true,
    },
    scheduledAt: {
      type: Date,
      required: true,
      index: true,
    },
    sentAt: {
      type: Date,
      default: null,
    },
    lockedAt: {
      type: Date,
      default: null,
    },
    error: {
      type: String,
      default: '',
    },
    /** Idempotency key: e.g. funnel:campaignLeadId or campaign:campaignId:clientId */
    dedupeKey: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsAppCampaign',
      default: null,
      index: true,
    },
    sourceRef: {
      type: String,
      trim: true,
      default: '',
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

whatsAppOutboxSchema.index(
  { userId: 1, dedupeKey: 1 },
  {
    unique: true,
    partialFilterExpression: { dedupeKey: { $type: 'string', $gt: '' } },
  }
);
whatsAppOutboxSchema.index({ status: 1, scheduledAt: 1 });

module.exports = mongoose.model('WhatsAppOutbox', whatsAppOutboxSchema);
module.exports.KINDS = KINDS;
module.exports.STATUSES = STATUSES;
