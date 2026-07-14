const Joi = require('joi');

const updateCrmClientSchema = Joi.object({
  name: Joi.string().trim().min(1).optional(),
  category: Joi.string().valid('lead', 'cliente').optional(),
  clientGroup: Joi.string().valid('grupo_a', 'grupo_b', 'grupo_c', 'grupo_d').optional(),
  noReturnReason: Joi.string().allow('').optional(),
  improvementReason: Joi.string().allow('').optional(),
  leadSource: Joi.string().valid('redes_sociais', 'google', 'indicacao', 'outros').allow(null).optional(),
  leadSourceOther: Joi.string().allow('').optional(),
  note: Joi.string().allow('').optional(),
});

const addCrmActionSchema = Joi.object({
  type: Joi.string().valid('note', 'contact').default('note'),
  content: Joi.string().min(1).required().messages({
    'any.required': 'Conteúdo da ação é obrigatório',
  }),
});

module.exports = {
  updateCrmClientSchema,
  addCrmActionSchema,
};
