const mongoose = require('mongoose');

const clientActivitySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true,
    index: true,
  },
  clientName: {
    type: String,
    trim: true,
  },
  type: {
    type: String,
    enum: ['group_change', 'initial_group', 'note', 'contact', 'reason_update'],
    required: true,
  },
  fromGroup: {
    type: String,
    enum: ['grupo_a', 'grupo_b', 'grupo_c', 'grupo_d'],
  },
  toGroup: {
    type: String,
    enum: ['grupo_a', 'grupo_b', 'grupo_c', 'grupo_d'],
  },
  content: {
    type: String,
    trim: true,
    default: '',
  },
}, {
  timestamps: true,
});

clientActivitySchema.index({ userId: 1, createdAt: -1 });
clientActivitySchema.index({ userId: 1, clientId: 1, createdAt: -1 });

module.exports = mongoose.model('ClientActivity', clientActivitySchema);
