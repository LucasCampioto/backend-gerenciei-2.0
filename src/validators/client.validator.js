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
  isNewClient: Joi.boolean().default(true)
});

module.exports = {
  clientSchema
};
