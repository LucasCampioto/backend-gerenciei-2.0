const Joi = require('joi');

const documentSchema = Joi.object({
  fileName: Joi.string().optional(),
  fileType: Joi.string().valid('application/pdf', 'image/png', 'image/jpeg', 'image/jpg').optional(),
  fileUrl: Joi.string().allow('').optional(),
  signatureUrl: Joi.string().required().messages({
    'any.required': 'URL da assinatura é obrigatória'
  }),
  userName: Joi.string().required().messages({
    'any.required': 'Nome do usuário é obrigatório'
  }),
  userEmail: Joi.string().email().required().messages({
    'string.email': 'Email inválido',
    'any.required': 'Email do usuário é obrigatório'
  }),
  observations: Joi.string().allow('').optional()
}).custom((value, helpers) => {
  // Validar que há fileUrl ou que será fornecido via upload
  // A validação completa será feita no controller
  return value;
});

module.exports = {
  documentSchema
};

