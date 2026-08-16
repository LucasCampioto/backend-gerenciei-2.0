const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    seatLimit: {
      type: Number,
      required: false,
      default: null,
    },
  },
  { timestamps: true },
);

organizationSchema.index({ ownerUserId: 1 }, { unique: true });

module.exports = mongoose.model('Organization', organizationSchema);
