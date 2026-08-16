const Joi = require('joi');

const documentSchema = Joi.object({
  fileName: Joi.string().optional(),
  fileType: Joi.string().valid('application/pdf', 'image/png', 'image/jpeg', 'image/jpg').optional(),
  fileUrl: Joi.string().allow('').optional(),
  signatureUrl: Joi.string().allow('').optional(),
  userName: Joi.string().allow('').optional(),
  userEmail: Joi.string().email().allow('').optional().messages({
    'string.email': 'Email inválido',
  }),
  observations: Joi.string().allow('').optional(),
  title: Joi.string().trim().allow('').max(200).optional(),
  origin: Joi.string().valid('digital_signature', 'physical_scan').optional(),
  templateId: Joi.string().allow('').optional(),
  signedAt: Joi.alternatives().try(Joi.date(), Joi.string().allow('')).optional(),
  clientId: Joi.string().allow('').optional(),
  saleId: Joi.string().allow('').optional(),
  procedureId: Joi.string().allow('').optional(),
  hasFile: Joi.boolean().optional(),
}).custom((value, helpers) => {
  if (value.origin === 'physical_scan') {
    if (!value.clientId) {
      return helpers.message('Paciente é obrigatório para ficha física');
    }
    if (!value.signedAt) {
      return helpers.message('Data da assinatura no papel é obrigatória');
    }
    if (!value.hasFile && !String(value.fileUrl || '').trim()) {
      return helpers.message('Arquivo da ficha é obrigatório');
    }
  }
  return value;
});

module.exports = {
  documentSchema
};
