const mongoose = require('mongoose');

const procedureCommissionSchema = new mongoose.Schema({
  procedureId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Procedure'
  },
  percentage: {
    type: Number,
    min: 0,
    max: 100
  }
}, { _id: false });

const employeeSchema = new mongoose.Schema({
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
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    trim: true
  },
  generalCommission: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  procedureCommissions: [procedureCommissionSchema]
}, {
  timestamps: true
});

module.exports = mongoose.model('Employee', employeeSchema);

