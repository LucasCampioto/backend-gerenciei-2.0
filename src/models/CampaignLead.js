const mongoose = require('mongoose');

/**
 * Lead captado em campanha pública (eBook ou quiz).
 * Índice único por campanha + telefone impede cadastro duplicado.
 */
const campaignLeadSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
      index: true,
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: true,
      index: true,
    },
    /** Telefone normalizado (somente dígitos, 10–11 chars). */
    phoneDigits: {
      type: String,
      required: true,
      trim: true,
    },
    respondentName: {
      type: String,
      trim: true,
      default: '',
    },
    quizAnswers: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    quizProfileId: {
      type: String,
      trim: true,
      default: null,
    },
    /** Laudo gerado na captura (personalizado pelas respostas). */
    personalizedLaudo: {
      type: String,
      default: '',
    },
    personalizedDescription: {
      type: String,
      default: '',
    },
    personalizedRecommendation: {
      type: String,
      default: '',
    },
    /** Respostas/resultado de calculadora, slot de avaliação, tags de diagnóstico */
    magnetPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    /** none | photo_ready | processing | ready | failed */
    simulationStatus: {
      type: String,
      enum: ['none', 'photo_ready', 'processing', 'ready', 'failed'],
      default: 'none',
    },
    beforeImageKey: { type: String, default: null },
    afterImageKey: { type: String, default: null },
    enhancePairId: { type: String, default: null },
    simulationError: { type: String, default: null },
    waSalesMessage: { type: String, default: '' },
    uploadTokenHash: { type: String, default: null },
    uploadTokenExpiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

campaignLeadSchema.index({ campaignId: 1, phoneDigits: 1 }, { unique: true });
campaignLeadSchema.index({ userId: 1, campaignId: 1, createdAt: -1 });

module.exports = mongoose.model('CampaignLead', campaignLeadSchema);
