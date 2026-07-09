const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema({
  questionId: {
    type: String,
    required: true,
  },
  value: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
}, { _id: false });

const formResponseSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  formId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Form',
    required: true,
    index: true,
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true,
    index: true,
  },
  respondentPhone: {
    type: String,
    required: true,
    trim: true,
  },
  respondentName: {
    type: String,
    trim: true,
    default: '',
  },
  answers: {
    type: [answerSchema],
    default: [],
  },
  submittedAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, {
  timestamps: true,
});

formResponseSchema.index({ formId: 1, submittedAt: -1 });
formResponseSchema.index({ clientId: 1, formId: 1 });
formResponseSchema.index({ userId: 1, formId: 1 });

module.exports = mongoose.model('FormResponse', formResponseSchema);
