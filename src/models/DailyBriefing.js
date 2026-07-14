const mongoose = require('mongoose');

const dailyBriefingSchema = new mongoose.Schema({
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
  items: [{
    type: String,
    trim: true,
  }],
}, {
  timestamps: true,
});

dailyBriefingSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DailyBriefing', dailyBriefingSchema);
