/**
 * Tipos de isca e geradores heurísticos (seed / fallback) para campanhas.
 * ebook e quiz continuam nos fluxos Agno dedicados; estes cobrem as iscas novas.
 */

const LEAD_MAGNET_TYPES = [
  'ebook',
  'quiz',
  'checklist',
  'diagnosis',
  'calculator',
  'evaluation',
];

const FUNNEL_TYPES = new Set(['quiz', 'diagnosis']);
const LANDING_TYPES = new Set(['ebook', 'checklist', 'calculator', 'evaluation']);
const PDF_TYPES = new Set(['ebook', 'checklist']);

function normalizeLeadMagnetType(value) {
  const t = String(value || 'ebook').toLowerCase().trim();
  return LEAD_MAGNET_TYPES.includes(t) ? t : 'ebook';
}

function baseLanding(topic, {
  heroHeadline,
  heroSubheadline,
  formTitle,
  ctaText,
  learnItems,
  painPoints,
}) {
  return {
    heroHeadline,
    heroSubheadline,
    painTitle: 'Isso parece familiar?',
    painPoints: painPoints || [
      'Você pesquisa e cada lugar fala uma coisa diferente',
      'Tem medo de escolher errado',
      'Não sabe qual o próximo passo certo',
    ],
    learnTitle: 'O que você recebe',
    learnItems: learnItems || [],
    benefits: [
      'Feito para clínica de estética',
      'Receba no WhatsApp',
      'Próximo passo claro com a especialista',
    ],
    urgencyNote: 'Vagas e material limitados nesta semana.',
    formTitle,
    ctaText,
    statusQuoTitle: 'O cenário de hoje',
    statusQuoScenes: [
      'Você abre o Instagram e vê resultados lindos — mas não sabe se encaixa em você',
      'Pesquisa preços e sai mais confusa',
    ],
    tensionTitle: 'O que trava a decisão',
    tensionBody: `Sem um caminho claro sobre ${topic}, a tendência é adiar — e o desejo continua sem resposta.`,
    insightTitle: 'O ponto de virada',
    insightBody: 'Com informação objetiva e um próximo passo simples, a decisão fica leve.',
    transformationTitle: 'O que muda',
    transformationBody: 'Você entende o que faz sentido agora e conversa com a clínica sem chill.',
    howItWorksTitle: 'Como funciona',
    howItWorks: [
      'Deixe seu WhatsApp',
      'Receba o material / resultado',
      'Fale com a clínica se fizer sentido',
    ],
    faq: [
      {
        question: 'É gratuito?',
        answer: 'Sim. Você troca o WhatsApp pelo material ou resultado.',
      },
      {
        question: 'Vou ser cobrada depois?',
        answer: 'Não. O próximo passo só acontece se você quiser continuar a conversa.',
      },
    ],
    trustPoints: ['Conteúdo educativo', 'Sem pressão', 'Clínica real'],
    headline: heroHeadline,
    bullets: learnItems || [],
    cta: ctaText,
  };
}

function baseAds(topic, angle) {
  return [
    {
      headline: angle,
      primaryText: `Pensando em ${topic}? ${angle} — deixe o WhatsApp e receba agora.`,
      cta: 'Quero receber',
      format: 'post',
      visualSuggestion: 'Close do rosto/procedimento com texto curto e CTA.',
    },
    {
      headline: `Material gratuito: ${topic}`,
      primaryText: `Um caminho claro sobre ${topic}, sem enrolação. Receba no WhatsApp.`,
      cta: 'Saiba mais',
      format: 'post',
      visualSuggestion: 'Mockup do material ou resultado na tela do celular.',
    },
    {
      headline: 'Arrasta pra cima',
      primaryText: `1 minuto para descobrir o próximo passo em ${topic}.`,
      cta: 'Quero ver',
      format: 'story',
      visualSuggestion: 'Story 9:16 com pergunta grande e sticker de link.',
    },
  ];
}

