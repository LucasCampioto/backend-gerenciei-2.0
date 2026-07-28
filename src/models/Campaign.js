const mongoose = require('mongoose');

/**
 * `content` é Mixed de propósito: o conteúdo é gerado pela IA e evolui rápido
 * (eBook rico, landing narrativa, quiz/funil, criativos com formato). Um schema
 * estrito aqui já causou perda silenciosa de campos (bullets, tip, heroHeadline,
 * format...). A validação de forma fica nos schemas Pydantic do agents e nos
 * types do frontend; o banco persiste o documento completo.
 *
 * Estrutura esperada de `content`:
 * - ebook:   { title, subtitle, coverTagline, sections[{heading, body, bullets[], tip}], disclaimer }
 * - landing: { heroHeadline, heroSubheadline, painTitle, painPoints[], learnTitle, learnItems[],
 *              benefits[], urgencyNote, formTitle, ctaText,
 *              statusQuoTitle, statusQuoScenes[], tensionTitle, tensionBody,
 *              insightTitle, insightBody, transformationTitle, transformationBody,
 *              howItWorksTitle, howItWorks[], faq[{question, answer}], trustPoints[],
 *              headline, bullets[], cta (legado) }
 * - quiz:    { title, promise, screens[{id, type: intro|question|bridge|capture|result,
 *              title, body, buttonText, question{kind, options[{label, weights{}}], scaleMin, scaleMax},
 *              nextScreenId}], resultProfiles[{id, title, description, recommendation, ctaText}] }
 * - checklist: { title, subtitle, intro, items[{text, tip?}], disclaimer }
 * - calculator: { title, subtitle, intro, inputs[], packages[], disclaimer }
 * - evaluation: { title, subtitle, weekLabel, intro, slots[], formTitle, ctaText, successNote }
 * - adCreatives[{headline, primaryText, cta, format: post|story, visualSuggestion}]
 * - audienceSuggestion
 */
const campaignSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    topic: {
      type: String,
      trim: true,
      default: '',
    },
    procedureName: {
      type: String,
      trim: true,
      default: '',
    },
    procedureId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Procedure',
      default: null,
    },
    publicSlug: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
      index: true,
    },
    /** Tipo da isca digital da campanha. */
    leadMagnetType: {
      type: String,
      enum: ['ebook', 'quiz', 'checklist', 'diagnosis', 'calculator', 'evaluation'],
      default: 'ebook',
    },
    /** WhatsApp da clínica para CTAs públicos (falar no WhatsApp). */
    contactWhatsApp: {
      type: String,
      trim: true,
      default: '',
    },
    /**
     * Variante do diagnóstico: laudo textual ou laudo + selfie (simulação sob demanda).
     * Só relevante quando leadMagnetType === 'diagnosis'.
     */
    diagnosisVariant: {
      type: String,
      enum: ['laudo', 'simulation'],
      default: 'laudo',
    },
    /** Cupom de incentivo no resultado (somente variante laudo / sem simulação). */
    couponCode: {
      type: String,
      trim: true,
      default: '',
    },
    /** Percentual de desconto do cupom (1–100). */
    couponPercent: {
      type: Number,
      default: null,
      min: 1,
      max: 100,
    },
    /** Texto personalizado junto ao cupom no resultado público. */
    couponMessage: {
      type: String,
      trim: true,
      default: '',
    },
    /**
     * Tema escolhido na etapa de validação (gerado pelo CampaignThemeStrategist):
     * { title, description, targetAudience, pain, promise, beliefToChange,
     *   conversionReason, adHook, leadMagnetType, scores{}, edited }
     */
    selectedTheme: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    content: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    /** Relatório do quality gate da geração (contagens, avisos, promptVersion). */
    qualityReport: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    pdfKey: {
      type: String,
      default: null,
    },
    source: {
      type: String,
      enum: ['agno', 'heuristic', null],
      default: null,
    },
    visits: {
      type: Number,
      default: 0,
    },
    leadsCount: {
      type: Number,
      default: 0,
    },
    /** Métricas do funil público: { quizStarts, quizCompletions, resultViews } */
    metrics: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    publishedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true, minimize: false }
);

module.exports = mongoose.model('Campaign', campaignSchema);
