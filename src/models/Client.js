const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  whatsappOptOut: {
    type: Boolean,
    default: false,
  },
  category: {
    type: String,
    enum: ['lead', 'cliente'],
    default: 'lead'
  },
  isNewClient: {
    type: Boolean,
    default: true
  },
  convertedAt: {
    type: Date,
    default: null
  },
  clientGroup: {
    type: String,
    enum: ['grupo_a', 'grupo_b', 'grupo_c', 'grupo_d'],
    default: 'grupo_a'
  },
  noReturnReason: {
    type: String,
    trim: true,
    default: ''
  },
  improvementReason: {
    type: String,
    trim: true,
    default: ''
  },
  leadSource: {
    type: String,
    enum: ['redes_sociais', 'google', 'indicacao', 'outros', null],
    default: null,
  },
  leadSourceOther: {
    type: String,
    trim: true,
    default: '',
  },
  // Origem durável para atribuição (primeira captura pública)
  sourceCampaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    default: null,
    index: true,
  },
  sourceFormId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Form',
    default: null,
    index: true,
  },
  pipelineStage: {
    type: String,
    enum: [
      'new',
      'qualified',
      'proposal',
      'negotiation',
      'won',
      'lost',
      null,
    ],
    default: 'new',
  },
  leadScore: {
    type: Number,
    min: 0,
    max: 100,
    default: null,
  },
  leadTemperature: {
    type: String,
    enum: ['frio', 'morno', 'quente', null],
    default: null,
  },
  qualification: {
    pain: { type: String, trim: true, default: '' },
    goal: { type: String, trim: true, default: '' },
    budgetBand: { type: String, trim: true, default: '' },
    urgency: { type: String, trim: true, default: '' },
    procedureInterest: { type: [String], default: [] },
    missingQuestions: { type: [String], default: [] },
    nextStep: { type: String, trim: true, default: '' },
    summary: { type: String, trim: true, default: '' },
    scoredAt: { type: Date, default: null },
    agentRunId: { type: String, trim: true, default: '' },
  },
  journeyPlan: {
    temperature: { type: String, enum: ['frio', 'morno', 'quente'], default: undefined },
    approvedAt: { type: Date, default: null },
    currentNodeId: { type: String, trim: true, default: '' },
    nodes: [{
      id: { type: String, trim: true },
      label: { type: String, trim: true },
      kind: {
        type: String,
        enum: ['lead', 'qualify', 'discovery', 'requalify', 'offer', 'close', 'won'],
      },
      pipelineStage: {
        type: String,
        enum: ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'],
      },
      cta: {
        type: String,
        enum: [
          'qualify',
          'whatsapp_discovery',
          'generate_offer',
          'conversation_close',
          'register_sale',
          'none',
        ],
      },
      status: {
        type: String,
        enum: ['pending', 'current', 'done', 'skipped'],
        default: 'pending',
      },
    }],
    reason: { type: String, trim: true, default: '' },
    generatedAt: { type: Date, default: null },
    agentRunId: { type: String, trim: true, default: '' },
  },
  /** Abordagem de conversa salva (discovery/close) — evita regenerar IA a cada reload */
  conversationCoach: {
    mode: { type: String, enum: ['discovery', 'close'], default: undefined },
    approach: { type: String, trim: true, default: '' },
    talkingPoints: { type: [String], default: [] },
    closeTechnique: { type: String, trim: true, default: '' },
    closeScript: { type: String, trim: true, default: '' },
    whatsappMessage: { type: String, trim: true, default: '' },
    techniques: { type: [String], default: [] },
    objectionHints: { type: [String], default: [] },
    source: { type: String, trim: true, default: '' },
    agentRunId: { type: String, trim: true, default: '' },
    generatedAt: { type: Date, default: null },
  },
  /** Oferta/pacote sugerido pela IA — evita regenerar a cada reload */
  suggestedOffer: {
    packageName: { type: String, trim: true, default: '' },
    procedures: [{
      id: { type: String, trim: true, default: '' },
      name: { type: String, trim: true, default: '' },
      value: { type: Number, default: 0 },
    }],
    priceAnchor: { type: Number, default: 0 },
    installmentSuggestion: { type: String, trim: true, default: '' },
    upsell: { type: String, trim: true, default: '' },
    rationale: { type: String, trim: true, default: '' },
    source: { type: String, trim: true, default: '' },
    agentRunId: { type: String, trim: true, default: '' },
    generatedAt: { type: Date, default: null },
  },
  nextFollowUpAt: {
    type: Date,
    default: null,
  },
  lostReason: {
    type: String,
    trim: true,
    default: '',
  },
  assignedTo: {
    type: String,
    trim: true,
    default: '',
  },
  photoConsentAt: {
    type: Date,
    default: null,
  },
  photoConsentVersion: {
    type: String,
    default: '',
    trim: true,
  },
  photoConsentMethod: {
    type: String,
    enum: ['attested_by_professional'],
    default: 'attested_by_professional',
  },
  photoConsentedByUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
}, {
  timestamps: true
});

module.exports = mongoose.model('Client', clientSchema);
