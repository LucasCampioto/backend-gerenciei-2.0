/** Temperatura e templates de jornada comercial por lead. */

const TEMPERATURES = ['frio', 'morno', 'quente'];

function scoreToTemperature(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'frio';
  if (n >= 70) return 'quente';
  if (n >= 45) return 'morno';
  return 'frio';
}

function node(id, label, kind, pipelineStage, cta, status = 'pending') {
  return { id, label, kind, pipelineStage, cta, status };
}

function fixedPrefix() {
  return [
    node('lead', 'Lead entra', 'lead', 'new', 'none', 'done'),
    node('qualify', 'Qualifica', 'qualify', 'qualified', 'qualify', 'done'),
  ];
}

function templateAfterQualify(temperature) {
  if (temperature === 'quente') {
    return [
      node('offer', 'Oferta + preço', 'offer', 'proposal', 'generate_offer'),
      node('close', 'Fechamento', 'close', 'negotiation', 'conversation_close'),
      node('won', 'Venda', 'won', 'won', 'register_sale'),
    ];
  }
  if (temperature === 'morno') {
    return [
      node('offer', 'Oferta / completar gaps', 'offer', 'proposal', 'generate_offer'),
      node('close', 'Fechamento', 'close', 'negotiation', 'conversation_close'),
      node('won', 'Venda', 'won', 'won', 'register_sale'),
    ];
  }
  // frio — Descoberta ainda é Qualifica no funil da clínica (não Oferta/Conversa)
  return [
    node('discovery', 'Descoberta', 'discovery', 'qualified', 'whatsapp_discovery'),
    node('requalify', 'Re-qualifica', 'requalify', 'qualified', 'qualify'),
    node('offer', 'Oferta + preço', 'offer', 'proposal', 'generate_offer'),
    node('close', 'Fechamento', 'close', 'negotiation', 'conversation_close'),
    node('won', 'Venda', 'won', 'won', 'register_sale'),
  ];
}

function reasonForPlan(temperature, qualification = {}) {
  const missing = Array.isArray(qualification.missingQuestions)
    ? qualification.missingQuestions.length
    : 0;
  if (temperature === 'quente') {
    return 'Lead quente: ir direto para oferta e fechamento.';
  }
  if (temperature === 'morno') {
    return missing > 0
      ? `Lead morno: oferta leve e fechar as ${missing} lacuna(s) restantes.`
      : 'Lead morno: oferta alinhada e fechamento consultivo.';
  }
  return missing > 0
    ? `Lead frio: descobrir necessidade (${missing} pergunta(s)) antes de ofertar.`
    : 'Lead frio: descobrir necessidade antes de montar oferta.';
}

/**
 * Monta plano completo. Nós fixos (lead+qualify) ficam done;
 * primeiro nó pós-qualifica = current; approvedAt sempre null na geração.
 */
function buildJourneyPlan({ temperature, qualification = {}, agentRunId = '' } = {}) {
  const temp = TEMPERATURES.includes(temperature)
    ? temperature
    : scoreToTemperature(qualification.score);
  const prefix = fixedPrefix();
  const rest = templateAfterQualify(temp);
  if (rest.length) {
    rest[0].status = 'current';
  }
  const nodes = [...prefix, ...rest];
  const current = rest[0] || prefix[prefix.length - 1];

  return {
    temperature: temp,
    approvedAt: null,
    currentNodeId: current?.id || 'qualify',
    nodes,
    reason: reasonForPlan(temp, qualification),
    generatedAt: new Date(),
    agentRunId: agentRunId || '',
  };
}

function formatJourneyPlan(plan) {
  const normalized = normalizeJourneyPlanStages(plan);
  if (!normalized || !Array.isArray(normalized.nodes) || !normalized.nodes.length) return null;
  return {
    temperature: normalized.temperature || null,
    approvedAt: normalized.approvedAt
      ? (normalized.approvedAt instanceof Date ? normalized.approvedAt.toISOString() : normalized.approvedAt)
      : null,
    currentNodeId: normalized.currentNodeId || '',
    nodes: normalized.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      kind: n.kind,
      pipelineStage: resolvePipelineStageForNode(n) || n.pipelineStage,
      cta: n.cta,
      status: n.status || 'pending',
    })),
    reason: normalized.reason || '',
    generatedAt: normalized.generatedAt
      ? (normalized.generatedAt instanceof Date ? normalized.generatedAt.toISOString() : normalized.generatedAt)
      : null,
    agentRunId: normalized.agentRunId || '',
  };
}

