const mongoose = require('mongoose');
const { organizationScopePlugin } = require('./plugins/organizationScope');

const documentTemplateSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  fileName: {
    type: String,
    required: true,
  },
  fileType: {
    type: String,
    required: true,
    enum: ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'],
  },
  fileUrl: {
    type: String,
    required: true,
  },
}, {
  timestamps: true,
});

documentTemplateSchema.plugin(organizationScopePlugin);

module.exports = mongoose.model('DocumentTemplate', documentTemplateSchema);
