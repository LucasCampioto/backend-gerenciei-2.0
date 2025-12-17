const mongoose = require('mongoose');

const saleItemSchema = new mongoose.Schema({
  procedureId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Procedure'
  },
  procedureName: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  unitValue: {
    type: Number,
    required: true,
    min: 0
  },
  totalValue: {
    type: Number,
    required: true,
    min: 0
  }
}, { _id: false });

const saleSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  items: [saleItemSchema],
  totalValue: {
    type: Number,
    required: true,
    min: 0
  },
  commissionValue: {
    type: Number,
    default: 0,
    min: 0
  },
  netValue: {
    type: Number,
    required: true,
    min: 0
  },
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  employeeName: {
    type: String
  }
}, {
  timestamps: true
});

saleSchema.index({ createdAt: 1 });

module.exports = mongoose.model('Sale', saleSchema);

