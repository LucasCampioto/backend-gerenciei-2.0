const Joi = require('joi');

const questionTypes = ['nps', 'single_choice', 'multiple_choice', 'short_text', 'long_text', 'scale'];

const questionSchema = Joi.object({
  id: Joi.string().required(),
  type: Joi.string().valid(...questionTypes).required(),
  label: Joi.string().min(1).required(),
  required: Joi.boolean().default(false),
  options: Joi.array().items(Joi.string().min(1)).default([]),
  scaleMin: Joi.number().integer().min(1).default(1),
  scaleMax: Joi.number().integer().min(1).default(5),
  allowOther: Joi.boolean().default(false),
  otherLabel: Joi.string().default('Outro'),
}).custom((value, helpers) => {
  if (['single_choice', 'multiple_choice'].includes(value.type) && (!value.options || value.options.length < 2)) {
    return helpers.error('any.custom', { message: 'Perguntas de escolha precisam de pelo menos 2 opções' });
  }
  if (value.type === 'scale' && value.scaleMax <= value.scaleMin) {
    return helpers.error('any.custom', { message: 'Escala inválida: máximo deve ser maior que mínimo' });
  }
  return value;
});

const formSchema = Joi.object({
  title: Joi.string().min(2).required().messages({
    'string.min': 'Título deve ter no mínimo 2 caracteres',
    'any.required': 'Título é obrigatório',
  }),
  description: Joi.string().allow('').optional(),
  status: Joi.string().valid('active', 'inactive').default('active'),
  templateKey: Joi.string().valid('nps', 'nao_fechamento', 'pos_procedimento', 'custom').default('custom'),
  allowMultipleResponses: Joi.boolean().default(false),
  couponId: Joi.string().trim().allow('', null).default(null),
  couponEnabled: Joi.boolean().default(false),
  couponCode: Joi.when('couponEnabled', {
    is: true,
    then: Joi.string().trim().min(1).max(40).required().messages({
      'string.empty': 'Informe o código de desconto',
      'string.min': 'Informe o código de desconto',
      'any.required': 'Informe o código de desconto',
    }),
    otherwise: Joi.string().trim().max(40).allow('').default(''),
  }),
  couponPercent: Joi.when('couponEnabled', {
    is: true,
    then: Joi.number().integer().min(1).max(100).required().messages({
      'any.required': 'Informe um percentual de desconto entre 1 e 100',
      'number.base': 'Informe um percentual de desconto entre 1 e 100',
      'number.min': 'Informe um percentual de desconto entre 1 e 100',
      'number.max': 'Informe um percentual de desconto entre 1 e 100',
    }),
    otherwise: Joi.number().integer().min(1).max(100).allow(null).default(null),
  }),
  couponPage: Joi.object({
    publicEnabled: Joi.boolean(),
    title: Joi.string().trim().max(80).allow(''),
    qrEnabled: Joi.boolean(),
    qrAction: Joi.string().valid('page', 'whatsapp', 'url', 'form'),
    whatsAppPhone: Joi.string().trim().max(20).allow(''),
    whatsAppMessage: Joi.string().trim().max(400).allow(''),
    actionUrl: Joi.string().trim().max(500).allow(''),
    actionFormId: Joi.string().trim().allow('', null),
  }).optional(),
  questions: Joi.array().items(questionSchema).min(1).required().messages({
    'array.min': 'Adicione pelo menos uma pergunta',
    'any.required': 'Perguntas são obrigatórias',
  }),
});

const publicResponseSchema = Joi.object({
  phone: Joi.string().min(8).required().messages({
    'string.min': 'Telefone inválido',
    'any.required': 'Telefone é obrigatório',
  }),
  name: Joi.string().allow('').optional(),
  answers: Joi.array().items(
    Joi.object({
      questionId: Joi.string().required(),
      value: Joi.alternatives().try(
        Joi.string(),
        Joi.number(),
        Joi.array().items(
          Joi.alternatives().try(
            Joi.string(),
            Joi.object({
              other: Joi.boolean().valid(true).required(),
              text: Joi.string().allow('').required(),
            })
          )
        ),
        Joi.object({
          other: Joi.boolean().valid(true).required(),
          text: Joi.string().allow('').required(),
        })
      ).required(),
    })
  ).min(1).required(),
});

module.exports = {
  formSchema,
  publicResponseSchema,
  questionTypes,
};
