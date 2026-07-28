const mongoose = require('mongoose');

const postSchema = new mongoose.Schema(
  {
    day: { type: Number, default: 1 },
    format: { type: String, default: 'carrossel' },
    hook: { type: String, default: '' },
    caption: { type: String, default: '' },
    hashtags: { type: [String], default: [] },
    visualSuggestion: { type: String, default: '' },
    bestTime: { type: String, default: '19:00' },
    status: {
      type: String,
      enum: ['pending', 'used'],
      default: 'pending',
    },
  },
  { _id: false }
);

const contentPlanSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    month: {
      type: String,
      required: true,
      index: true,
    },
    monthLabel: {
      type: String,
      default: '',
    },
    posts: {
      type: [postSchema],
      default: [],
    },
    source: {
      type: String,
      default: 'heuristic',
    },
  },
  { timestamps: true }
);

contentPlanSchema.index({ userId: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('ContentPlan', contentPlanSchema);
