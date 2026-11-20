const mongoose = require('mongoose');
const { organizationScopePlugin } = require('./plugins/organizationScope');

const procedureSchema = new mongoose.Schema({
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
  description: {
    type: String,
    trim: true,
    default: '',
  },
  value: {
    type: Number,
    required: true,
    min: 0
  },
  returnAfterDays: {
    type: Number,
    min: 1,
    default: null,
  },
  /** estetica | cursos | estetica_avancada | produto — só estética avançada entra na simulação. */
  category: {
    type: String,
    enum: ['estetica', 'cursos', 'estetica_avancada', 'produto'],
    trim: true,
    default: undefined,
  },
  compatibleWith: {
    type: [String],
    default: [],
  },
}, {
  timestamps: true
});

procedureSchema.plugin(organizationScopePlugin);

module.exports = mongoose.model('Procedure', procedureSchema);

