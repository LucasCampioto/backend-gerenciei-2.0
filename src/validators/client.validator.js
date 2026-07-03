const Joi = require('joi');

const clientSchema = Joi.object({
  name: Joi.string().min(2).required().messages({
    'string.min': 'Nome deve ter no mínimo 2 caracteres',
    'any.required': 'Nome é obrigatório'
  }),
  phone: Joi.string().min(8).required().messages({
    'string.min': 'Telefone deve ter no mínimo 8 caracteres',
    'any.required': 'Telefone é obrigatório'
  }),
  category: Joi.string().valid('lead', 'cliente').default('lead'),
  isNewClient: Joi.boolean().default(true),
  clientGroup: Joi.string().valid('grupo_a', 'grupo_b', 'grupo_c', 'grupo_d').default('grupo_a'),
  noReturnReason: Joi.string().allow('').optional(),
  leadSource: Joi.string()
    .valid('redes_sociais', 'google', 'indicacao', 'outros')
    .allow(null, '')
    .optional(),
  leadSourceOther: Joi.string().allow('').optional(),
}).custom((value, helpers) => {
  if (value.leadSource === 'outros' && !value.leadSourceOther?.trim()) {
    return helpers.error('any.custom', {
      message: 'Informe o meio de origem quando selecionar Outros',
    });
  }
  return value;
});

module.exports = {
  clientSchema
};