function heuristicChecklistContent(topic) {
  const t = topic || 'estética';
  const items = [
    { text: `Liste o resultado que você busca com ${t}`, tip: 'Seja específica: formato, volume, naturalidade.' },
    { text: 'Anote 3 dúvidas para a avaliação', tip: 'Ex.: duração, retoque, cuidados.' },
    { text: 'Separe referências de fotos (o que gosta e o que não gosta)' },
    { text: 'Confira sua agenda nos próximos 14 dias (inchaço/cuidados)' },
    { text: 'Verifique contraindicações básicas com a profissional' },
    { text: 'Defina orçamento em faixa (não só o menor preço)' },
    { text: 'Combine o próximo passo: avaliação ou retorno com dúvidas' },
  ];
  return {
    checklist: {
      title: `Checklist: prepare-se para ${t}`,
      subtitle: 'Lista prática em 1 página',
      intro: 'Marque item a item antes da conversa com a clínica.',
      items,
      disclaimer: 'Conteúdo educativo. Não substitui avaliação presencial.',
    },
    landing: baseLanding(t, {
      heroHeadline: `Checklist gratuito: ${t}`,
      heroSubheadline: 'Uma página objetiva para decidir com mais segurança.',
      formTitle: 'Receba o checklist no WhatsApp',
      ctaText: 'Quero o checklist',
      learnItems: items.slice(0, 4).map((i) => i.text),
    }),
    adCreatives: baseAds(t, 'Checklist gratuito para não errar na decisão'),
    audienceSuggestion: `Pessoas pesquisando ${t} e comparando clínicas.`,
  };
}

