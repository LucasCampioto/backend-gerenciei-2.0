const Joi = require('joi');

const patchCommercialActionSchema = Joi.object({
  status: Joi.string().valid('pending', 'done', 'snoozed', 'dismissed').optional(),
  snoozedUntil: Joi.date().iso().allow(null).optional(),
  outcome: Joi.string().valid('won', 'lost', 'contacted', 'no_answer').allow(null).optional(),
  realizedRevenue: Joi.number().min(0).optional(),
  feedback: Joi.string().valid('accepted', 'edited', 'rejected').allow(null).optional(),
  editedPayload: Joi.any().optional(),
  suggestedMessage: Joi.string().allow('').optional(),
  suggestedAction: Joi.string().allow('').optional(),
});

const completeCommercialActionSchema = Joi.object({
  outcome: Joi.string().valid('won', 'lost', 'contacted', 'no_answer').optional(),
  realizedRevenue: Joi.number().min(0).optional(),
  feedback: Joi.string().valid('accepted', 'edited', 'rejected').optional(),
});

const snoozeCommercialActionSchema = Joi.object({
  snoozedUntil: Joi.date().iso().optional(),
  feedback: Joi.string().valid('accepted', 'edited', 'rejected').optional(),
});

const feedbackCommercialActionSchema = Joi.object({
  feedback: Joi.string().valid('accepted', 'edited', 'rejected').required(),
  editedPayload: Joi.any().optional(),
  suggestedMessage: Joi.string().allow('').optional(),
  suggestedAction: Joi.string().allow('').optional(),
});

const objectionSchema = Joi.object({
  objectionText: Joi.string().allow('').max(2000).optional(),
});

const qualifySchema = Joi.object({
  force: Joi.boolean().optional(),
});

module.exports = {
  patchCommercialActionSchema,
  completeCommercialActionSchema,
  snoozeCommercialActionSchema,
  feedbackCommercialActionSchema,
  objectionSchema,
  qualifySchema,
};
