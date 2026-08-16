const mongoose = require('mongoose');
const { organizationScopePlugin } = require('./plugins/organizationScope');

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
  /** Conta de login (membro da org) ligada a este colaborador de comissão. */
  linkedUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
    default: null,
    index: true,
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

employeeSchema.plugin(organizationScopePlugin);

module.exports = mongoose.model('Employee', employeeSchema);

