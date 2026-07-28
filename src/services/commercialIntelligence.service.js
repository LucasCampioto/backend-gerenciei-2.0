const mongoose = require('mongoose');
const Client = require('../models/Client');
const ClientActivity = require('../models/ClientActivity');
const FormResponse = require('../models/FormResponse');
const Form = require('../models/Form');
const Sale = require('../models/Sale');
const Procedure = require('../models/Procedure');
const CommercialAction = require('../models/CommercialAction');
const { buildActionQueue } = require('./actionQueue.service');
const { logActivity } = require('./clientActivity.service');
const {
  scoreToTemperature,
  buildJourneyPlan,
  formatJourneyPlan,
  getCurrentNode,
  resolvePipelineStageForNode,
  syncClientPipelineWithJourney,
  normalizeJourneyPlanStages,
  advanceJourneyPlan: advancePlanNodes,
  moveJourneyPlanToNode,
} = require('./journeyPlan.service');
const agno = require('./agno.client');
const aiDailyCache = require('./aiDailyCache.service');

function maskPhone(phone = '') {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function answersToText(answers = []) {
  return (answers || [])
    .map((a) => `${a.questionLabel || a.questionId || 'Pergunta'}: ${Array.isArray(a.value) ? a.value.join(', ') : a.value}`)
    .join('\n');
}

function heuristicQualify({ client, formAnswersText }) {
  const text = `${client.name || ''} ${formAnswersText || ''}`.toLowerCase();
  let score = 45;
  const missingQuestions = [];

  if (/urgente|casamento|evento|logo|semana/.test(text)) score += 20;
  if (/caro|preço|preco|orçamento|orcamento|parcel/.test(text)) score += 10;
  if (/medo|dor|inseguro|resultado/.test(text)) score += 10;
  if (/botox|preench|laser|harmon|bioestim/.test(text)) score += 15;
  if ((client.leadSource || '') === 'indicacao') score += 10;

  score = Math.max(0, Math.min(100, score));

  if (!/orçamento|orcamento|preço|preco|r\$/.test(text)) {
    missingQuestions.push('Qual faixa de investimento faz sentido agora?');
  }
  if (!/objetivo|quero|desejo|resultado/.test(text)) {
    missingQuestions.push('Qual resultado você quer alcançar e em quanto tempo?');
  }
  if (!/quando|urgente|mês|mes|semana/.test(text)) {
    missingQuestions.push('Quando gostaria de começar o tratamento?');
  }

  return {
    score,
    pain: /medo|inseguro|dor/.test(text) ? 'Insegurança com resultado / medo do procedimento' : '',
    goal: /harmon|botox|laser|preench/.test(text) ? 'Melhora estética com procedimento específico' : 'Ainda não mapeado',
    budgetBand: /parcel|barato|econômico/.test(text) ? 'sensível a preço' : 'não informado',
    urgency: /urgente|casamento|evento|logo/.test(text) ? 'alta' : 'média',
    procedureInterest: [],
    missingQuestions,
    nextStep: score >= 70
      ? 'Ligar hoje com roteiro de qualificação e oferta'
      : 'Completar perguntas faltantes e remarcar contato',
    summary: `Lead ${client.name} com score ${score}. Priorize descobrir objetivo, orçamento e urgência.`,
    source: 'rule',
    promptVersion: agno.PROMPT_VERSION,
  };
}

function heuristicOffer({ procedures, avgTicket }) {
  const sorted = [...(procedures || [])].sort((a, b) => (b.value || 0) - (a.value || 0));
  const top = sorted.slice(0, 2);
  const anchor = top.reduce((sum, p) => sum + (p.value || 0), 0) || avgTicket || 0;
  return {
    packageName: top.length ? top.map((p) => p.name).join(' + ') : 'Pacote inicial',
    procedures: top.map((p) => ({
      id: p.id || p._id?.toString(),
      name: p.name,
      value: p.value,
    })),
    priceAnchor: anchor,
    installmentSuggestion: anchor >= 1500 ? '3x sem juros (se a clínica oferecer)' : 'à vista ou 2x',
    upsell: sorted[2]?.name || '',
    rationale: 'Sugestão baseada nos procedimentos mais caros/catalogados da clínica e ticket médio.',
    source: 'rule',
    promptVersion: agno.PROMPT_VERSION,
  };
}

function heuristicObjection({ objectionText }) {
  const text = (objectionText || '').toLowerCase();
  let kind = 'outro';
  if (text.includes('caro') || text.includes('preço') || text.includes('preco') || text.includes('valor')) {
    kind = 'preco';
  } else if (text.includes('medo') || text.includes('dor') || text.includes('risco')) {
    kind = 'medo';
  } else if (text.includes('pensar') || text.includes('depois') || text.includes('decidir')) {
    kind = 'preciso_pensar';
  } else if (text.includes('outra') || text.includes('concorr')) {
    kind = 'concorrencia';
  }

  const scripts = {
    preco:
      'Entendo a preocupação com o investimento. O que costuma pesar mais: o valor à vista ou encaixar no mês? Posso te mostrar o parcelamento e o que está incluso no acompanhamento.',
    medo:
      'Faz sentido ter cuidado. Vamos alinhar expectativas, técnica e recuperação com calma — sem pressa. Qual ponto te deixa mais insegura hoje?',
    preciso_pensar:
      'Claro. Além de pensar, tem alguma dúvida específica (resultado, prazo ou investimento)? Se quiser, marcamos um horário curto pra fechar o que falta.',
    concorrencia:
      'Legal comparar. O diferencial aqui é o plano sob medida + acompanhamento. O que você mais valorizou na outra proposta?',
    outro:
      'Entendi. Me conta o que ainda gera dúvida pra eu te ajudar no próximo passo com clareza.',
  };

  return {
    objectionType: kind,
    script: scripts[kind],
    anchors: ['resultado natural', 'acompanhamento', 'plano sob medida'],
    followUp: 'Retomar em 48h com pergunta objetiva e opção A/B.',
  };
}

function heuristicConversation({ client, qualification, mode = 'close' }) {
  const firstName = String(client?.name || 'oi').split(/\s+/)[0];
  const pain = qualification?.pain || 'o que mais te incomoda hoje';
  const goal = qualification?.goal || 'o resultado que você busca';
  const urgency = (qualification?.urgency || 'média').toLowerCase();
  const budget = qualification?.budgetBand || 'não informado';
  const missing = Array.isArray(qualification?.missingQuestions)
    ? qualification.missingQuestions
    : [];

  if (mode === 'discovery') {
    const questions = [
      ...(missing.length ? missing : []),
      'Qual resultado você mais quer alcançar com o procedimento?',
      'Já fez algo parecido antes? Como foi a experiência?',
      'Tem alguma data ou evento em mente (viagem, casamento, foto)?',
      'O que mais te preocupa ou te segura na hora de decidir?',
      'Qual faixa de investimento faz sentido pra você neste momento?',
    ]
      .map((q) => String(q || '').trim())
      .filter((q, i, arr) => q && arr.indexOf(q) === i)
      .slice(0, 5);

    const firstQ = questions[0];

    return {
      approach:
        `O objetivo desta conversa é ENTENDER ${firstName}, não vender ainda. Siga 3 passos simples:\n` +
        `1) Quebre o gelo: cumprimente pelo nome e diga que quer entender antes de sugerir qualquer coisa.\n` +
        `2) Faça UMA pergunta por vez e escute — deixe ${firstName} falar mais que você.\n` +
        `3) Repita com suas palavras o que entendeu ("então o que mais pesa é...") antes de seguir. ` +
        `Não fale preço nem pacote nesta etapa.`,
      talkingPoints: questions.map((q, i) => `${i + 1}. ${q}`),
      closeTechnique: 'descoberta guiada',
      closeScript:
        `Roteiro pronto para conduzir:\n` +
        `• Abertura: "Oi ${firstName}, tudo bem? 🙂 Vi seu interesse e, antes de te passar qualquer coisa, queria te entender melhor."\n` +
        `• Primeira pergunta: "${firstQ}"\n` +
        `• Depois da resposta: reflita ("entendi, então...") e vá para a próxima pergunta da lista.\n` +
        `• Encerramento: "Perfeito, já tenho uma boa ideia! Deixa eu montar algo sob medida pra você e já te trago."`,
      whatsappMessage:
        `Oi ${firstName}, tudo bem? 🙂 Vi seu interesse e, antes de te passar qualquer proposta, ` +
        `queria te entender melhor pra sugerir o que faz sentido de verdade. ${firstQ}`,
      techniques: [
        'Uma pergunta por vez (não dispare tudo de uma vez)',
        'Escuta ativa: repita com suas palavras o que a pessoa disse',
        'Nada de preço ou pacote nesta etapa',
        'Anote as respostas — elas montam a oferta personalizada depois',
      ],
      objectionHints: [
        'Respondeu curto → "Me conta um pouco mais sobre isso?"',
        'Pediu preço logo → "Te passo já já, só quero acertar o que faz sentido pra você primeiro 🙂"',
        `Sumiu → volte em 1 dia: "Oi ${firstName}! Consegue me responder rapidinho? Assim já te trago algo certeiro"`,
        'Demonstrou receio → valide o medo e cite acompanhamento/segurança em 1 frase',
      ],
      mode: 'discovery',
      source: 'heuristic',
    };
  }

  const closeTechnique =
    urgency === 'alta'
      ? 'fecho por próximo passo'
      : budget.toLowerCase().includes('sensível') || budget.toLowerCase().includes('sensivel')
        ? 'fecho por escolha'
        : 'fecho por resumo';

  return {
    approach:
      `Abra leve com ${firstName}: cumprimente e pergunte como ela está em relação a ${goal}. ` +
      'Escute 30 segundos antes de falar de pacote ou preço.',
    talkingPoints: [
      `Reconhecer a dor: ${pain}`,
      `Ligar ao objetivo: ${goal}`,
      'Explicar o caminho em linguagem simples (sem jargão)',
      budget !== 'não informado'
        ? `Respeitar o orçamento percebido (${budget}) e oferecer encaixe (parcelas/escopo)`
        : 'Descobrir faixa de investimento com pergunta aberta',
      urgency === 'alta'
        ? 'Usar a urgência real (evento/data) sem inventar escassez'
        : 'Propor um próximo passo pequeno (simulação ou horário)',
    ],
    closeTechnique,
    closeScript:
      closeTechnique === 'fecho por escolha'
        ? `${firstName}, pensando no que você me contou, faz mais sentido o plano completo ou a versão mais enxuta pra começar? Podemos reservar o horário agora.`
        : closeTechnique === 'fecho por próximo passo'
          ? `${firstName}, pelo prazo que você citou, o próximo passo claro é agendar. Prefere esta semana ou a próxima?`
          : `${firstName}, resumindo: você quer ${goal} e o que mais pesa é ${pain}. Faz sentido avançarmos com a proposta que montei?`,
    whatsappMessage:
      `Oi ${firstName}! Pensei no que você comentou sobre ${goal} e montei um caminho bem alinhado. ` +
      'Posso te mandar as opções e a gente escolhe juntas?',
    techniques: ['resumo de valor', closeTechnique, 'isolar preciso pensar'],
    objectionHints: [
      'Preciso pensar → “Além de pensar, qual ponto trava?” + data de retorno',
      'Está caro → reancorar no resultado + parcelamento (sem desconto sem troca)',
      'Medo → validar + explicar segurança/acompanhamento em 1 frase',
    ],
    mode: 'close',
    source: 'heuristic',
  };
}

async function loadClientContext(userId, clientId) {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const clientObjectId = new mongoose.Types.ObjectId(clientId);

  const [client, activities, formResponses, sales, procedures] = await Promise.all([
    Client.findOne({ _id: clientObjectId, userId: userObjectId }).lean(),
    ClientActivity.find({ userId: userObjectId, clientId: clientObjectId })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean(),
    FormResponse.find({ userId: userObjectId, clientId: clientObjectId })
      .sort({ submittedAt: -1 })
      .limit(5)
      .lean(),
    Sale.find({ userId: userObjectId, clientId: clientObjectId })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
    Procedure.find({ userId: userObjectId }).select('name value category compatibleWith returnAfterDays').lean(),
  ]);

  if (!client) return null;

  const formIds = [...new Set(formResponses.map((r) => r.formId?.toString()).filter(Boolean))];
  const forms = formIds.length
    ? await Form.find({ _id: { $in: formIds } }).select('title').lean()
    : [];
  const formTitleMap = new Map(forms.map((f) => [f._id.toString(), f.title]));

  const ticketRows = await Sale.aggregate([
    { $match: { userId: userObjectId } },
    { $group: { _id: null, avgTicket: { $avg: '$netValue' }, count: { $sum: 1 } } },
  ]);

  return {
    client: {
      id: client._id.toString(),
      name: client.name,
      phoneMasked: maskPhone(client.phone),
      category: client.category,
      clientGroup: client.clientGroup,
      leadSource: client.leadSource,
      leadSourceOther: client.leadSourceOther,
      pipelineStage: client.pipelineStage,
      leadScore: client.leadScore,
      qualification: client.qualification || {},
      noReturnReason: client.noReturnReason,
      lostReason: client.lostReason,
      createdAt: client.createdAt,
    },
    activities: activities.map((a) => ({
      type: a.type,
      content: a.content,
      createdAt: a.createdAt,
    })),
    formResponses: formResponses.map((r) => ({
      formTitle: formTitleMap.get(r.formId?.toString()) || 'Formulário',
      answersText: answersToText(r.answers),
      submittedAt: r.submittedAt,
    })),
    sales: sales.map((s) => ({
      netValue: s.netValue,
      items: (s.items || []).map((i) => i.procedureName),
      createdAt: s.createdAt,
    })),
    procedures: procedures.map((p) => ({
      id: p._id.toString(),
      name: p.name,
      value: p.value,
      category: p.category || '',
      compatibleWith: p.compatibleWith || [],
    })),
    clinicSignals: {
      avgTicket: ticketRows[0]?.avgTicket || 0,
      salesCount: ticketRows[0]?.count || 0,
    },
  };
}

async function qualifyClient(userId, clientId, { force = false, advanceStage = true } = {}) {
  const context = await loadClientContext(userId, clientId);
  if (!context) {
    const err = new Error('Cliente não encontrado');
    err.statusCode = 404;
    throw err;
  }

  const formAnswersText = context.formResponses.map((f) => f.answersText).join('\n');
  let result = heuristicQualify({ client: context.client, formAnswersText });
  let agentRunId = '';

  if (agno.isAgnoEnabled()) {
    try {
      const agnoResult = await agno.qualifyLead({
        userId,
        context: {
          ...context,
          formAnswersText,
        },
      });
      if (agnoResult?.data) {
        result = { ...result, ...agnoResult.data, source: 'agent' };
        agentRunId = agnoResult.runId || agnoResult.data.agentRunId || '';
      }
    } catch (error) {
      console.warn('[commercialIntelligence] qualify fallback:', error.message);
    }
  }

  const client = await Client.findOne({ _id: clientId, userId });
  if (!client) {
    const err = new Error('Cliente não encontrado');
    err.statusCode = 404;
    throw err;
  }

  if (force || !client.leadScore || result.source === 'agent') {
    const temperature = scoreToTemperature(result.score);
    const journeyPlan = buildJourneyPlan({
      temperature,
      qualification: {
        ...result,
        missingQuestions: result.missingQuestions || [],
      },
      agentRunId,
    });

    client.leadScore = result.score;
    client.leadTemperature = temperature;
    // Captura pública (ebook/form) passa advanceStage:false para o lead
    // permanecer em "Lead entra" até o comercial agir na Jornada.
    if (
      advanceStage &&
      client.pipelineStage !== 'won' &&
      client.pipelineStage !== 'lost'
    ) {
      client.pipelineStage = 'qualified';
    } else if (
      !client.pipelineStage ||
      client.pipelineStage === null
    ) {
      client.pipelineStage = 'new';
    }
    client.qualification = {
      pain: result.pain || '',
      goal: result.goal || '',
      budgetBand: result.budgetBand || '',
      urgency: result.urgency || '',
      procedureInterest: result.procedureInterest || [],
      missingQuestions: result.missingQuestions || [],
      nextStep: result.nextStep || '',
      summary: result.summary || '',
      scoredAt: new Date(),
      agentRunId,
    };
    client.journeyPlan = journeyPlan;
    await client.save();

    await logActivity({
      userId,
      clientId: client._id,
      clientName: client.name,
      type: 'qualification',
      content: `Score ${result.score} · ${temperature}: ${result.summary || result.nextStep || 'Qualificado'}`,
    });
  }

  const current = getCurrentNode(client.journeyPlan);
  return {
    clientId: client._id.toString(),
    ...result,
    agentRunId,
    qualification: client.qualification,
    leadScore: client.leadScore,
    leadTemperature: client.leadTemperature,
    pipelineStage: client.pipelineStage,
    journeyPlan: formatJourneyPlan(client.journeyPlan),
    temperature: client.leadTemperature,
    suggestedAction: current
      ? { nodeId: current.id, cta: current.cta, label: current.label }
      : null,
  };
}

async function suggestOffer(userId, clientId, { force = false } = {}) {
  const context = await loadClientContext(userId, clientId);
  if (!context) {
    const err = new Error('Cliente não encontrado');
    err.statusCode = 404;
    throw err;
  }

  const client = await Client.findOne({ _id: clientId, userId });
  const saved = client?.suggestedOffer;
  if (!force && saved?.packageName && saved?.rationale) {
    return {
      clientId,
      packageName: saved.packageName || '',
      procedures: Array.isArray(saved.procedures) ? saved.procedures : [],
      priceAnchor: Number(saved.priceAnchor) || 0,
      installmentSuggestion: saved.installmentSuggestion || '',
      upsell: saved.upsell || '',
      rationale: saved.rationale || '',
      source: saved.source || 'cache',
      agentRunId: saved.agentRunId || '',
      cached: true,
      generatedAt: saved.generatedAt
        ? (saved.generatedAt instanceof Date
          ? saved.generatedAt.toISOString()
          : saved.generatedAt)
        : null,
      pipelineStage: client?.pipelineStage || null,
    };
  }

  let result = heuristicOffer({
    procedures: context.procedures,
    avgTicket: context.clinicSignals.avgTicket,
  });
  let agentRunId = '';

  if (agno.isAgnoEnabled()) {
    try {
      const agnoResult = await agno.planOffer({ userId, context });
      if (agnoResult?.data) {
        result = { ...result, ...agnoResult.data, source: 'agent' };
        agentRunId = agnoResult.runId || '';
      }
    } catch (error) {
      console.warn('[commercialIntelligence] offer fallback:', error.message);
    }
  }

  // Oferta gerada → avança para "proposal" se ainda estiver no início do funil
  if (client) {
    const stage = client.pipelineStage || 'new';
    if (stage === 'new' || stage === 'qualified') {
      client.pipelineStage = 'proposal';
      await logActivity({
        userId,
        clientId,
        clientName: client.name,
        type: 'stage_change',
        content: `${stage === 'new' ? 'Lead entra' : 'Qualificado'} → Plano + preço`,
      });
    }

    client.suggestedOffer = {
      packageName: result.packageName || '',
      procedures: Array.isArray(result.procedures) ? result.procedures : [],
      priceAnchor: Number(result.priceAnchor) || 0,
      installmentSuggestion: result.installmentSuggestion || '',
      upsell: result.upsell || '',
      rationale: result.rationale || '',
      source: result.source || 'rule',
      agentRunId: agentRunId || '',
      generatedAt: new Date(),
    };
    await client.save();
  }

  return {
    clientId,
    ...result,
    agentRunId,
    cached: false,
    generatedAt: client?.suggestedOffer?.generatedAt
      ? client.suggestedOffer.generatedAt.toISOString()
      : new Date().toISOString(),
    pipelineStage: client?.pipelineStage || 'proposal',
  };
}

async function suggestObjectionScript(userId, clientId, objectionText) {
  const context = await loadClientContext(userId, clientId);
  if (!context) {
    const err = new Error('Cliente não encontrado');
    err.statusCode = 404;
    throw err;
  }

  let result = heuristicObjection({ objectionText });
  let agentRunId = '';

  if (agno.isAgnoEnabled()) {
    try {
      const agnoResult = await agno.coachObjection({
        userId,
        context,
        objectionText,
      });
      if (agnoResult?.data) {
        result = { ...result, ...agnoResult.data, source: 'agent' };
        agentRunId = agnoResult.runId || '';
      }
    } catch (error) {
      console.warn('[commercialIntelligence] objection fallback:', error.message);
    }
  }

  await logActivity({
    userId,
    clientId,
    clientName: context.client.name,
    type: 'objection',
    content: `[${result.objectionType}] ${objectionText || ''} → ${result.script}`.slice(0, 500),
  });

  return { clientId, ...result, agentRunId };
}

async function suggestConversationCoach(userId, clientId, { mode: modeHint, force = false } = {}) {
  const context = await loadClientContext(userId, clientId);
  if (!context) {
    const err = new Error('Cliente não encontrado');
    err.statusCode = 404;
    throw err;
  }

  const clientDoc = await Client.findOne({ _id: clientId, userId });
  const current = getCurrentNode(clientDoc?.journeyPlan);
  const mode =
    modeHint === 'discovery' || modeHint === 'close'
      ? modeHint
      : current?.kind === 'discovery'
        ? 'discovery'
        : 'close';

  const saved = clientDoc?.conversationCoach;
  if (
    !force &&
    saved?.approach &&
    saved.mode === mode
  ) {
    return {
      clientId,
      approach: saved.approach || '',
      talkingPoints: Array.isArray(saved.talkingPoints) ? saved.talkingPoints : [],
      closeTechnique: saved.closeTechnique || '',
      closeScript: saved.closeScript || '',
      whatsappMessage: saved.whatsappMessage || '',
      techniques: Array.isArray(saved.techniques) ? saved.techniques : [],
      objectionHints: Array.isArray(saved.objectionHints) ? saved.objectionHints : [],
      mode,
      source: saved.source || 'cache',
      agentRunId: saved.agentRunId || '',
      cached: true,
      generatedAt: saved.generatedAt
        ? (saved.generatedAt instanceof Date
          ? saved.generatedAt.toISOString()
          : saved.generatedAt)
        : null,
      pipelineStage: clientDoc?.pipelineStage || null,
    };
  }

  let result = heuristicConversation({
    client: context.client,
    qualification: context.client.qualification || {},
    mode,
  });
  let agentRunId = '';

  if (agno.isAgnoEnabled()) {
    try {
      const agnoResult = await agno.coachConversation({
        userId,
        context: { ...context, conversationMode: mode },
        mode,
      });
      if (agnoResult?.data) {
        result = { ...result, ...agnoResult.data, source: 'agent', mode };
        agentRunId = agnoResult.runId || '';
      }
    } catch (error) {
      console.warn('[commercialIntelligence] conversation fallback:', error.message);
    }
  }

  if (clientDoc && mode === 'close') {
    const stage = clientDoc.pipelineStage || 'new';
    if (stage === 'proposal' || stage === 'qualified') {
      const fromLabel = stage === 'proposal' ? 'Plano + preço' : 'Qualificado';
      clientDoc.pipelineStage = 'negotiation';
      await logActivity({
        userId,
        clientId,
        clientName: clientDoc.name,
        type: 'stage_change',
        content: `${fromLabel} → Conversa`,
      });
    }
  }
  // discovery: permanece em Qualifica (qualified) — não empurra para Oferta/Conversa

  if (clientDoc) {
    clientDoc.conversationCoach = {
      mode,
      approach: result.approach || '',
      talkingPoints: Array.isArray(result.talkingPoints) ? result.talkingPoints : [],
      closeTechnique: result.closeTechnique || '',
      closeScript: result.closeScript || '',
      whatsappMessage: result.whatsappMessage || '',
      techniques: Array.isArray(result.techniques) ? result.techniques : [],
      objectionHints: Array.isArray(result.objectionHints) ? result.objectionHints : [],
      source: result.source || 'rule',
      agentRunId: agentRunId || '',
      generatedAt: new Date(),
    };
    syncClientPipelineWithJourney(clientDoc);
    await clientDoc.save();
  }

  await logActivity({
    userId,
    clientId,
    clientName: context.client.name,
    type: 'note',
    content: `[Abordagem IA · ${mode}] ${result.closeTechnique || 'conversa'}: ${(result.approach || '').slice(0, 180)}`,
  });

  return {
    clientId,
    ...result,
    mode,
    agentRunId,
    cached: false,
    generatedAt: clientDoc?.conversationCoach?.generatedAt
      ? clientDoc.conversationCoach.generatedAt.toISOString()
      : new Date().toISOString(),
    pipelineStage: clientDoc?.pipelineStage || 'negotiation',
  };
}

async function approveJourneyPlan(userId, clientId) {
  const client = await Client.findOne({ _id: clientId, userId });
  if (!client) {
    const err = new Error('Cliente não encontrado');
    err.statusCode = 404;
    throw err;
  }
  if (!client.journeyPlan?.nodes?.length) {
    const err = new Error('Nenhum plano de jornada para aprovar. Qualifique o lead primeiro.');
    err.statusCode = 400;
    throw err;
  }

  client.journeyPlan.approvedAt = new Date();
  client.journeyPlan = normalizeJourneyPlanStages(client.journeyPlan);
  const current = getCurrentNode(client.journeyPlan);
  const stage = resolvePipelineStageForNode(current);
  if (stage) {
    client.pipelineStage = stage;
  }
  await client.save();

  await logActivity({
    userId,
    clientId: client._id,
    clientName: client.name,
    type: 'note',
    content: `Plano de jornada aprovado (${client.leadTemperature || client.journeyPlan.temperature})`,
  });

  return {
    clientId: client._id.toString(),
    leadTemperature: client.leadTemperature,
    journeyPlan: formatJourneyPlan(client.journeyPlan),
    pipelineStage: client.pipelineStage,
  };
}

async function advanceClientJourney(userId, clientId) {
  const client = await Client.findOne({ _id: clientId, userId });
  if (!client) {
    const err = new Error('Cliente não encontrado');
    err.statusCode = 404;
    throw err;
  }
  if (!client.journeyPlan?.nodes?.length) {
    const err = new Error('Nenhum plano de jornada. Qualifique o lead primeiro.');
    err.statusCode = 400;
    throw err;
  }
  if (!client.journeyPlan.approvedAt) {
    const err = new Error('Aprove o plano antes de avançar.');
    err.statusCode = 400;
    throw err;
  }

  const currentBefore = getCurrentNode(client.journeyPlan);

  // Nó requalify: re-qualifica e regenera plano (exige nova aprovação)
  if (currentBefore?.kind === 'requalify') {
    return qualifyClient(userId, clientId, { force: true });
  }

  const advanced = advancePlanNodes(client.journeyPlan);
  if (!advanced) {
    const err = new Error('Não foi possível avançar o plano.');
    err.statusCode = 400;
    throw err;
  }

  client.journeyPlan = normalizeJourneyPlanStages(advanced.plan);
  const current = advanced.currentNode || getCurrentNode(advanced.plan);
  const stage = resolvePipelineStageForNode(current);
  if (stage && stage !== 'won') {
    client.pipelineStage = stage;
  }
  // won só via venda/humano — não auto-setar won no advance do último nó antes de venda
  if (current?.kind === 'won' && current.status === 'current') {
    // mantém negotiation/proposal até registrar venda; stage canônico do nó won fica como alvo do CTA
    client.pipelineStage = client.pipelineStage === 'won' ? 'won' : (client.pipelineStage || 'negotiation');
  }

  await client.save();

  await logActivity({
    userId,
    clientId: client._id,
    clientName: client.name,
    type: 'stage_change',
    content: `Jornada: ${currentBefore?.label || '?'} → ${current?.label || 'fim'}`,
  });

  return {
    clientId: client._id.toString(),
    finished: advanced.finished,
    leadTemperature: client.leadTemperature,
    journeyPlan: formatJourneyPlan(client.journeyPlan),
    pipelineStage: client.pipelineStage,
    suggestedAction: current
      ? { nodeId: current.id, cta: current.cta, label: current.label }
      : null,
  };
}

/** Move manual: pula direto para um nó do plano e sincroniza o pipelineStage. */
async function moveClientJourneyToNode(userId, clientId, nodeId) {
  const client = await Client.findOne({ _id: clientId, userId });
  if (!client) {
    const err = new Error('Cliente não encontrado');
    err.statusCode = 404;
    throw err;
  }
  if (!client.journeyPlan?.nodes?.length) {
    const err = new Error('Nenhum plano de jornada. Qualifique o lead primeiro.');
    err.statusCode = 400;
    throw err;
  }
  if (!client.journeyPlan.approvedAt) {
    const err = new Error('Aprove o plano antes de mover o lead.');
    err.statusCode = 400;
    throw err;
  }

  const currentBefore = getCurrentNode(client.journeyPlan);
  const moved = moveJourneyPlanToNode(client.journeyPlan, nodeId);
  if (!moved) {
    const err = new Error('Etapa inválida para este plano.');
    err.statusCode = 400;
    throw err;
  }

  client.journeyPlan = normalizeJourneyPlanStages(moved.plan);
  const current = moved.currentNode;
  const stage = resolvePipelineStageForNode(current);
  if (stage) {
    // won só via registro de venda; mover para o nó "Venda" mantém o stage atual
    if (stage === 'won' && client.pipelineStage !== 'won') {
      client.pipelineStage = client.pipelineStage || 'negotiation';
    } else {
      client.pipelineStage = stage;
    }
  }
  await client.save();

  if (currentBefore?.id !== current?.id) {
    await logActivity({
      userId,
      clientId: client._id,
      clientName: client.name,
      type: 'stage_change',
      content: `Jornada (manual): ${currentBefore?.label || '?'} → ${current?.label || '?'}`,
    });
  }

  return {
    clientId: client._id.toString(),
    leadTemperature: client.leadTemperature,
    journeyPlan: formatJourneyPlan(client.journeyPlan),
    pipelineStage: client.pipelineStage,
    suggestedAction: current
      ? { nodeId: current.id, cta: current.cta, label: current.label }
      : null,
  };
}

function mapRuleItemToAction(userId, item) {
  return {
    userId,
    clientId: item.clientId,
    clientName: item.clientName || '',
    phone: item.phone || '',
    source: 'rule',
    type: item.type || 'follow_up',
    status: 'pending',
    priority: item.priority || 50,
    expectedValue: item.expectedValue || 0,
    expectedValueReason: item.expectedValueReason || '',
    lastVisitAt: item.lastVisitAt || null,
    lastProcedures: item.lastProcedures || [],
    salesSuggestion: item.salesSuggestion || '',
    salesSuggestionReason: item.salesSuggestionReason || '',
    reason: item.reason || '',
    suggestedAction: item.suggestedAction || '',
    suggestedMessage: item.suggestedMessage || '',
    href: item.href || `/jornada?clientId=${item.clientId}`,
  };
}

function formatBRL(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// Estima o valor potencial de uma ação com base fundamentada (não é chute):
// prioriza o ticket médio histórico do próprio cliente e, na ausência dele,
// usa o ticket médio da clínica. Sempre devolve o "porquê" do número.
function estimateExpectedValue({ clientTicket, clinicAvg }) {
  if (clientTicket && clientTicket.count > 0 && clientTicket.avg > 0) {
    const compras = `${clientTicket.count} compra${clientTicket.count === 1 ? '' : 's'}`;
    let reason = `Baseado no ticket médio deste cliente (R$ ${formatBRL(clientTicket.avg)} em ${compras}).`;

    if (clientTicket.lastValue > 0) {
      const itemsText = (clientTicket.lastItems || []).slice(0, 2).join(' + ');
      const dateText = clientTicket.lastSaleAt
        ? new Date(clientTicket.lastSaleAt).toLocaleDateString('pt-BR')
        : '';
      reason += ` Última compra: ${itemsText ? `${itemsText} · ` : ''}R$ ${formatBRL(clientTicket.lastValue)}${dateText ? ` em ${dateText}` : ''}.`;
    }

    return { value: Math.round(clientTicket.avg), reason };
  }
  if (clinicAvg > 0) {
    return {
      value: Math.round(clinicAvg),
      reason: `Baseado no ticket médio da clínica (R$ ${formatBRL(clinicAvg)}).`,
    };
  }
  return {
    value: 0,
    reason: 'Sem histórico de vendas suficiente para estimar o valor.',
  };
}

async function loadTicketSignals(userObjectId, clientIds) {
  const [perClientRows, clinicRows] = await Promise.all([
    clientIds.length
      ? Sale.aggregate([
          {
            $match: {
              userId: userObjectId,
              clientId: { $in: clientIds.map((id) => new mongoose.Types.ObjectId(id)) },
            },
          },
          { $sort: { createdAt: -1 } },
          {
            $group: {
              _id: '$clientId',
              avg: { $avg: '$netValue' },
              count: { $sum: 1 },
              lastValue: { $first: '$netValue' },
              lastSaleAt: { $first: '$createdAt' },
              lastItems: { $first: '$items' },
            },
          },
        ])
      : Promise.resolve([]),
    Sale.aggregate([
      { $match: { userId: userObjectId } },
      { $group: { _id: null, avg: { $avg: '$netValue' } } },
    ]),
  ]);

  const clientTicketMap = new Map(
    perClientRows.map((row) => [
      row._id.toString(),
      {
        avg: row.avg || 0,
        count: row.count || 0,
        lastValue: row.lastValue || 0,
        lastSaleAt: row.lastSaleAt || null,
        lastItems: (row.lastItems || [])
          .map((item) => item?.procedureName)
          .filter(Boolean),
      },
    ])
  );
  const clinicAvg = clinicRows[0]?.avg || 0;
  return { clientTicketMap, clinicAvg };
}

// Recalcula expectedValue/expectedValueReason de TODAS as ações pendentes.
// Garante que a soma "em risco" sempre bata com os valores exibidos por item
// (ações antigas podem ter valores gravados por fórmulas anteriores).
async function refreshExpectedValues(userObjectId, userId) {
  const pendingActions = await CommercialAction.find({
    userId: userObjectId,
    status: 'pending',
  })
    .select('clientId')
    .lean();

  if (!pendingActions.length) return;

  const clientIds = [...new Set(pendingActions.map((a) => a.clientId.toString()))];
  const { clientTicketMap, clinicAvg } = await loadTicketSignals(userObjectId, clientIds);

  const ops = pendingActions.map((action) => {
    const { value, reason } = estimateExpectedValue({
      clientTicket: clientTicketMap.get(action.clientId.toString()),
      clinicAvg,
    });
    return {
      updateOne: {
        filter: { _id: action._id },
        update: { $set: { expectedValue: value, expectedValueReason: reason } },
      },
    };
  });

  await CommercialAction.bulkWrite(ops, { ordered: false }).catch((err) => {
    console.warn('[commercialIntelligence] expected values skipped:', err.message);
  });
}

async function syncClosingQueueRules(userId, { ruleQueue = null } = {}) {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const now = new Date();
  const queue = ruleQueue
    || (await buildActionQueue(userId).catch(() => ({ items: [], dueReturnsCount: 0 })));
  const candidates = (queue.items || [])
    .slice(0, 40)
    .filter((item) => item.clientId);

  const clientIds = [...new Set(candidates.map((item) => item.clientId.toString()))];

  const [existingActions, clientDocs] = await Promise.all([
    CommercialAction.find({
      userId: userObjectId,
      type: {
        $in: ['stale_lead', 'group_d', 'form_followup', 'no_sales', 'due_return'],
      },
      status: { $in: ['pending', 'snoozed'] },
    }),
    Client.find({ _id: { $in: clientIds }, userId: userObjectId })
      .select('leadScore qualification')
      .lean(),
  ]);

  const existingMap = new Map(
    existingActions.map((a) => [`${a.clientId.toString()}:${a.type}`, a])
  );
  const clientMap = new Map(clientDocs.map((c) => [c._id.toString(), c]));

  const savePromises = [];
  const toCreate = [];

  for (const item of candidates) {
    const clientId = item.clientId.toString();
    const client = clientMap.get(clientId);
    const existing = existingMap.get(`${clientId}:${item.type}`);

    if (existing) {
      if (existing.status === 'snoozed' && existing.snoozedUntil && existing.snoozedUntil > now) {
        continue;
      }
      existing.priority = item.priority;
      existing.reason = item.reason;
      existing.suggestedAction = item.suggestedAction;
      existing.href = item.href || existing.href;
      existing.lastVisitAt = item.lastVisitAt || null;
      existing.lastProcedures = item.lastProcedures || [];
      existing.salesSuggestion = item.salesSuggestion || '';
      existing.salesSuggestionReason = item.salesSuggestionReason || '';
      if (existing.status === 'snoozed' && existing.snoozedUntil && existing.snoozedUntil <= now) {
        existing.status = 'pending';
        existing.snoozedUntil = null;
      }
      savePromises.push(existing.save());
    } else {
      toCreate.push({
        ...mapRuleItemToAction(userId, item),
        suggestedMessage: client?.qualification?.nextStep
          ? `Olá! Vi seu interesse e queria retomar: ${client.qualification.nextStep}`
          : '',
      });
    }
  }

  await Promise.all(savePromises);
  if (toCreate.length) {
    await CommercialAction.insertMany(toCreate, { ordered: false }).catch((err) => {
      console.warn('[commercialIntelligence] insert actions skipped:', err.message);
    });
  }

  // Remove ações que deixaram de ser verdadeiras. Ex.: cliente ainda marcado
  // manualmente no grupo D, mas com venda/visita recente.
  const currentKeys = new Set(
    candidates.map((item) => `${item.clientId.toString()}:${item.type}`)
  );
  const staleIds = existingActions
    .filter((action) => !currentKeys.has(`${action.clientId.toString()}:${action.type}`))
    .map((action) => action._id);
  if (staleIds.length) {
    await CommercialAction.updateMany(
      { _id: { $in: staleIds }, userId: userObjectId },
      {
        $set: {
          status: 'dismissed',
          completedAt: new Date(),
        },
      }
    );
  }

  await refreshExpectedValues(userObjectId, userId);
  return queue;
}

async function runClosingQueueAiRank(userId) {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  if (!agno.isAgnoEnabled()) {
    await aiDailyCache.saveDaily(userId, 'closing_rank', {
      payload: { rankedAt: new Date().toISOString(), count: 0 },
      source: 'rule',
      promptVersion: agno.PROMPT_VERSION,
    });
    return { source: 'rule' };
  }

  try {
    const pending = await CommercialAction.find({
      userId: userObjectId,
      status: 'pending',
    })
      .sort({ priority: -1 })
      .limit(50)
      .lean();

    const agnoResult = await agno.rankClosingQueue({
      userId,
      candidates: pending.map((a) => ({
        id: a._id.toString(),
        clientId: a.clientId.toString(),
        clientName: a.clientName,
        type: a.type,
        priority: a.priority,
        reason: a.reason,
        suggestedAction: a.suggestedAction,
        expectedValue: a.expectedValue,
      })),
    });

    const ranked = agnoResult?.data?.items || [];
    const rankOps = ranked
      .filter((row) => row.id)
      .map((row) => ({
        updateOne: {
          filter: { _id: row.id, userId: userObjectId },
          update: {
            $set: {
              ...(row.priority != null ? { priority: row.priority } : {}),
              ...(row.whyNow || row.reason
                ? { reason: row.whyNow || row.reason }
                : {}),
              ...(row.suggestedMessage
                ? { suggestedMessage: row.suggestedMessage }
                : {}),
              ...(row.suggestedAction
                ? { suggestedAction: row.suggestedAction }
                : {}),
              source: 'agent',
              agentRunId: agnoResult.runId || '',
              agentName: 'ClosingQueueAgent',
              promptVersion: agno.PROMPT_VERSION,
            },
          },
        },
      }));
    if (rankOps.length) {
      await CommercialAction.bulkWrite(rankOps, { ordered: false });
    }

    await aiDailyCache.saveDaily(userId, 'closing_rank', {
      payload: {
        rankedAt: new Date().toISOString(),
        count: ranked.length,
        runId: agnoResult.runId || '',
      },
      source: 'agent',
      promptVersion: agno.PROMPT_VERSION,
    });
    return { source: 'agent', count: ranked.length };
  } catch (error) {
    console.warn('[commercialIntelligence] closing-queue fallback:', error.message);
    await aiDailyCache.clearLease(userId, 'closing_rank');
    return { source: 'rule', error: error.message };
  }
}

/**
 * refresh: sincroniza regras + valores (sem LLM).
 * runAiRank: só deve ser true no job diário (primeira abertura do dia).
 */
async function buildClosingQueue(userId, {
  refresh = false,
  ruleQueue = null,
  runAiRank = false,
} = {}) {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const now = new Date();
  let queue = ruleQueue;

  if (refresh) {
    queue = await syncClosingQueueRules(userId, { ruleQueue });
  }

  if (runAiRank) {
    const claim = await aiDailyCache.claimOrGet(userId, 'closing_rank');
    if (claim.shouldCompute) {
      await runClosingQueueAiRank(userId);
    }
  }

  const items = await CommercialAction.find({
    userId: userObjectId,
    status: 'pending',
    $or: [{ snoozedUntil: null }, { snoozedUntil: { $lte: now } }],
  })
    .sort({ priority: -1, expectedValue: -1, createdAt: -1 })
    .limit(50)
    .lean();

  // Uma cliente = uma oportunidade (evita contar o mesmo ticket duas vezes).
  const uniqueClientItems = [];
  const seenClients = new Set();
  for (const item of items) {
    const clientKey = item.clientId?.toString();
    if (!clientKey || seenClients.has(clientKey)) continue;
    seenClients.add(clientKey);
    uniqueClientItems.push(item);
  }

  const formatted = uniqueClientItems.map(formatCommercialAction);

  return {
    items: formatted,
    count: formatted.length,
    totalExpectedValue: formatted.reduce(
      (sum, item) => sum + (item.expectedValue || 0),
      0
    ),
    dueReturnsCount: queue?.dueReturnsCount ?? 0,
  };
}

/**
 * Job diário: ranking + diretor + upsells. Só roda kinds ainda sem cache do dia.
 * Pensado para setImmediate após a resposta HTTP.
 */
async function runDailyAiAnalyses(userId, {
  todayEvents = [],
  directorFacts = null,
} = {}) {
  const jobs = [];

  const closingClaim = await aiDailyCache.claimOrGet(userId, 'closing_rank');
  if (closingClaim.shouldCompute) {
    jobs.push(
      syncClosingQueueRules(userId)
        .then(() => runClosingQueueAiRank(userId))
        .catch((err) => {
          console.warn('[dailyAi] closing_rank failed:', err.message);
          return aiDailyCache.clearLease(userId, 'closing_rank');
        })
    );
  }

  const directorClaim = await aiDailyCache.claimOrGet(userId, 'director');
  if (directorClaim.shouldCompute && directorFacts) {
    jobs.push(
      buildDirectorBriefing(userId, directorFacts, { skipCache: true })
        .then((result) => aiDailyCache.saveDaily(userId, 'director', {
          payload: result,
          source: result?.source || 'rule',
          promptVersion: result?.promptVersion || agno.PROMPT_VERSION,
        }))
        .catch((err) => {
          console.warn('[dailyAi] director failed:', err.message);
          return aiDailyCache.clearLease(userId, 'director');
        })
    );
  }

  const upsellsClaim = await aiDailyCache.claimOrGet(userId, 'upsells');
  if (upsellsClaim.shouldCompute && todayEvents.length) {
    jobs.push(
      (async () => {
        const { buildAppointmentUpsells } = require('./appointmentUpsell.service');
        const items = await buildAppointmentUpsells(userId, todayEvents, {
          skipCache: true,
          useAi: true,
        });
        await aiDailyCache.saveDaily(userId, 'upsells', {
          payload: { items, eventIds: todayEvents.map((e) => e.id) },
          source: items.some((i) => i.source === 'agent') ? 'agent' : 'rule',
          promptVersion: agno.PROMPT_VERSION,
        });
      })().catch((err) => {
        console.warn('[dailyAi] upsells failed:', err.message);
        return aiDailyCache.clearLease(userId, 'upsells');
      })
    );
  } else if (upsellsClaim.shouldCompute && !todayEvents.length) {
    await aiDailyCache.saveDaily(userId, 'upsells', {
      payload: { items: [], eventIds: [] },
      source: 'rule',
      promptVersion: agno.PROMPT_VERSION,
    });
  }

  await Promise.all(jobs);
}

function formatCommercialAction(doc) {
  const obj = doc.toObject ? doc.toObject() : doc;
  return {
    id: obj._id.toString(),
    clientId: obj.clientId?.toString?.() || obj.clientId,
    clientName: obj.clientName || '',
    phone: obj.phone || '',
    source: obj.source,
    type: obj.type,
    status: obj.status,
    priority: obj.priority,
    expectedValue: obj.expectedValue || 0,
    expectedValueReason: obj.expectedValueReason || '',
    lastVisitAt: obj.lastVisitAt || null,
    lastProcedures: obj.lastProcedures || [],
    salesSuggestion: obj.salesSuggestion || '',
    salesSuggestionReason: obj.salesSuggestionReason || '',
    reason: obj.reason || '',
    suggestedAction: obj.suggestedAction || '',
    suggestedMessage: obj.suggestedMessage || '',
    href: obj.href || '',
    agentRunId: obj.agentRunId || '',
    agentName: obj.agentName || '',
    promptVersion: obj.promptVersion || '',
    feedback: obj.feedback,
    outcome: obj.outcome,
    realizedRevenue: obj.realizedRevenue || 0,
    snoozedUntil: obj.snoozedUntil,
    completedAt: obj.completedAt,
    recommendationId: obj.recommendationId || '',
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

async function updateCommercialAction(userId, actionId, patch) {
  const action = await CommercialAction.findOne({
    _id: actionId,
    userId,
  });
  if (!action) {
    const err = new Error('Ação não encontrada');
    err.statusCode = 404;
    throw err;
  }

  const {
    status,
    snoozedUntil,
    outcome,
    realizedRevenue,
    feedback,
    editedPayload,
    suggestedMessage,
    suggestedAction,
  } = patch;

  if (status) action.status = status;
  if (snoozedUntil !== undefined) action.snoozedUntil = snoozedUntil ? new Date(snoozedUntil) : null;
  if (outcome !== undefined) action.outcome = outcome;
  if (realizedRevenue !== undefined) action.realizedRevenue = realizedRevenue;
  if (feedback !== undefined) action.feedback = feedback;
  if (editedPayload !== undefined) action.editedPayload = editedPayload;
  if (suggestedMessage !== undefined) action.suggestedMessage = suggestedMessage;
  if (suggestedAction !== undefined) action.suggestedAction = suggestedAction;

  if (status === 'done' || status === 'dismissed') {
    action.completedAt = new Date();
  }
  if (status === 'snoozed' && !action.snoozedUntil) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    action.snoozedUntil = d;
  }

  await action.save();

  if (outcome) {
    await logActivity({
      userId,
      clientId: action.clientId,
      clientName: action.clientName,
      type: 'action_outcome',
      content: `Outcome ${outcome}${realizedRevenue ? ` · R$ ${realizedRevenue}` : ''}: ${action.suggestedAction}`,
    });
  }

  return formatCommercialAction(action);
}

function buildDirectorNarrative(facts) {
  const parts = [];
  const queueCount = facts.queueCount || 0;
  const risk = Number(facts.revenueAtRisk || 0);

  if (queueCount > 0) {
    parts.push(
      `Você tem ${queueCount} ${queueCount === 1 ? 'contato prioritário' : 'contatos prioritários'} para trabalhar hoje` +
        (risk > 0 ? `, somando cerca de R$ ${formatBRL(risk)} em receita potencial.` : '.')
    );
  } else {
    parts.push('A fila comercial está limpa — nenhum contato prioritário pendente.');
  }

  if (facts.todaySalesCount > 0) {
    parts.push(
      `Hoje já foram ${facts.todaySalesCount} venda${facts.todaySalesCount === 1 ? '' : 's'}, ` +
        `com caixa líquido de R$ ${formatBRL(facts.todayNet || 0)}.`
    );
  } else {
    parts.push('Ainda não há vendas registradas hoje; priorize os contatos de maior valor.');
  }

  if (facts.dueReturnsCount > 0) {
    parts.push(
      `${facts.dueReturnsCount} retorno${facts.dueReturnsCount === 1 ? '' : 's'} ` +
        `${facts.dueReturnsCount === 1 ? 'está' : 'estão'} no prazo de reagendamento.`
    );
  }

  return parts.join(' ');
}

async function buildDirectorBriefing(userId, facts, { skipCache = false } = {}) {
  if (!skipCache) {
    const cached = await aiDailyCache.getDaily(userId, 'director');
    if (cached?.payload) {
      return { ...cached.payload, fromCache: true };
    }
  }

  let result = {
    narrative: buildDirectorNarrative(facts),
    anomalies: facts.anomalies || [],
    ownerActions: (facts.topActions || []).slice(0, 3).map((a) => ({
      title: a.clientName
        ? `${a.suggestedAction || 'Contato'} — ${a.clientName}`
        : a.suggestedAction || a.reason,
      clientId: a.clientId,
      expectedValue: a.expectedValue || 0,
      why: a.expectedValueReason
        ? `${a.reason} · ${a.expectedValueReason}`
        : a.reason,
    })),
    revenueAtRisk: facts.revenueAtRisk || 0,
    source: 'rule',
    promptVersion: agno.PROMPT_VERSION,
  };

  if (agno.isAgnoEnabled()) {
    try {
      const agnoResult = await agno.commercialDirector({ userId, facts });
      if (agnoResult?.data) {
        const ownerActions = Array.isArray(agnoResult.data.ownerActions)
          && agnoResult.data.ownerActions.length
          ? agnoResult.data.ownerActions
          : result.ownerActions;
        result = { ...result, ...agnoResult.data, ownerActions, source: 'agent' };
      }
    } catch (error) {
      console.warn('[commercialIntelligence] director fallback:', error.message);
    }
  }

  return result;
}

async function prepareLeadBundle(userId, clientId) {
  const qualification = await qualifyClient(userId, clientId, { force: true });
  const offer = await suggestOffer(userId, clientId);
  await buildClosingQueue(userId, { refresh: true });

  if (agno.isAgnoEnabled()) {
    try {
      await agno.prepareLead({ userId, clientId, qualification, offer });
    } catch {
      // workflow opcional
    }
  }

  return { qualification, offer };
}

module.exports = {
  maskPhone,
  loadClientContext,
  qualifyClient,
  suggestOffer,
  suggestObjectionScript,
  suggestConversationCoach,
  approveJourneyPlan,
  advanceClientJourney,
  moveClientJourneyToNode,
  buildClosingQueue,
  syncClosingQueueRules,
  runClosingQueueAiRank,
  runDailyAiAnalyses,
  updateCommercialAction,
  formatCommercialAction,
  buildDirectorBriefing,
  prepareLeadBundle,
};
