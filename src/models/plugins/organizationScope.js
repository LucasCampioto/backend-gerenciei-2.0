const mongoose = require('mongoose');

/**
 * Campos aditivos de tenant — nunca required (produção legada sem o campo continua válida).
 */
function organizationScopePlugin(schema) {
  schema.add({
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: false,
      default: null,
      index: true,
    },
    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      default: null,
    },
  });
}

module.exports = { organizationScopePlugin };
