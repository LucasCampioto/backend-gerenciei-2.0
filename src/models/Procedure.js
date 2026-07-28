const mongoose = require('mongoose');

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
    required: true,
    trim: true
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
  /** estetica | cursos | estetica_avancada — só estética avançada entra na simulação. */
  category: {
    type: String,
    enum: ['estetica', 'cursos', 'estetica_avancada'],
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

module.exports = mongoose.model('Procedure', procedureSchema);

