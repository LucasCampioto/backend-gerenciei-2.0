const mongoose = require('mongoose');
const { organizationScopePlugin } = require('./plugins/organizationScope');

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

dailyBriefingSchema.plugin(organizationScopePlugin);

module.exports = mongoose.model('DailyBriefing', dailyBriefingSchema);
