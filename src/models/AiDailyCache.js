const mongoose = require('mongoose');

const KINDS = ['closing_rank', 'director', 'upsells', 'wa_campaigns'];

const aiDailyCacheSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  date: {
    type: String,
    required: true,
    match: /^\d{4}-\d{2}-\d{2}$/,
  },
  kind: {
    type: String,
    enum: KINDS,
    required: true,
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  source: {
    type: String,
    enum: ['agent', 'rule'],
    required: false,
    default: undefined,
  },
  promptVersion: {
    type: String,
    trim: true,
    default: '',
  },
  // Lease simples: evita dois GETs simultâneos dispararem a mesma análise.
  computingAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

aiDailyCacheSchema.index({ userId: 1, date: 1, kind: 1 }, { unique: true });

module.exports = mongoose.model('AiDailyCache', aiDailyCacheSchema);
module.exports.KINDS = KINDS;
