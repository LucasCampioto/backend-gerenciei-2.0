const mongoose = require('mongoose');
const { BRAND_GROUP_IDS } = require('../constants/paymentFee.constants');

const paymentFeeSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  brandGroup: {
    type: String,
    enum: [...BRAND_GROUP_IDS, 'default'],
    required: true,
  },
  feeKey: {
    type: String,
    required: true,
    trim: true,
  },
  feePercentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
}, {
  timestamps: true,
});

paymentFeeSchema.index({ userId: 1, brandGroup: 1, feeKey: 1 }, { unique: true });

module.exports = mongoose.model('PaymentFee', paymentFeeSchema);
