const Joi = require('joi');
const { STOCK_UNITS } = require('../models/StockItem');

const stockItemSchema = Joi.object({
  name: Joi.string().min(2).max(120).required().messages({
    'string.min': 'Nome deve ter no mínimo 2 caracteres',
    'any.required': 'Nome é obrigatório',
  }),
  quantity: Joi.number().min(0).required().messages({
    'number.min': 'Quantidade deve ser zero ou positiva',
    'any.required': 'Quantidade é obrigatória',
  }),
  unit: Joi.string()
    .valid(...STOCK_UNITS)
    .required()
    .messages({
      'any.only': 'Unidade inválida',
      'any.required': 'Unidade é obrigatória',
    }),
  minQuantity: Joi.number().min(0).required().messages({
    'number.min': 'Estoque mínimo deve ser zero ou positivo',
    'any.required': 'Estoque mínimo é obrigatório',
  }),
  totalCost: Joi.number().min(0).allow(null).optional(),
  unitCost: Joi.number().min(0).allow(null).optional(),
  notes: Joi.string().allow('').max(500).optional(),
  active: Joi.boolean().optional(),
});

module.exports = {
  stockItemSchema,
};
