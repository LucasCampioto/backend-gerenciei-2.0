const mongoose = require('mongoose');

const cronLockSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    owner: { type: String, required: true },
    lockedUntil: { type: Date, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CronLock', cronLockSchema);
