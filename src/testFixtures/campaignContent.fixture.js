/**
 * Golden fixture do conteúdo completo de campanha (eBook + landing narrativa +
 * quiz/funil + criativos). Usado nos testes de round-trip do model e nos
 * contratos de geração.
 */
const richCampaignContent = {
  ebook: {
    title: 'Harmonização facial sem medo: o guia completo',
    subtitle: 'Tudo o que avaliar antes de decidir, explicado sem jargão',
    coverTagline: 'Leitura de 15 minutos para decidir com segurança',
    disclaimer: 'Conteúdo educativo. Não substitui avaliação profissional presencial.',
    sections: [
      {
        heading: 'Por que tanta gente adia a decisão',
        body: 'Corpo do capítulo com texto útil e específico sobre o tema, longo o suficiente para o teste. '.repeat(4),
        bullets: ['MITO: resolve tudo em uma sessão', 'VERDADE: resultados são graduais'],
        tip: 'Leve fotos de referência para a avaliação.',
      },
      {
        heading: 'Checklist antes do procedimento',
        body: 'Segundo capítulo com conteúdo prático. '.repeat(6),
        bullets: ['Confirme a formação do profissional', 'Pergunte sobre o acompanhamento'],
        tip: '',
      },
    ],
  },
  landing: {
    heroHeadline: 'Descubra o que avaliar antes da harmonização facial',
    heroSubheadline: 'Um guia direto para decidir com segurança, sem pressão.',
    painTitle: 'Você se reconhece?',
    painPoints: ['Medo de ficar artificial', 'Cada lugar fala uma coisa', 'Não sei o que perguntar'],
    learnTitle: 'O que você vai aprender',
    learnItems: ['Como funciona de verdade', 'O checklist da avaliação', 'Sinais de alerta'],
    benefits: ['Leitura rápida', 'Feito para quem pesquisa agora', 'Tire dúvidas com a clínica'],
    urgencyNote: 'Material gratuito por tempo limitado.',
    formTitle: 'Receba o guia agora',
    ctaText: 'Quero o guia',
    statusQuoTitle: 'Hoje a sua pesquisa é assim',
    statusQuoScenes: [
      'Você pesquisa à noite e cada site diz uma coisa diferente',
      'Pergunta em grupo e recebe 10 opiniões contraditórias',
    ],
    tensionTitle: 'E o custo de decidir no escuro é real',
    tensionBody: 'Escolher sem critério é o que gera resultado artificial e arrependimento.',
    insightTitle: 'O que ninguém te conta',
    insightBody: 'A qualidade do resultado é decidida antes do procedimento: na avaliação.',
    transformationTitle: 'Como você sai deste guia',
    transformationBody: 'Sabendo exatamente o que perguntar e como escolher o profissional.',
    howItWorksTitle: 'Como funciona',
    howItWorks: ['Deixe seu WhatsApp', 'Receba o guia na hora', 'Tire dúvidas com a clínica'],
    faq: [
      { question: 'O guia é pago?', answer: 'Não, é 100% gratuito.' },
      { question: 'Vou receber ligação?', answer: 'Não. Só contato pelo WhatsApp, se você quiser.' },
    ],
    trustPoints: ['Conteúdo educativo', 'Sem compromisso'],
    headline: 'Baixe o guia gratuito',
    bullets: ['Respostas claras'],
    cta: 'Baixar grátis',
  },
  quiz: {
    title: 'Qual caminho combina com o seu objetivo?',
    promise: 'Descubra em 1 minuto o que faz sentido para o seu rosto',
    screens: [
      { id: 's1', type: 'intro', title: 'Descubra seu caminho', body: 'Responda 4 perguntas rápidas', buttonText: 'Começar' },
      {
        id: 's2',
        type: 'question',
        title: 'O que mais te incomoda hoje?',
        question: {
          kind: 'single_choice',
          options: [
            { label: 'Linhas de expressão', weights: { natural: 2, prevencao: 1 } },
            { label: 'Perda de volume', weights: { estrutura: 2 } },
          ],
        },
      },
      { id: 's3', type: 'bridge', title: 'Quase lá!', body: 'Isso ajuda a personalizar sua recomendação.', buttonText: 'Continuar' },
      {
        id: 's4',
        type: 'question',
        title: 'Quanto isso te incomoda?',
        question: { kind: 'scale', scaleMin: 1, scaleMax: 5, options: [] },
      },
      { id: 's5', type: 'capture', title: 'Seu resultado está pronto', body: 'Deixe seu contato para ver a recomendação', buttonText: 'Ver meu resultado' },
      { id: 's6', type: 'result', title: 'Seu perfil' },
    ],
    resultProfiles: [
      {
        id: 'natural',
        title: 'Perfil Naturalidade',
        description: 'Você busca suavizar sem mudar a sua expressão.',
        recommendation: 'Comece por uma avaliação focada em resultados sutis.',
        ctaText: 'Agendar avaliação',
      },
      {
        id: 'estrutura',
        title: 'Perfil Estrutura',
        description: 'Seu objetivo é devolver volume e contorno.',
        recommendation: 'Uma avaliação de harmonização completa faz sentido.',
        ctaText: 'Falar no WhatsApp',
      },
      {
        id: 'prevencao',
        title: 'Perfil Prevenção',
        description: 'Você quer agir antes dos sinais se aprofundarem.',
        recommendation: 'Protocolos preventivos são o melhor ponto de partida.',
        ctaText: 'Quero saber mais',
      },
    ],
  },
  adCreatives: [
    { headline: 'Guia gratuito', primaryText: 'Texto do anúncio 1', cta: 'Baixar', format: 'post', visualSuggestion: 'Mockup do eBook' },
    { headline: 'Pare de adiar', primaryText: 'Texto do anúncio 2', cta: 'Quero', format: 'post', visualSuggestion: 'Foto clean' },
    { headline: 'Faça o teste', primaryText: 'Texto do anúncio 3', cta: 'Começar', format: 'story', visualSuggestion: 'Story com pergunta' },
  ],
  audienceSuggestion: 'Mulheres 25–45, interesse em estética, raio de 20 km.',
};

const richSelectedTheme = {
  title: 'O guia anti-arrependimento da harmonização',
  description: 'Ataca o medo número 1: ficar artificial.',
  targetAudience: 'Mulheres 30-45 pesquisando há semanas',
  pain: 'Medo de resultado artificial',
  promise: 'Decidir com segurança em 15 minutos de leitura',
  beliefToChange: 'Harmonização deixa todo mundo igual',
  conversionReason: 'Fala com quem já tem intenção e trava por medo',
  adHook: 'O medo de ficar artificial é o que mais adia decisões',
  leadMagnetType: 'ebook',
  scores: { icpFit: 5, specificity: 4, intent: 5, distribution: 4, commercialImpact: 5 },
  edited: false,
};

module.exports = { richCampaignContent, richSelectedTheme };