function heuristicDiagnosisContent(topic) {
  const t = topic || 'estética';
  return {
    quiz: {
      title: `Diagnóstico: qual caminho de ${t} combina com você?`,
      promise: 'Responda em 1 minuto e receba um laudo curto + próximo passo.',
      screens: [
        {
          id: 'intro',
          type: 'intro',
          title: `Diagnóstico rápido de ${t}`,
          body: 'Vamos entender seu momento e te devolver um laudo objetivo.',
          buttonText: 'Começar',
          nextScreenId: 'q1',
        },
        {
          id: 'q1',
          type: 'question',
          title: 'O que mais te incomoda hoje?',
          question: {
            kind: 'single_choice',
            options: [
              { label: 'Formato / simetria', weights: { estrutura: 2, natural: 1 } },
              { label: 'Volume / definição', weights: { volume: 2, natural: 1 } },
              { label: 'Ainda estou explorando', weights: { explorar: 2, natural: 1 } },
            ],
          },
          nextScreenId: 'q2',
        },
        {
          id: 'q2',
          type: 'question',
          title: 'Qual urgência você sente?',
          question: {
            kind: 'single_choice',
            options: [
              { label: 'Quero resolver nas próximas semanas', weights: { volume: 1, estrutura: 1, explorar: 0 } },
              { label: 'Estou pesquisando com calma', weights: { explorar: 2 } },
              { label: 'Tenho um evento / data em mente', weights: { volume: 2, estrutura: 2 } },
            ],
          },
          nextScreenId: 'q3',
        },
        {
          id: 'q3',
          type: 'question',
          title: 'Como você descreve o resultado ideal?',
          question: {
            kind: 'single_choice',
            options: [
              { label: 'Bem natural, quase imperceptível', weights: { natural: 3 } },
              { label: 'Marcado, mas harmonioso', weights: { estrutura: 2, volume: 2 } },
              { label: 'Ainda não sei — preciso de orientação', weights: { explorar: 3 } },
            ],
          },
          nextScreenId: 'capture',
        },
        {
          id: 'capture',
          type: 'capture',
          title: 'Onde enviamos seu laudo?',
          body: 'Deixe nome e WhatsApp para ver o diagnóstico.',
          buttonText: 'Ver meu laudo',
          nextScreenId: 'result',
        },
        {
          id: 'result',
          type: 'result',
          title: 'Seu diagnóstico',
          body: 'Com base nas respostas, este é o caminho sugerido.',
        },
      ],
      resultProfiles: [
        {
          id: 'natural',
          title: 'Perfil natural',
          description: 'Você busca discrição e harmonia — resultado que parece seu, só mais descansado.',
          recommendation:
            'O próximo passo ideal é uma conversa rápida com a especialista para desenhar um plano sutil, no seu ritmo.',
          laudo:
            'Pelo que você respondeu, o que mais pesa é naturalidade: você quer se olhar no espelho e se reconhecer, sem cara de “procedimento”. Isso é ótimo — significa que um plano bem calibrado pode te dar exatamente o alívio visual que você busca, sem exagero. Adiar costuma alongar a insegurança (cada foto, cada evento). Agir agora é alinhar expectativa, técnica e timing com quem faz isso todo dia. Na conversa, você sai com clareza do que faz sentido para o seu rosto — e do que pode esperar.',
          tags: ['objetivo:natural', 'intencao:media'],
          ctaText: 'Falar no WhatsApp',
        },
        {
          id: 'estrutura',
          title: 'Perfil estrutura',
          description: 'Formato e simetria pesam mais para você do que volume isolado.',
          recommendation:
            'Marque uma avaliação para desenhar a estrutura primeiro — volume só entra se fizer sentido no conjunto.',
          laudo:
            'Suas respostas apontam prioridade em formato e harmonia: você não quer “encher”, quer encaixar. Quando a estrutura fica clara, o resultado costuma parecer mais sofisticado e duradouro — e a conversa deixa de ser chute de preço. Esperar sem plano aumenta a chance de comparar clínicas no escuro e se frustrar. O gancho agora é simples: uma avaliação objetiva para mapear o que corrigir primeiro e o que pode ficar para depois. Assim você decide com segurança, não por impulso.',
          tags: ['objetivo:estrutura', 'intencao:alta'],
          ctaText: 'Agendar conversa no WhatsApp',
        },
        {
          id: 'volume',
          title: 'Perfil definição',
          description: 'Você quer mais presença e contorno, com resultado perceptível.',
          recommendation:
            'Vamos alinhar expectativa e cuidados numa conversa rápida — para o resultado aparecer do jeito que você imagina.',
          laudo:
            'Você deixou claro que busca definição e presença: quer que o resultado se note, com harmonia. Esse tipo de desejo pede alinhamento fino (quanto, onde, e o que esperar nos primeiros dias). Sem essa conversa, é fácil ouvir “fica natural” e sair com algo diferente do que imaginou — ou adiar e continuar insatisfeita em cada selfie. O momento certo é agora: falar com a clínica, mostrar referências e sair com um caminho concreto. Quando a expectativa está alinhada, a decisão fica leve e o resultado, mais previsível.',
          tags: ['objetivo:volume', 'intencao:alta'],
          ctaText: 'Quero alinhar meu plano no WhatsApp',
        },
        {
          id: 'explorar',
          title: 'Perfil exploração',
          description: 'Você ainda está mapeando opções — e isso é inteligente.',
          recommendation:
            'Comece por uma conversa leve para tirar dúvidas sem compromisso de fechar hoje.',
          laudo:
            'Suas respostas mostram curiosidade saudável: você quer entender antes de decidir. O risco de ficar só pesquisando é acumular informação conflitante e travar. Um diagnóstico conversado encurta esse caminho — em poucos minutos você separa o que importa do ruído. Não precisa comprar agora; precisa de clareza. Falar com a clínica é o atalho: dúvidas respondidas, próximo passo óbvio (mesmo que seja “ainda não”). Quem esclarece cedo costuma decidir melhor — e com menos arrependimento.',
          tags: ['objetivo:explorar', 'intencao:baixa'],
          ctaText: 'Tirar dúvidas no WhatsApp',
        },
      ],
    },
    landing: baseLanding(t, {
      heroHeadline: `Diagnóstico gratuito de ${t}`,
      heroSubheadline: 'Responda 3 perguntas e receba um laudo com próximo passo.',
      formTitle: 'Comece o diagnóstico',
      ctaText: 'Fazer diagnóstico',
      learnItems: ['Laudo personalizado', 'Próximo passo claro', 'Conversa com a especialista'],
    }),
    adCreatives: baseAds(t, 'Diagnóstico gratuito: descubra seu caminho'),
    audienceSuggestion: `Pessoas em dúvida sobre qual caminho de ${t} seguir.`,
  };
}