function getCurrentNode(plan) {
  if (!plan?.nodes?.length) return null;
  const byStatus = plan.nodes.find((n) => n.status === 'current');
  if (byStatus) return byStatus;
  if (plan.currentNodeId) {
    return plan.nodes.find((n) => n.id === plan.currentNodeId) || null;
  }
  return null;
}

/**
 * Stage canônico do funil da clínica para um nó da jornada.
 * Descoberta/re-qualifica ficam em "qualified" (Qualifica) —
 * não em negotiation (que o Funil agrupa como Oferta).
 */
function resolvePipelineStageForNode(node) {
  if (!node) return null;
  if (node.kind === 'discovery' || node.kind === 'requalify') return 'qualified';
  return node.pipelineStage || null;
}

/** Corrige planos antigos que mapearam discovery → negotiation. */
function normalizeJourneyPlanStages(plan) {
  if (!plan || !Array.isArray(plan.nodes)) return plan;
  let changed = false;
  const nodes = plan.nodes.map((n) => {
    if (n?.kind === 'discovery' && n.pipelineStage !== 'qualified') {
      changed = true;
      return { ...(typeof n.toObject === 'function' ? n.toObject() : n), pipelineStage: 'qualified' };
    }
    return n;
  });
  if (!changed) return plan;
  return { ...(typeof plan.toObject === 'function' ? plan.toObject() : plan), nodes };
}

/**
 * Alinha pipelineStage do cliente ao nó atual da jornada.
 * Retorna true se alterou algo (caller deve save).
 */
function syncClientPipelineWithJourney(client) {
  if (!client?.journeyPlan?.nodes?.length) return false;
  const normalized = normalizeJourneyPlanStages(client.journeyPlan);
  let changed = false;
  if (normalized !== client.journeyPlan) {
    client.journeyPlan = normalized;
    changed = true;
  }

  if (!client.journeyPlan.approvedAt) return changed;
  if (client.pipelineStage === 'won' || client.pipelineStage === 'lost') return changed;

  const current = getCurrentNode(client.journeyPlan);
  const expected = resolvePipelineStageForNode(current);
  if (!expected || expected === 'won') return changed;

  // Corrige discovery/requalify que caíram em negotiation (Oferta no Funil)
  if (
    (current.kind === 'discovery' || current.kind === 'requalify') &&
    client.pipelineStage !== expected
  ) {
    client.pipelineStage = expected;
    changed = true;
  }
  return changed;
}

/**
 * Avança o nó atual → done e o próximo → current.
 * Retorna { plan, finished } ou null se não houver plano.
 */
function advanceJourneyPlan(plan) {
  if (!plan?.nodes?.length) return null;
  const nodes = plan.nodes.map((n) => ({ ...n }));
  const idx = nodes.findIndex((n) => n.status === 'current' || n.id === plan.currentNodeId);
  if (idx < 0) return { plan: { ...plan, nodes }, finished: false };

  nodes[idx] = { ...nodes[idx], status: 'done' };
  const nextIdx = idx + 1;
  let currentNodeId = nodes[idx].id;
  let finished = false;

  if (nextIdx < nodes.length) {
    nodes[nextIdx] = { ...nodes[nextIdx], status: 'current' };
    currentNodeId = nodes[nextIdx].id;
  } else {
    finished = true;
  }

  return {
    plan: {
      ...plan,
      nodes,
      currentNodeId,
    },
    finished,
    currentNode: nodes.find((n) => n.id === currentNodeId) || nodes[idx],
  };
}

/**
 * Move o plano direto para um nó específico: anteriores → done,
 * alvo → current, posteriores → pending. Retorna null se nó não existir.
 */
function moveJourneyPlanToNode(plan, nodeId) {
  if (!plan?.nodes?.length) return null;
  const idx = plan.nodes.findIndex((n) => n.id === nodeId);
  if (idx < 0) return null;

  const nodes = plan.nodes.map((n, i) => ({
    ...n,
    status: i < idx ? 'done' : i === idx ? 'current' : 'pending',
  }));

  return {
    plan: { ...plan, nodes, currentNodeId: nodes[idx].id },
    currentNode: nodes[idx],
  };
}

module.exports = {
  TEMPERATURES,
  scoreToTemperature,
  buildJourneyPlan,
  formatJourneyPlan,
  getCurrentNode,
  resolvePipelineStageForNode,
  normalizeJourneyPlanStages,
  syncClientPipelineWithJourney,
  advanceJourneyPlan,
  moveJourneyPlanToNode,
  reasonForPlan,
};
