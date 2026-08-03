const mongoose = require('mongoose');

const DEFAULT_TEMPLATE =
  'Olá {{nome}}! Passando para confirmar seu horário de hoje, {{data}} às {{horario}}. Qualquer imprevisto, nos avise por aqui.';

const DEFAULT_SIMULATION_INVITE_TEMPLATE =
  'Olá {{nome}}! Vi que você tem interesse de verdade. Quer que eu monte uma simulação do seu antes e depois? É rapidinho e ajuda a visualizar o resultado.';

const DEFAULT_NO_SHOW_FOLLOW_UP_TEMPLATE =
  'Olá {{nome}}! Sentimos sua falta no horário de {{data}} às {{horario}}. Quer que eu te ajude a remarcar? Me conta qual dia fica melhor pra você.';

const DEFAULT_FUNNEL_TEMPLATES = {
  ebook:
    'Olá {{nome}}! Seu material da campanha "{{campanha}}" já está disponível. Se quiser, me chama que eu te ajudo com o próximo passo.',
  quiz:
    'Olá {{nome}}! Vi o resultado do seu quiz em "{{campanha}}". Quer que eu te explique o perfil e o melhor caminho pra você?',
  checklist:
    'Olá {{nome}}! Seu checklist de "{{campanha}}" está pronto. Posso te ajudar a priorizar o que faz mais sentido agora?',
  diagnosis:
    'Olá {{nome}}! Li o retorno da sua avaliação em "{{campanha}}". Quer que eu te oriente no próximo passo?',
  calculator:
    'Olá {{nome}}! Vi o resultado da calculadora em "{{campanha}}". Posso te ajudar a entender as opções e agendar uma conversa?',
  evaluation:
    'Olá {{nome}}! Recebi sua solicitação de avaliação em "{{campanha}}". Vamos combinar o melhor horário?',
  form:
    'Olá {{nome}}! Obrigada por responder "{{campanha}}". Qualquer dúvida, é só me chamar por aqui — posso te ajudar com o próximo passo.',
};

const FUNNEL_TEMPLATE_KEYS = Object.keys(DEFAULT_FUNNEL_TEMPLATES);

const funnelTemplatesSchema = new mongoose.Schema(
  {
    ebook: { type: String, default: DEFAULT_FUNNEL_TEMPLATES.ebook },
    quiz: { type: String, default: DEFAULT_FUNNEL_TEMPLATES.quiz },
    checklist: { type: String, default: DEFAULT_FUNNEL_TEMPLATES.checklist },
    diagnosis: { type: String, default: DEFAULT_FUNNEL_TEMPLATES.diagnosis },
    calculator: { type: String, default: DEFAULT_FUNNEL_TEMPLATES.calculator },
    evaluation: { type: String, default: DEFAULT_FUNNEL_TEMPLATES.evaluation },
    form: { type: String, default: DEFAULT_FUNNEL_TEMPLATES.form },
  },
  { _id: false }
);

const whatsAppSettingsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['disconnected', 'qr', 'connected', 'failed'],
      default: 'disconnected',
    },
    connectedPhone: {
      type: String,
      trim: true,
      default: '',
    },
    remindersEnabled: {
      type: Boolean,
      default: false,
    },
    messageTemplate: {
      type: String,
      trim: true,
      default: DEFAULT_TEMPLATE,
    },
    funnelWelcomeEnabled: {
      type: Boolean,
      default: false,
    },
    funnelTemplates: {
      type: funnelTemplatesSchema,
      default: () => ({ ...DEFAULT_FUNNEL_TEMPLATES }),
    },
    simulationInviteEnabled: {
      type: Boolean,
      default: false,
    },
    simulationInviteTemplate: {
      type: String,
      trim: true,
      default: DEFAULT_SIMULATION_INVITE_TEMPLATE,
    },
    noShowFollowUpEnabled: {
      type: Boolean,
      default: false,
    },
    noShowFollowUpTemplate: {
      type: String,
      trim: true,
      default: DEFAULT_NO_SHOW_FOLLOW_UP_TEMPLATE,
    },
    lastTestSentAt: {
      type: Date,
      default: null,
    },
    lastQr: {
      type: String,
      default: '',
    },
    /** WAME instance key for this clinic (never expose in API responses). */
    wameInstanceKey: {
      type: String,
      trim: true,
      default: '',
      select: false,
    },
  },
  { timestamps: true }
);

whatsAppSettingsSchema.statics.DEFAULT_TEMPLATE = DEFAULT_TEMPLATE;
whatsAppSettingsSchema.statics.DEFAULT_SIMULATION_INVITE_TEMPLATE =
  DEFAULT_SIMULATION_INVITE_TEMPLATE;
whatsAppSettingsSchema.statics.DEFAULT_NO_SHOW_FOLLOW_UP_TEMPLATE =
  DEFAULT_NO_SHOW_FOLLOW_UP_TEMPLATE;
whatsAppSettingsSchema.statics.DEFAULT_FUNNEL_TEMPLATES = DEFAULT_FUNNEL_TEMPLATES;
whatsAppSettingsSchema.statics.FUNNEL_TEMPLATE_KEYS = FUNNEL_TEMPLATE_KEYS;

module.exports = mongoose.model('WhatsAppSettings', whatsAppSettingsSchema);