function proceduresForTopic(procedures, topic) {
  const list = Array.isArray(procedures) ? procedures : [];
  const t = String(topic || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!list.length) return [];
  const tokens = t
    .split(/[^a-z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
  const synonyms = [];
  if (/toxina|botox|botulin/.test(t)) synonyms.push('toxina', 'botox', 'botulin');
  if (/preench|acido|hialuron|labio|labial|bigode/.test(t)) {
    synonyms.push('preench', 'acido', 'hialuron', 'labio');
  }
  if (/limpeza|pele|skincare|acne/.test(t)) synonyms.push('limpeza', 'pele', 'acne');
  if (/laser|mancha|melasma/.test(t)) synonyms.push('laser', 'mancha', 'melasma');
  const keys = [...new Set([...tokens, ...synonyms])];

  const scored = list
    .map((p) => {
      const n = String(p.name || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      const hits = keys.filter((k) => n.includes(k)).length;
      return { p, hits };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || Number(b.p.value || 0) - Number(a.p.value || 0));

  if (scored.length) return scored.map((x) => x.p).slice(0, 8);
  // Sem match lexical: não puxa procedimentos de outro tema (ex. labial numa campanha de toxina)
  return [];
}

function formatBrl(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });
}

function isToxinaTopic(topic) {
  const t = String(topic || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return /toxina|botox|botulin/.test(t);
}

/** Pacotes Good/Better/Best: regiões/abrangência diferem; preço sempre "a partir de" o valor-base. */
function buildCalculatorTiers(topic, baseProc) {
  const t = topic || 'estética';
  const procName = baseProc?.name ? String(baseProc.name) : t;
  const unit = Number(baseProc?.value);
  const hasUnit = Number.isFinite(unit) && unit > 0;
  const toxina = isToxinaTopic(t) || isToxinaTopic(procName);

  const priceHint = hasUnit
    ? `A partir de ${formatBrl(unit)}`
    : 'A partir do valor da avaliação';
  const baseValue = hasUnit ? Math.round(unit) : null;

  if (toxina) {
    return [
      {
        id: 'essencial',
        title: 'Plano 1 região',
        procedureName: procName,
        procedureValue: baseValue,
        priceHint,
        regions: ['1 região prioritária (ex.: glabela ou testa — a que mais te incomoda)'],
        summary:
          'Com o investimento que você indicou, o caminho mais honesto é começar por uma região só: resolve o ponto que mais incomoda, com resultado natural. O valor final só sai após avaliação.',
        recommendation:
          'Peça a simulação sem compromisso no WhatsApp e confirme na avaliação qual região priorizar.',
        highlights: [
          'Abrangência: 1 região facial',
          'Foco no ponto de maior desconforto (testa, glabela ou pés de galinha)',
          `Referência: ${priceHint} — unidades e total na avaliação`,
          'Simulação de antes/depois sem compromisso',
        ],
        match: { budget: ['essencial'] },
      },
      {
        id: 'completo',
        title: 'Plano 2 regiões',
        procedureName: procName,
        procedureValue: baseValue,
        priceHint,
        regions: ['Testa', 'Glabela (entre as sobrancelhas)'],
        summary:
          'Seu perfil combina com um plano intermediário: duas regiões da face superior costumam dar mais harmonia do que tratar só um ponto. O valor continua “a partir de” — fechamos na avaliação.',
        recommendation:
          'Bom equilíbrio entre investimento e resultado. Veja a simulação sem compromisso e alinhe as 2 regiões no WhatsApp.',
        highlights: [
          'Abrangência: 2 regiões (em geral testa + glabela)',
          'Mais harmonia do terço superior do que o plano de 1 região',
          `Referência: ${priceHint} — orçamento completo só após avaliação`,
          'Simulação de antes/depois sem compromisso',
        ],
        match: { budget: ['completo'] },
      },
      {
        id: 'premium',
        title: 'Plano face superior (3 regiões)',
        procedureName: procName,
        procedureValue: baseValue,
        priceHint,
        regions: ['Testa', 'Glabela (entre as sobrancelhas)', 'Pés de galinha (canto dos olhos)'],
        summary:
          'Para quem quer o visual mais equilibrado do terço superior: testa, glabela e canto dos olhos no mesmo protocolo. Mostramos a faixa “a partir de” para não assustar — o plano real sai na avaliação.',
        recommendation:
          'Peça a simulação sem compromisso e confirme unidades/regiões com a clínica no WhatsApp.',
        highlights: [
          'Abrangência: 3 regiões do terço superior',
          'Leitura mais “descansada” e uniforme do olhar/expressão',
          `Referência: ${priceHint} — valor final sob avaliação`,
          'Simulação de antes/depois sem compromisso',
        ],
        match: { budget: ['premium'] },
      },
    ];
  }

  return [
    {
      id: 'essencial',
      title: `Plano essencial · ${procName}`,
      procedureName: procName,
      procedureValue: baseValue,
      priceHint,
      regions: ['Foco pontual no que mais te incomoda agora'],
      summary: `Com o valor que você sinalizou, o plano essencial de ${procName} prioriza o núcleo do resultado. O preço exibido é só a referência “a partir de”.`,
      recommendation: 'Peça a simulação sem compromisso e alinhe o próximo passo no WhatsApp.',
      highlights: [
        'Abrangência enxuta / 1 foco',
        `Referência: ${priceHint}`,
        'Simulação sem compromisso · valor final na avaliação',
      ],
      match: { budget: ['essencial'] },
    },
    {
      id: 'completo',
      title: `Plano completo · ${procName}`,
      procedureName: procName,
      procedureValue: baseValue,
      priceHint,
      regions: ['Protocolo intermediário (mais cobertura que o essencial)'],
      summary: `Seu perfil combina com um plano completo de ${procName}: mais cobertura que o essencial, ainda com referência “a partir de” até a avaliação.`,
      recommendation: 'Bom para quem já sabe o que quer — veja a simulação e confirme no WhatsApp.',
      highlights: [
        'Mais abrangência que o plano essencial',
        `Referência: ${priceHint}`,
        'Simulação sem compromisso',
      ],
      match: { budget: ['completo'] },
    },
    {
      id: 'premium',
      title: `Plano premium · ${procName}`,
      procedureName: procName,
      procedureValue: baseValue,
      priceHint,
      regions: ['Protocolo amplo / melhor encaixe de resultado'],
      summary: `Para o melhor encaixe de resultado em ${procName}. Mantemos “a partir de” na tela — o plano fechado só depois da avaliação.`,
      recommendation: 'Peça a simulação sem compromisso e alinhe detalhes no WhatsApp.',
      highlights: [
        'Máxima abrangência desta calculadora',
        `Referência: ${priceHint}`,
        'Simulação sem compromisso',
      ],
      match: { budget: ['premium'] },
    },
  ];
}

function heuristicCalculatorContent(topic, procedures = []) {
  const t = topic || 'estética';
  const scoped = proceduresForTopic(procedures, t);
  const baseProc = scoped[0] || null;
  const procName = baseProc?.name ? String(baseProc.name) : t;
  const toxina = isToxinaTopic(t) || isToxinaTopic(procName);
  const packages = buildCalculatorTiers(t, baseProc);

  const budgetOptions = toxina
    ? [
        { id: 'essencial', label: 'Começar por 1 região (entrada)' },
        { id: 'completo', label: '2 regiões — mais harmonia' },
        { id: 'premium', label: 'Face superior (3 regiões) — plano mais completo' },
      ]
    : [
        { id: 'essencial', label: 'Plano essencial (começar enxuto)' },
        { id: 'completo', label: 'Plano completo (mais cobertura)' },
        { id: 'premium', label: 'Plano premium (melhor encaixe)' },
      ];

  const focusInput = toxina
    ? {
        id: 'focus',
        label: 'Qual área do rosto mais te incomoda hoje?',
        kind: 'single_choice',
        options: [
          { id: 'testa', label: 'Testa (linhas horizontais)' },
          { id: 'glabela', label: 'Glabela (entre as sobrancelhas)' },
          { id: 'pes_galinha', label: 'Pés de galinha (canto dos olhos)' },
          { id: 'mais_regioes', label: 'Mais de uma área do rosto / quero harmonia geral' },
        ],
      }
    : {
        id: 'focus',
        label: `O que mais pesa na sua decisão sobre ${t}?`,
        kind: 'single_choice',
        options: [
          { id: 'natural', label: 'Resultado natural / discreto' },
          { id: 'equilibrio', label: 'Equilíbrio entre naturalidade e presença' },
          { id: 'marcado', label: 'Resultado mais perceptível' },
          { id: 'duvida', label: 'Ainda estou comparando opções' },
        ],
      };

  return {
    calculator: {
      title: toxina
        ? `Calculadora: quanto investir em ${procName}`
        : `Calculadora: investimento em ${t}`,
      subtitle: toxina
        ? 'O pacote muda conforme o quanto você quer investir — e quais regiões fazem sentido'
        : 'O pacote muda conforme sua disposição a investir',
      intro:
        'Responda com sinceridade. Mostramos a referência “a partir de” do catálogo; regiões e valor final só após avaliação. Tem simulação sem compromisso.',
      inputs: [
        focusInput,
        {
          id: 'budget',
          label: 'Por onde você prefere começar?',
          kind: 'single_choice',
          options: budgetOptions,
        },
        {
          id: 'urgency',
          label: 'Qual a urgência para avançar?',
          kind: 'single_choice',
          options: [
            { id: 'baixa', label: 'Sem pressa — ainda explorando' },
            { id: 'media', label: 'Quero decidir neste mês' },
            { id: 'alta', label: 'Tenho data / evento próximo' },
          ],
        },
      ],
      packages,
      disclaimer:
        'Valores são referência “a partir de” do catálogo. Unidades, regiões e total só após avaliação presencial. Simulação ilustrativa e sem compromisso — não é resultado clínico.',
    },
    landing: baseLanding(t, {
      heroHeadline: toxina
        ? `Quanto investir em ${procName}?`
        : `Quanto investir em ${t}?`,
      heroSubheadline: toxina
        ? 'Descubra se faz sentido 1, 2 ou 3 regiões — conforme o que você pode investir.'
        : 'Calcule o pacote alinhado à sua disposição a pagar — sem compromisso.',
      formTitle: 'Ver meu resultado',
      ctaText: 'Calcular agora',
      learnItems: toxina
        ? ['Regiões sugeridas', 'Faixa de investimento', 'Próximo passo no WhatsApp']
        : ['Pacote sugerido', 'Faixa estimada', 'Próximo passo no WhatsApp'],
    }),
    adCreatives: baseAds(t, 'Calcule o pacote certo antes de decidir'),
    audienceSuggestion: `Pessoas comparando preço/pacote de ${t}.`,
  };
}

function heuristicEvaluationContent(topic) {
  const t = topic || 'estética';
  const slots = [
    { id: 'seg-manha', day: 'Segunda', time: 'Manhã', label: 'Segunda · manhã', capacity: 2 },
    { id: 'seg-tarde', day: 'Segunda', time: 'Tarde', label: 'Segunda · tarde', capacity: 2 },
    { id: 'qua-manha', day: 'Quarta', time: 'Manhã', label: 'Quarta · manhã', capacity: 2 },
    { id: 'qua-tarde', day: 'Quarta', time: 'Tarde', label: 'Quarta · tarde', capacity: 1 },
    { id: 'sex-manha', day: 'Sexta', time: 'Manhã', label: 'Sexta · manhã', capacity: 2 },
  ];
  return {
    evaluation: {
      title: `Avaliação de ${t} · fila da semana`,
      subtitle: 'Reserve interesse em uma vaga — confirmamos no WhatsApp',
      weekLabel: 'Vagas desta semana',
      intro: 'Escolha o horário que prefere. A clínica confirma a disponibilidade pelo WhatsApp.',
      slots,
      formTitle: 'Quero uma vaga',
      ctaText: 'Entrar na fila',
      successNote: 'Recebemos seu interesse. Em breve a clínica confirma no WhatsApp.',
    },
    landing: baseLanding(t, {
      heroHeadline: `Avaliação de ${t}: entre na fila da semana`,
      heroSubheadline: 'Poucas vagas. Deixe o WhatsApp e a preferência de horário.',
      formTitle: 'Entrar na fila',
      ctaText: 'Quero avaliar',
      learnItems: ['Horários da semana', 'Confirmação no WhatsApp', 'Sem compromisso de compra'],
      painPoints: [
        'Você quer avaliar, mas não sabe quando tem vaga',
        'Deixa para depois e a agenda enche',
        'Prefere um horário que realmente funcione',
      ],
    }),
    adCreatives: baseAds(t, 'Restam vagas de avaliação esta semana'),
    audienceSuggestion: `Pessoas prontas para avaliação de ${t}.`,
  };
}

function heuristicMagnetContent(leadMagnetType, topic, procedures = []) {
  switch (normalizeLeadMagnetType(leadMagnetType)) {
    case 'checklist':
      return heuristicChecklistContent(topic);
    case 'diagnosis':
      return heuristicDiagnosisContent(topic);
    case 'calculator':
      return heuristicCalculatorContent(topic, procedures);
    case 'evaluation':
      return heuristicEvaluationContent(topic);
    default:
      return null;
  }
}

/** Converte checklist em shape de eBook para reutilizar o gerador de PDF. */
function checklistToEbookPdfShape(checklist) {
  if (!checklist) return null;
  return {
    title: checklist.title || 'Checklist',
    subtitle: checklist.subtitle || '',
    coverTagline: 'Checklist prático',
    sections: (checklist.items || []).map((item, i) => ({
      heading: `${i + 1}. ${item.text}`,
      body: item.tip || 'Marque quando concluir este item.',
      bullets: item.tip ? [item.tip] : [],
      tip: item.tip || '',
    })),
    disclaimer: checklist.disclaimer || '',
  };
}

function isFunnelMagnet(type) {
  return FUNNEL_TYPES.has(normalizeLeadMagnetType(type));
}

function needsPdf(type) {
  return PDF_TYPES.has(normalizeLeadMagnetType(type));
}

function contentIsComplete(leadMagnetType, content) {
  const t = normalizeLeadMagnetType(leadMagnetType);
  if (!content) return false;
  if (t === 'ebook') return Boolean(content.ebook?.sections?.length);
  if (t === 'quiz' || t === 'diagnosis') {
    return Boolean(content.quiz?.screens?.length && content.quiz?.resultProfiles?.length);
  }
  if (t === 'checklist') return Boolean(content.checklist?.items?.length);
  if (t === 'calculator') {
    return Boolean(content.calculator?.inputs?.length && content.calculator?.packages?.length);
  }
  if (t === 'evaluation') return Boolean(content.evaluation?.slots?.length);
  return Boolean(content.landing?.heroHeadline || content.landing?.headline);
}

module.exports = {
  LEAD_MAGNET_TYPES,
  FUNNEL_TYPES,
  LANDING_TYPES,
  PDF_TYPES,
  normalizeLeadMagnetType,
  isFunnelMagnet,
  needsPdf,
  contentIsComplete,
  heuristicMagnetContent,
  checklistToEbookPdfShape,
  proceduresForTopic,
  heuristicChecklistContent,
  heuristicDiagnosisContent,
  heuristicCalculatorContent,
  heuristicEvaluationContent,
};
