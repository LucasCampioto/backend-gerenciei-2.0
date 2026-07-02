const Joi = require('joi');

const saleItemSchema = Joi.object({
  procedureId: Joi.string().optional(),
  procedureName: Joi.string().required(),
  quantity: Joi.number().min(1).required(),
  unitValue: Joi.number().min(0).required(),
  totalValue: Joi.number().min(0).required()
});

const saleSchema = Joi.object({
  items: Joi.array().items(saleItemSchema).min(1).required().messages({
    'array.min': 'Deve ter pelo menos um item na venda',
    'any.required': 'Itens são obrigatórios'
  }),
  totalValue: Joi.number().min(0).required(),
  commissionValue: Joi.number().min(0).default(0).optional(),
  netValue: Joi.number().min(0).optional(),
  paymentMethod: Joi.string().valid('crédito', 'débito', 'link de pagamento', 'dinheiro', 'pix').required().messages({
    'any.only': 'Método de pagamento deve ser: crédito, débito, link de pagamento ou dinheiro',
    'any.required': 'Método de pagamento é obrigatório'
  }),
  discount: Joi.number().min(0).default(0).optional(),
  paymentFeePercentage: Joi.number().min(0).max(100).optional(),
  paymentFeeValue: Joi.number().min(0).optional(),
  cardBrandGroup: Joi.string().valid('visa_master', 'elo_amex', 'default').optional(),
  installments: Joi.number().integer().min(1).max(12).optional(),
  employeeId: Joi.string().allow(null, '').optional(),
  employeeName: Joi.string().allow(null, '').optional(),
  clientId: Joi.string().required().messages({
    'any.required': 'Cliente é obrigatório'
  }),
  clientName: Joi.string().required().messages({
    'any.required': 'Nome do cliente é obrigatório'
  }),
  clientPhone: Joi.string().allow(null, '').optional()
});

module.exports = {
  saleSchema
};

