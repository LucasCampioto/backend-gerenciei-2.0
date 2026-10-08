const mongoose = require('mongoose');
const { organizationScopePlugin } = require('./plugins/organizationScope');

const questionSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ['nps', 'single_choice', 'multiple_choice', 'short_text', 'long_text', 'scale'],
    required: true,
  },
  label: {
    type: String,
    required: true,
    trim: true,
  },
  required: {
    type: Boolean,
    default: false,
  },
  options: {
    type: [String],
    default: [],
  },
  scaleMin: {
    type: Number,
    default: 1,
  },
  scaleMax: {
    type: Number,
    default: 5,
  },
  allowOther: {
    type: Boolean,
    default: false,
  },
  otherLabel: {
    type: String,
    default: 'Outro',
    trim: true,
  },
}, { _id: false });

const formSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
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
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active',
  },
  templateKey: {
    type: String,
    enum: ['nps', 'nao_fechamento', 'pos_procedimento', 'custom'],
    default: 'custom',
  },
  allowMultipleResponses: {
    type: Boolean,
    default: false,
  },
  couponId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Coupon',
    default: null,
  },
  /** Cupom revelado com animação no fim do formulário público. */
  couponEnabled: {
    type: Boolean,
    default: false,
  },
  couponCode: {
    type: String,
    trim: true,
    default: '',
  },
  couponPercent: {
    type: Number,
    default: null,
    min: 1,
    max: 100,
  },
  questions: {
    type: [questionSchema],
    default: [],
  },
}, {
  timestamps: true,
});

formSchema.index({ userId: 1, createdAt: -1 });

formSchema.plugin(organizationScopePlugin);

module.exports = mongoose.model('Form', formSchema);
