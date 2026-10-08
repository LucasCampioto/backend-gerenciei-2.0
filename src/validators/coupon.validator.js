const Joi = require('joi');

const qrActions = ['page', 'whatsapp', 'url', 'form'];

const couponSchema = Joi.object({
  code: Joi.string().trim().min(2).max(40).required().messages({
    'string.min': 'O código precisa ter pelo menos 2 caracteres',
    'any.required': 'Informe o código do cupom',
  }),
  percent: Joi.number().integer().min(1).max(100).required().messages({
    'number.min': 'Informe um percentual entre 1 e 100',
    'number.max': 'Informe um percentual entre 1 e 100',
    'any.required': 'Informe o percentual de desconto',
  }),
  active: Joi.boolean().default(true),
  title: Joi.string().trim().max(80).allow('').default(''),
  publicEnabled: Joi.boolean().default(true),
  qrEnabled: Joi.boolean().default(false),
  qrAction: Joi.string().valid(...qrActions).default('page'),
  whatsAppPhone: Joi.string().trim().max(20).allow('').default(''),
  whatsAppMessage: Joi.string().trim().max(400).allow('').default(''),
  actionUrl: Joi.string().trim().max(500).allow('').default(''),
  actionFormId: Joi.string().trim().allow('', null).default(null),
}).custom((value, helpers) => {
  if (!value.qrEnabled || value.qrAction === 'page') return value;
  if (value.qrAction === 'whatsapp' && !String(value.whatsAppPhone || '').replace(/\D/g, '')) {
    return helpers.message('Informe o WhatsApp da ação do QR');
  }
  if (value.qrAction === 'url' && !String(value.actionUrl || '').trim()) {
    return helpers.message('Informe o link da ação do QR');
  }
  if (value.qrAction === 'form' && !value.actionFormId) {
    return helpers.message('Escolha o formulário da ação do QR');
  }
  return value;
});

const couponUpdateSchema = Joi.object({
  code: Joi.string().trim().min(2).max(40),
  percent: Joi.number().integer().min(1).max(100),
  active: Joi.boolean(),
  title: Joi.string().trim().max(80).allow(''),
  publicEnabled: Joi.boolean(),
  qrEnabled: Joi.boolean(),
  qrAction: Joi.string().valid(...qrActions),
  whatsAppPhone: Joi.string().trim().max(20).allow(''),
  whatsAppMessage: Joi.string().trim().max(400).allow(''),
  actionUrl: Joi.string().trim().max(500).allow(''),
  actionFormId: Joi.string().trim().allow('', null),
}).min(1);

module.exports = {
  couponSchema,
  couponUpdateSchema,
  qrActions,
};
