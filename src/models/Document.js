const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  fileName: {
    type: String,
    required: true
  },
  fileType: {
    type: String,
    required: true,
    enum: ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg']
  },
  fileUrl: {
    type: String,
    required: true
  },
  signatureUrl: {
    type: String,
    required: true
  },
  userName: {
    type: String,
    required: true
  },
  userEmail: {
    type: String,
    required: true,
    lowercase: true
  },
  observations: {
    type: String
  },
  signedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  status: {
    type: String,
    default: 'Assinado'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Document', documentSchema);

