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
  }),
  returnAfterDays: Joi.number().min(1).allow(null).optional().messages({
    'number.min': 'Retorno em dias deve ser no mínimo 1'
  }),
  category: Joi.string()
    .valid('estetica', 'cursos', 'estetica_avancada')
    .required()
    .messages({
      'any.only': 'Categoria inválida. Use: estética, cursos ou estética avançada',
      'any.required': 'Categoria é obrigatória'
    }),
  compatibleWith: Joi.array().items(Joi.string()).optional()
});

module.exports = {
  procedureSchema
};
