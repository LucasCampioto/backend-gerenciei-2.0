const Joi = require('joi');

const fileType = Joi.string().valid('application/pdf', 'image/png', 'image/jpeg', 'image/jpg');

const documentTemplateSchema = Joi.object({
  name: Joi.string().trim().max(200).required().messages({
    'any.required': 'Nome do modelo é obrigatório',
    'string.empty': 'Nome do modelo é obrigatório',
  }),
  fileName: Joi.string().optional(),
  fileType: fileType.optional(),
});

const documentTemplateUpdateSchema = Joi.object({
  name: Joi.string().trim().max(200).optional().allow(''),
  fileName: Joi.string().optional(),
  fileType: fileType.optional(),
});

module.exports = {
  documentTemplateSchema,
  documentTemplateUpdateSchema,
};
