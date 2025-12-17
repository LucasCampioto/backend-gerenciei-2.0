const Joi = require('joi');

const procedureCommissionSchema = Joi.object({
  procedureId: Joi.string().required(),
  percentage: Joi.number().min(0).max(100).required()
});

const employeeSchema = Joi.object({
  name: Joi.string().min(3).required().messages({
    'string.min': 'Nome deve ter no mínimo 3 caracteres',
    'any.required': 'Nome é obrigatório'
  }),
  email: Joi.string().email().allow('').optional(),
  phone: Joi.string().allow('').optional(),
  generalCommission: Joi.number().min(0).max(100).required().messages({
    'number.min': 'Comissão deve ser entre 0 e 100',
    'number.max': 'Comissão deve ser entre 0 e 100',
    'any.required': 'Comissão geral é obrigatória'
  }),
  procedureCommissions: Joi.array().items(procedureCommissionSchema).optional()
});

module.exports = {
  employeeSchema
};

