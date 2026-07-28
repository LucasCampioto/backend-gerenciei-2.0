const mongoose = require('mongoose');

const commercialActionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true,
    index: true,
  },
  clientName: {
    type: String,
    trim: true,
    default: '',
  },
  phone: {
    type: String,
    trim: true,
    default: '',
  },
  source: {
    type: String,
    enum: ['rule', 'agent'],
    default: 'rule',
  },
  type: {
    type: String,
    trim: true,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'done', 'snoozed', 'dismissed'],
    default: 'pending',
    index: true,
  },
  priority: {
    type: Number,
    default: 50,
  },
  expectedValue: {
    type: Number,
    default: 0,
  },
  expectedValueReason: {
    type: String,
    trim: true,
    default: '',
  },
  lastVisitAt: {
    type: Date,
    default: null,
  },
  lastProcedures: {
    type: [String],
    default: [],
  },
  salesSuggestion: {
    type: String,
    trim: true,
    default: '',
  },
  salesSuggestionReason: {
    type: String,
    trim: true,
    default: '',
  },
  reason: {
    type: String,
    trim: true,
    default: '',
  },
  suggestedAction: {
    type: String,
    trim: true,
    default: '',
  },
  suggestedMessage: {
    type: String,
    trim: true,
    default: '',
  },
  href: {
    type: String,
    trim: true,
    default: '',
  },
  agentRunId: {
    type: String,
    trim: true,
    default: '',
  },
  agentName: {
    type: String,
    trim: true,
    default: '',
  },
  promptVersion: {
    type: String,
    trim: true,
    default: '',
  },
  feedback: {
    type: String,
    enum: ['accepted', 'edited', 'rejected', null],
    default: null,
  },
  editedPayload: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  outcome: {
    type: String,
    enum: ['won', 'lost', 'contacted', 'no_answer', null],
    default: null,
  },
  realizedRevenue: {
    type: Number,
    default: 0,
  },
  snoozedUntil: {
    type: Date,
    default: null,
  },
  completedAt: {
    type: Date,
    default: null,
  },
  recommendationId: {
    type: String,
    trim: true,
    default: '',
  },
}, {
  timestamps: true,
});

commercialActionSchema.index({ userId: 1, status: 1, priority: -1 });
commercialActionSchema.index({ userId: 1, clientId: 1, status: 1 });

module.exports = mongoose.model('CommercialAction', commercialActionSchema);
