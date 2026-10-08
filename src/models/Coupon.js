const mongoose = require('mongoose');
const { organizationScopePlugin } = require('./plugins/organizationScope');

const couponSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  code: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
  },
  percent: {
    type: Number,
    required: true,
    min: 1,
    max: 100,
  },
  active: {
    type: Boolean,
    default: true,
  },
  title: {
    type: String,
    trim: true,
    default: '',
  },
  publicSlug: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  publicEnabled: {
    type: Boolean,
    default: true,
  },
  qrEnabled: {
    type: Boolean,
    default: false,
  },
  qrAction: {
    type: String,
    enum: ['page', 'whatsapp', 'url', 'form'],
    default: 'page',
  },
  whatsAppPhone: {
    type: String,
    trim: true,
    default: '',
  },
  whatsAppMessage: {
    type: String,
    trim: true,
    default: '',
  },
  actionUrl: {
    type: String,
    trim: true,
    default: '',
  },
  actionFormId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Form',
    default: null,
  },
  visits: {
    type: Number,
    default: 0,
  },
  scans: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

couponSchema.index({ userId: 1, code: 1 }, { unique: true });

couponSchema.plugin(organizationScopePlugin);

module.exports = mongoose.model('Coupon', couponSchema);
