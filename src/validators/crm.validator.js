const Joi = require('joi');

const updateCrmClientSchema = Joi.object({
  clientGroup: Joi.string().valid('grupo_a', 'grupo_b', 'grupo_c', 'grupo_d').optional(),
  noReturnReason: Joi.string().allow('').optional(),
  improvementReason: Joi.string().allow('').optional(),
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
