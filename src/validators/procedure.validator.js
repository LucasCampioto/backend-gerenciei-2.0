const Joi = require('joi');

const procedureSchema = Joi.object({
  name: Joi.string().min(3).required().messages({
    'string.min': 'Nome deve ter no mínimo 3 caracteres',
    'any.required': 'Nome é obrigatório'
  }),
  description: Joi.string().required().messages({
    'any.required': 'Descrição é obrigatória'
  }),
  value: Joi.number().min(0).required().messages({
    'number.min': 'Valor deve ser positivo',
    'any.required': 'Valor é obrigatório'
  })
});

module.exports = {
  procedureSchema
};

