const Joi = require('joi');

const expenseSchema = Joi.object({
  description: Joi.string().min(3).required().messages({
    'string.min': 'Descrição deve ter no mínimo 3 caracteres',
    'any.required': 'Descrição é obrigatória'
  }),
  value: Joi.number().min(0).required().messages({
    'number.min': 'Valor deve ser positivo',
    'any.required': 'Valor é obrigatório'
  }),
  category: Joi.string().required().messages({
    'any.required': 'Categoria é obrigatória'
  })
});

module.exports = {
  expenseSchema
};

