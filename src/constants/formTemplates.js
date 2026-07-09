const { randomUUID } = require('crypto');

function createQuestion(partial) {
  return {
    id: randomUUID(),
    required: false,
    options: [],
    scaleMin: 1,
    scaleMax: 5,
    allowOther: false,
    otherLabel: 'Outro',
    ...partial,
  };
}

const FORM_TEMPLATES = {
  nps: {
    key: 'nps',
    label: 'NPS',
    title: 'Pesquisa de satisfação (NPS)',
    description: 'De 0 a 10, o quanto você recomendaria nossos serviços?',
    questions: [
      createQuestion({
        type: 'nps',
        label: 'De 0 a 10, o quanto você recomendaria nossos serviços?',
        required: true,
      }),
      createQuestion({
        type: 'long_text',
        label: 'O que podemos melhorar?',
        required: false,
      }),
    ],
  },
  nao_fechamento: {
    key: 'nao_fechamento',
    label: 'Motivo de não fechamento',
    title: 'Por que você ainda não fechou o procedimento?',
    description: 'Sua resposta nos ajuda a melhorar o atendimento.',
    questions: [
      createQuestion({
        type: 'single_choice',
        label: 'Qual o principal motivo?',
        required: true,
        options: ['Financeiro', 'Medo', 'Precisa pensar', 'Concorrência'],
        allowOther: true,
        otherLabel: 'Outro',
      }),
      createQuestion({
        type: 'long_text',
        label: 'Conte mais detalhes (opcional)',
        required: false,
      }),
    ],
  },
  pos_procedimento: {
    key: 'pos_procedimento',
    label: 'Satisfação pós-procedimento',
    title: 'Como foi sua experiência?',
    description: 'Queremos saber como foi seu atendimento e procedimento.',
    questions: [
      createQuestion({
        type: 'scale',
        label: 'Como você avalia sua experiência geral?',
        required: true,
        scaleMin: 1,
        scaleMax: 5,
      }),
      createQuestion({
        type: 'nps',
        label: 'De 0 a 10, o quanto você nos recomendaria?',
        required: true,
      }),
      createQuestion({
        type: 'long_text',
        label: 'Comentários adicionais',
        required: false,
      }),
    ],
  },
};

module.exports = {
  FORM_TEMPLATES,
  createQuestion,
};
