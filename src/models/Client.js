const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    enum: ['lead', 'cliente'],
    default: 'lead'
  },
  isNewClient: {
    type: Boolean,
    default: true
  },
  convertedAt: {
    type: Date,
    default: null
  },
  clientGroup: {
    type: String,
    enum: ['grupo_a', 'grupo_b', 'grupo_c', 'grupo_d'],
    default: 'grupo_a'
  },
  noReturnReason: {
    type: String,
    trim: true,
    default: ''
  },
  improvementReason: {
    type: String,
    trim: true,
    default: ''
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Client', clientSchema);
