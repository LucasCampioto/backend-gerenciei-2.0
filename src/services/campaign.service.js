const crypto = require('crypto');
const Campaign = require('../models/Campaign');
const CampaignLead = require('../models/CampaignLead');
const Client = require('../models/Client');
const User = require('../models/User');
const Procedure = require('../models/Procedure');
const {
  isAgnoEnabled,
  generateCampaign,
  generateQuizCampaign,
  generateMagnetCampaign,
  suggestCampaignThemes: agnoSuggestThemes,
  personalizeDiagnosisLaudo: agnoPersonalizeDiagnosisLaudo,
  healthCheck,
} = require('./agno.client');
const { buildEbookPdfBuffer } = require('./ebookPdf.service');
const {
  normalizeLeadMagnetType,
  isFunnelMagnet,
  needsPdf,
  contentIsComplete,
  heuristicMagnetContent,
  checklistToEbookPdfShape,
  proceduresForTopic,
} = require('./campaignMagnets');
const {
  isR2Configured,
  putObject,
  resolveReadUrl,
} = require('./simulation/r2Storage');
const { findClientByPhone, isValidBrazilianPhone, stripPhoneDigits } = require('../utils/phoneMatch');
const { logActivity } = require('./clientActivity.service');
const {
  normalizeDiagnosisVariant,
  createUploadToken,
  resolveLeadImageUrls,
} = require('./campaignDiagnosisSimulation');

function generatePublicSlug() {
  return crypto.randomBytes(9).toString('base64url').slice(0, 12);
}

const DIAGNOSIS_BAD_TITLE_RE =
  /desmistificando|mitos?\s*e\s*verdades|guia completo|benef[ií]cios|cuidados|^o poder d|mantenha-se|quando fazer|como se formam|educat|tudo sobre|saiba tudo|descubra os benef/i;
const DIAGNOSIS_GOOD_TITLE_RE =
  /diagn[oó]stico|perfil|qual o seu|qual seu|laudo|voc[eê] est[aá]|o que pesa|candidata|momento de|descubra se|descubra seu|mapa do seu|seu caso|qual trava|pronta para|faz sentido|medo de|investimento|parcel|naturalidade|primeira vez|manuten/i;

/** Títulos que a IA copia demais dos exemplos — preferimos ângulos novos. */
const DIAGNOSIS_CLICHE_TITLE_RE =
  /qual seu perfil com|iniciar,?\s*manter ou|o que pesa mais no seu caso/i;

const DIAGNOSIS_ANGLE_POOL = [
  {
    id: 'artificial',
    hint: 'medo de ficar artificial / parecer marcado',
    titleHint: 'Medo de ficar artificial com {t}? Descubra seu perfil',
  },
  {
    id: 'budget',
    hint: 'quer fazer mas trava no investimento / parcelamento',
    titleHint: 'Diagnóstico: {t} cabe no seu momento financeiro?',
  },
  {
    id: 'timing',
    hint: 'evento, viagem ou data que aperta o timing',
    titleHint: 'Você está no momento certo para {t}?',
  },
  {
    id: 'first_vs_maintain',
    hint: 'primeira vez vs manutenção/retoque',
    titleHint: 'Laudo: primeira {t} ou só manutenção?',
  },
  {
    id: 'symptom',
    hint: 'prioridade do incômodo (linhas, cansaço, expressão, papada…)',
    titleHint: 'O que te incomoda mais agora — e o que o laudo sugere?',
  },
  {
    id: 'readiness',
    hint: 'pronta para decidir vs só pesquisando',
    titleHint: 'Você está pronta para {t} ou ainda só mapeando?',
  },
  {
    id: 'blocker',
    hint: 'trava principal (medo, preço, informação, timing)',
    titleHint: 'Qual trava te impede de decidir sobre {t}?',
  },
  {
    id: 'fit',
    hint: 'faz sentido para o perfil / expectativa dela',
    titleHint: 'Descubra se {t} faz sentido para o seu caso',
  },
];

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickDiagnosisAngles(count = 4) {
  return shuffleInPlace([...DIAGNOSIS_ANGLE_POOL]).slice(0, count);
}

function normalizeThemeKey(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titlesTooSimilar(a, b) {
  const na = normalizeThemeKey(a).split(' ').filter((w) => w.length > 3);
  const nb = normalizeThemeKey(b).split(' ').filter((w) => w.length > 3);
  if (!na.length || !nb.length) return false;
  const setB = new Set(nb);
  const overlap = na.filter((w) => setB.has(w)).length;
  const ratio = overlap / Math.min(na.length, nb.length);
  return ratio >= 0.55;
}

function isDiagnosisThemeTitleOk(title) {
  const t = String(title || '').trim();
  if (!t) return false;
  if (DIAGNOSIS_BAD_TITLE_RE.test(t)) return false;
  return DIAGNOSIS_GOOD_TITLE_RE.test(t);
}

function isDiagnosisThemePromiseOk(promise) {
  const p = String(promise || '').toLowerCase();
  if (!p) return true;
  if (/ebook|guia completo|pdf|cap[ií]tulo|ler o material/.test(p)) return false;
  return /laudo|perfil|perguntas|diagn[oó]stico|pr[oó]ximo passo|1 minuto|resultado/.test(p);
}

function isDiagnosisThemeCliché(title) {
  return DIAGNOSIS_CLICHE_TITLE_RE.test(String(title || ''));
}

function heuristicDiagnosisThemes(topic, diagnosisVariant = 'laudo', angles = null) {
  const t = String(topic || 'toxina botulínica').trim() || 'toxina botulínica';
  const sim =
    diagnosisVariant === 'simulation'
      ? ' No final você envia uma selfie; a clínica revela o antes/depois no WhatsApp.'
      : '';
  const baseScores = (intent, impact) => ({
    icpFit: 4,
    specificity: 4,
    intent,
    distribution: 4,
    commercialImpact: impact,
  });

  const byId = {
    artificial: {
      title: `Medo de ficar artificial com ${t}? Descubra seu perfil`,
      description: `Diagnóstico do medo de resultado marcado: perguntas + laudo + próximo passo.${sim}`,
      pain: 'Receio de parecer artificial ou “não ser eu”',
      promise: 'Laudo do seu perfil de naturalidade + conversa alinhada',
      conversionReason: 'Abre WhatsApp já falando de expectativa, não só de preço',
      adHook: `Medo de ficar artificial com ${t}? Faça o diagnóstico`,
      scores: baseScores(5, 5),
    },
    budget: {
      title: `Diagnóstico: ${t} cabe no seu momento financeiro?`,
      description: `Laudo de fit com investimento: vontade × realidade × caminhos possíveis.${sim}`,
      pain: 'Quer fazer, mas trava no dinheiro ou no “será que cabe?”',
      promise: 'Laudo do seu momento financeiro + formas de facilitar a conversa',
      conversionReason: 'Qualifica orçamento sem constranger e sugere caminho enxuto',
      adHook: `${t} cabe no seu momento? Descubra no laudo`,
      scores: baseScores(5, 5),
    },
    timing: {
      title: `Você está no momento certo para ${t}?`,
      description: `Laudo de timing: evento, urgência ou só mapa.${sim}`,
      pain: 'Medo de decidir cedo demais ou de adiar sem necessidade',
      promise: 'Laudo do seu momento + recomendação de conversa',
      conversionReason: 'Segmenta intenção por timing, não por curiosidade',
      adHook: `É o momento certo para ${t}? Faça o diagnóstico`,
      scores: baseScores(5, 4),
    },
    first_vs_maintain: {
      title: `Laudo: primeira ${t} ou só manutenção?`,
      description: `Diagnóstico de jornada: começar do zero ou manter resultado.${sim}`,
      pain: 'Não sabe se é início ou continuidade',
      promise: 'Laudo da sua etapa + próximo passo claro',
      conversionReason: 'Personaliza a conversa (iniciante vs manutenção)',
      adHook: `Primeira ${t} ou manutenção? Descubra no laudo`,
      scores: baseScores(4, 4),
    },
    symptom: {
      title: `O que te incomoda mais agora — e o que o laudo aponta?`,
      description: `Diagnóstico de prioridade do incômodo + laudo direcionado.${sim}`,
      pain: 'Vários incômodos e nenhuma prioridade clara',
      promise: 'Laudo do seu foco principal + caminho sugerido',
      conversionReason: 'Evita oferta genérica e aquece a conversa',
      adHook: 'O que te incomoda mais agora? Faça o diagnóstico',
      scores: baseScores(4, 5),
    },
    readiness: {
      title: `Você está pronta para ${t} ou ainda só mapeando?`,
      description: `Laudo de prontidão: intenção, urgência e expectativa.${sim}`,
      pain: 'Pressão de decidir sem clareza',
      promise: 'Laudo de prontidão + recomendação de conversa',
      conversionReason: 'Qualifica temperatura do lead antes do atendimento',
      adHook: `Pronta para ${t} ou só mapeando?`,
      scores: baseScores(5, 4),
    },
    blocker: {
      title: `Qual trava te impede de decidir sobre ${t}?`,
      description: `Laudo de objeção: medo, preço, timing ou informação.${sim}`,
      pain: 'Travada por medo ou informação demais',
      promise: 'Laudo da sua trava principal + próximo passo leve',
      conversionReason: 'WhatsApp já chega com a objeção nomeada',
      adHook: `Qual trava te impede de decidir sobre ${t}?`,
      scores: baseScores(5, 5),
    },
    fit: {
      title: `Descubra se ${t} faz sentido para o seu caso`,
      description: `Laudo de candidatura: fit, expectativa e urgência.${sim}`,
      pain: 'Dúvida se “é para mim” ou se ainda é cedo',
      promise: 'Laudo de fit + clareza do próximo passo',
      conversionReason: 'Filtra curiosos e aquece quem tem intenção',
      adHook: `${t} faz sentido para você agora?`,
      scores: baseScores(4, 5),
    },
  };

  const chosen = (angles && angles.length ? angles : pickDiagnosisAngles(3)).map((a) => a.id || a);
  const ids = chosen.map((c) => (typeof c === 'string' ? c : c.id)).filter((id) => byId[id]);
  const pickIds = ids.length >= 3 ? ids.slice(0, 3) : pickDiagnosisAngles(3).map((a) => a.id);

  return pickIds.map((id) => {
    const item = byId[id];
    return {
      ...item,
      targetAudience: `Pessoas pesquisando ${t}`,
      beliefToChange: 'Só dá para avançar com consulta presencial',
      leadMagnetType: 'diagnosis',
    };
  });
}

/** Reescreve um tema da IA para formato laudo, preservando dor/ângulo. */
function rewriteThemeAsDiagnosis(theme, topic, diagnosisVariant = 'laudo', angleHint = null) {
  const t = String(topic || theme?.title || 'estética').trim() || 'estética';
  const pain = String(theme?.pain || '').trim();
  const angle = String(theme?.conversionReason || theme?.description || '').trim();
  const sim =
    diagnosisVariant === 'simulation'
      ? ' Inclui selfie no final; a clínica revela o antes/depois no WhatsApp.'
      : '';

  let title = String(theme?.title || '').trim();
  const needsRewrite = !isDiagnosisThemeTitleOk(title) || isDiagnosisThemeCliché(title);
  if (needsRewrite) {
    if (angleHint?.titleHint) {
      title = String(angleHint.titleHint).replace(/\{t\}/g, t);
    } else if (pain) {
      const shortPain = pain.length > 64 ? `${pain.slice(0, 61)}…` : pain;
      title = `Diagnóstico: ${shortPain}`;
      if (!/[?？]$/.test(title)) title = `${title.replace(/[.!]+$/, '')}?`;
    } else {
      title = `Descubra se ${t} faz sentido para o seu caso`;
    }
  }

  return {
    ...theme,
    title,
    description:
      String(theme?.description || '').trim() ||
      `Diagnóstico com laudo personalizado sobre ${t}.${sim}`,
    promise: isDiagnosisThemePromiseOk(theme?.promise)
      ? theme.promise
      : `Laudo personalizado + próximo passo claro sobre ${t}`,
    conversionReason:
      angle ||
      'Leva a paciente ao WhatsApp já com perfil e contexto, não só curiosidade',
    adHook:
      String(theme?.adHook || '').trim() ||
      `Faça o diagnóstico de ${t} em 1 minuto e receba seu laudo`,
    leadMagnetType: 'diagnosis',
    scores: theme?.scores || {
      icpFit: 4,
      specificity: 4,
      intent: 4,
      distribution: 4,
      commercialImpact: 4,
    },
  };
}

function filterDiagnosisThemes(themes, topic, diagnosisVariant, angles = null) {
  const list = Array.isArray(themes) ? themes : [];
  const angleList = angles && angles.length ? angles : pickDiagnosisAngles(4);

  const scored = list.map((th, i) => {
    const titleOk = isDiagnosisThemeTitleOk(th?.title);
    const promiseOk = isDiagnosisThemePromiseOk(th?.promise);
    const cliche = isDiagnosisThemeCliché(th?.title);
    return { th, i, titleOk, promiseOk, cliche, fresh: titleOk && promiseOk && !cliche };
  });

  const fresh = scored.filter((s) => s.fresh).map((s) => ({ ...s.th, leadMagnetType: 'diagnosis' }));
  const okButCliche = scored
    .filter((s) => s.titleOk && s.promiseOk && s.cliche)
    .map((s, idx) =>
      rewriteThemeAsDiagnosis(s.th, topic, diagnosisVariant, angleList[idx % angleList.length])
    );

  const rewritten = scored
    .filter((s) => !s.titleOk || !s.promiseOk)
    .map((s, idx) =>
      rewriteThemeAsDiagnosis(s.th, topic, diagnosisVariant, angleList[idx % angleList.length])
    )
    .filter((th) => isDiagnosisThemeTitleOk(th.title));

  const merged = [];
  const pushUnique = (th) => {
    const key = normalizeThemeKey(th.title);
    if (!key) return false;
    if (merged.some((m) => titlesTooSimilar(m.title, th.title))) return false;
    merged.push({ ...th, leadMagnetType: 'diagnosis' });
    return true;
  };

  for (const th of [...fresh, ...rewritten, ...okButCliche]) {
    pushUnique(th);
    if (merged.length >= 5) break;
  }

  if (merged.length >= 3) {
    console.warn(
      `[campaign] diagnosis themes: ${fresh.length} fresh + rewrites → ${merged.length} unique`
    );
    return merged.slice(0, 5);
  }

  console.warn(
    `[campaign] diagnosis themes insufficient after rewrite (${merged.length}) — mixing heuristics`
  );
  const heuristics = heuristicDiagnosisThemes(topic, diagnosisVariant, angleList);
  for (const th of heuristics) {
    pushUnique(th);
    if (merged.length >= 3) break;
  }
  return merged.slice(0, 5);
}

const CALCULATOR_BAD_THEME_RE =
  /laudo|diagn[oó]stico|selfie|antes\s*\/?\s*depois|simula(ç|c)[aã]o|perfil de pele|qual seu perfil|o que pesa mais|mitos?\s*e\s*verdades|guia completo|benef[ií]cios/i;
const CALCULATOR_GOOD_THEME_RE =
  /calcul|investimento|faixa|pacote|or[cç]amento|quanto|plano|come[cç]ar|pre[cç]o|custa|cabe no|essencial|completo/i;

const CALCULATOR_ANGLE_POOL = [
  {
    id: 'budget_band',
    hint: 'descobrir a faixa de investimento sem preço fechado',
    titleHint: 'Quanto investir em {t}? Calcule sua faixa',
  },
  {
    id: 'essential_vs_full',
    hint: 'pacote essencial vs completo vs premium',
    titleHint: 'Essencial, completo ou premium: qual pacote de {t}?',
  },
  {
    id: 'goal_fit',
    hint: 'resultado desejado × pacote sugerido',
    titleHint: 'Calcule o pacote de {t} alinhado ao seu objetivo',
  },
  {
    id: 'timing_budget',
    hint: 'tem data/evento e quer saber o que cabe agora',
    titleHint: 'Tem data marcada? Calcule o plano de {t} que cabe agora',
  },
  {
    id: 'compare',
    hint: 'comparar opções antes de pedir orçamento no WhatsApp',
    titleHint: 'Compare opções de {t} antes de falar com a clínica',
  },
  {
    id: 'start_small',
    hint: 'começar pelo mínimo viável / investimento controlado',
    titleHint: 'Começar {t} pelo essencial: calcule seu plano',
  },
];

function pickCalculatorAngles(count = 4) {
  return shuffleInPlace([...CALCULATOR_ANGLE_POOL]).slice(0, count);
}

function isCalculatorThemeOk(theme) {
  const title = String(theme?.title || '');
  const blob = `${title} ${theme?.description || ''} ${theme?.promise || ''}`;
  if (CALCULATOR_BAD_THEME_RE.test(blob)) return false;
  return CALCULATOR_GOOD_THEME_RE.test(title) || CALCULATOR_GOOD_THEME_RE.test(blob);
}

function heuristicCalculatorThemes(topic, angles = null) {
  const t = String(topic || 'estética').trim() || 'estética';
  const baseScores = (intent, impact) => ({
    icpFit: 4,
    specificity: 4,
    intent,
    distribution: 4,
    commercialImpact: impact,
  });
  const byId = {
    budget_band: {
      title: `Quanto investir em ${t}? Calcule sua faixa`,
      description:
        '3 perguntas rápidas → faixa de investimento + tipo de pacote sugerido → WhatsApp.',
      pain: 'Não saber se o investimento cabe sem pedir orçamento às cegas',
      promise: 'Faixa qualitativa + pacote sugerido + próximo passo com a clínica',
      conversionReason: 'Qualifica orçamento e abre conversa com contexto de pacote',
      adHook: `Calcule quanto investir em ${t} em 1 minuto`,
      scores: baseScores(5, 5),
    },
    essential_vs_full: {
      title: `Essencial, completo ou premium: qual pacote de ${t}?`,
      description: 'Respostas objetivas indicam o pacote mais coerente com o seu momento.',
      pain: 'Medo de pagar demais ou de escolher um pacote incompleto',
      promise: 'Pacote sugerido (essencial / completo / premium) + recomendação clara',
      conversionReason: 'Segmenta intenção de compra por profundidade de pacote',
      adHook: `Qual pacote de ${t} faz sentido para você?`,
      scores: baseScores(5, 5),
    },
    goal_fit: {
      title: `Calcule o pacote de ${t} alinhado ao seu objetivo`,
      description: 'Objetivo + urgência + orçamento → plano sugerido para conversar na clínica.',
      pain: 'Objetivo claro, mas sem saber por onde começar o investimento',
      promise: 'Plano sugerido alinhado ao resultado que você busca',
      conversionReason: 'Conecta desejo de resultado com faixa e pacote',
      adHook: `Monte o pacote de ${t} do seu objetivo`,
      scores: baseScores(4, 5),
    },
    timing_budget: {
      title: `Tem data marcada? Calcule o plano de ${t} que cabe agora`,
      description: 'Se há evento ou prazo, a calculadora sugere o plano viável agora.',
      pain: 'Data apertada e dúvida do que é realista investir',
      promise: 'Plano viável para o seu timing + conversa no WhatsApp',
      conversionReason: 'Urgência + orçamento = lead quente com contexto',
      adHook: `Calcule o plano de ${t} para a sua data`,
      scores: baseScores(5, 4),
    },
    compare: {
      title: `Compare opções de ${t} antes de falar com a clínica`,
      description: 'Veja qual faixa/pacote combina com você e chegue no WhatsApp já decidindo melhor.',
      pain: 'Comparar clínicas sem critério de pacote',
      promise: 'Critério de pacote + faixa antes do orçamento formal',
      conversionReason: 'Reduz atrito do “quanto custa?” genérico',
      adHook: `Compare pacotes de ${t} em 1 minuto`,
      scores: baseScores(4, 4),
    },
    start_small: {
      title: `Começar ${t} pelo essencial: calcule seu plano`,
      description: 'Para quem quer começar controlado: calcule o plano de entrada.',
      pain: 'Quer começar, mas sem estourar o orçamento',
      promise: 'Plano essencial sugerido + próximo passo leve',
      conversionReason: 'Abaixa barreira de entrada e gera conversa comercial',
      adHook: `Comece ${t} pelo essencial — calcule agora`,
      scores: baseScores(5, 4),
    },
  };

  const chosen = (angles && angles.length ? angles : pickCalculatorAngles(3)).map((a) =>
    typeof a === 'string' ? a : a.id
  );
  const ids = chosen.filter((id) => byId[id]);
  const pickIds = ids.length >= 3 ? ids.slice(0, 3) : pickCalculatorAngles(3).map((a) => a.id);

  return pickIds.map((id) => ({
    ...byId[id],
    targetAudience: `Pessoas comparando investimento em ${t}`,
    beliefToChange: 'Só dá para entender preço depois de várias conversas',
    leadMagnetType: 'calculator',
  }));
}

function rewriteThemeAsCalculator(theme, topic, angleHint = null) {
  const t = String(topic || 'estética').trim() || 'estética';
  const pain = String(theme?.pain || '').trim();
  let title = String(theme?.title || '').trim();
  if (!isCalculatorThemeOk({ ...theme, title })) {
    title = angleHint?.titleHint
      ? String(angleHint.titleHint).replace(/\{t\}/g, t)
      : pain
        ? `Calcule o pacote de ${t} para o seu momento`
        : `Quanto investir em ${t}? Calcule sua faixa`;
  }
  return {
    ...theme,
    title,
    description:
      String(theme?.description || '').trim() ||
      'Perguntas rápidas → pacote e faixa sugeridos → conversa no WhatsApp.',
    promise: /pacote|faixa|investimento|plano/.test(String(theme?.promise || '').toLowerCase())
      ? theme.promise
      : `Pacote sugerido + faixa de investimento para ${t}`,
    conversionReason:
      theme?.conversionReason ||
      'A pessoa chega no WhatsApp já com faixa e tipo de pacote em mente',
    adHook: theme?.adHook || `Calcule seu pacote de ${t} em 1 minuto`,
    leadMagnetType: 'calculator',
    scores: theme?.scores || {
      icpFit: 4,
      specificity: 4,
      intent: 4,
      distribution: 4,
      commercialImpact: 4,
    },
  };
}

function filterCalculatorThemes(themes, topic, angles = null) {
  const list = Array.isArray(themes) ? themes : [];
  const angleList = angles && angles.length ? angles : pickCalculatorAngles(4);
  const good = list.filter((th) => isCalculatorThemeOk(th));
  const rewritten = list
    .filter((th) => !good.includes(th))
    .map((th, idx) =>
      rewriteThemeAsCalculator(th, topic, angleList[idx % angleList.length])
    );

  const merged = [];
  const pushUnique = (th) => {
    if (!th?.title) return false;
    if (merged.some((m) => titlesTooSimilar(m.title, th.title))) return false;
    if (CALCULATOR_BAD_THEME_RE.test(`${th.title} ${th.description || ''} ${th.promise || ''}`)) {
      return false;
    }
    merged.push({ ...th, leadMagnetType: 'calculator' });
    return true;
  };

  for (const th of [...good, ...rewritten]) {
    pushUnique(th);
    if (merged.length >= 5) break;
  }

  if (merged.length >= 3) return merged.slice(0, 5);

  for (const th of heuristicCalculatorThemes(topic, angleList)) {
    pushUnique(th);
    if (merged.length >= 3) break;
  }
  return merged.slice(0, 5);
}

/** Calculadora: tema alinhado + pacotes distintos por orçamento (Good/Better/Best). */
function sanitizeCalculatorContent(content, topic, procedures = []) {
  if (!content?.calculator) return content;
  const t = topic || 'estética';
  const base = heuristicMagnetContent('calculator', t, procedures);
  const calc = { ...content.calculator };
  const scoped = proceduresForTopic(procedures, t);
  const catalogNames = scoped.map((p) => String(p.name || '').toLowerCase()).filter(Boolean);
  const otherCatalog = (Array.isArray(procedures) ? procedures : [])
    .map((p) => String(p.name || '').toLowerCase())
    .filter((n) => n && !catalogNames.some((c) => c.includes(n) || n.includes(c)));

  const optionBlob = (calc.inputs || [])
    .flatMap((inp) => [
      String(inp.label || ''),
      ...(inp.options || []).map((o) => String(o.label || '')),
    ])
    .join(' ')
    .toLowerCase();

  const geoRegionQuestion =
    /\b(norte|sul|leste|oeste|centro|zona sul|zona norte|bairro|cidade|cep|endere[cç]o|atendimento presencial|onde voc[eê] mora|regi[aã]o (da|de) (cidade|atendimento))\b/i.test(
      optionBlob
    ) ||
    (calc.inputs || []).some((inp) => {
      const label = String(inp.label || '').toLowerCase();
      const opts = (inp.options || []).map((o) => String(o.label || '').toLowerCase()).join(' ');
      return (
        /regi[aã]o.*(atendimento|mora|mora|cidade|cidade)|onde.*(mora|fica|atend)/i.test(label) ||
        (/\bnorte\b/.test(opts) && /\bsul\b/.test(opts))
      );
    });

  const offTopic =
    otherCatalog.some((name) => name.length > 4 && optionBlob.includes(name.slice(0, Math.min(12, name.length)))) ||
    /curso de|micro.?labial|preenchimento labial|harmoniza(ç|c)[aã]o completa|bioestimul|fios de pdo|lipo/i.test(
      optionBlob
    ) ||
    (/(toxina|botox|botulin)/i.test(t) &&
      /labial|preench|micro|curso|harmoniza/i.test(optionBlob)) ||
    geoRegionQuestion;

  const hasBudgetInput = (calc.inputs || []).some(
    (inp) =>
      String(inp.id || '') === 'budget' ||
      /invest|or[cç]ament|dispost|pagar|quanto|por onde|come[cç]ar/i.test(String(inp.label || ''))
  );

  if (offTopic || !calc.inputs?.length || !hasBudgetInput) {
    calc.inputs = base.calculator.inputs;
  } else if (Array.isArray(calc.inputs)) {
    calc.inputs = calc.inputs.map((inp, i) => {
      const fb = base.calculator.inputs[i] || base.calculator.inputs[0];
      const label = String(inp.label || '');
      const optsBlob = (inp.options || []).map((o) => String(o.label || '')).join(' ').toLowerCase();
      if (
        /curso de|micro.?labial|preenchimento labial/i.test(label) ||
        (/(toxina|botox|botulin)/i.test(t) && /labial|preenchimento|micro/i.test(label)) ||
        (/\bnorte\b/.test(optsBlob) && /\bsul\b/.test(optsBlob)) ||
        /regi[aã]o.*(atendimento|mora|cidade)|onde.*(mora|fica|atend)/i.test(label)
      ) {
        const focus = base.calculator.inputs.find((x) => x.id === 'focus') || fb;
        return { ...focus };
      }
      // Garante opções de orçamento com ids essenciais/completo/premium
      if (
        String(inp.id || '') === 'budget' ||
        /invest|or[cç]ament|dispost|pagar|quanto|por onde|come[cç]ar/i.test(label)
      ) {
        const baseBudget = base.calculator.inputs.find((x) => x.id === 'budget');
        if (baseBudget) {
          return {
            ...inp,
            id: 'budget',
            label: baseBudget.label,
            options: baseBudget.options,
          };
        }
      }
      // focus: em toxina, só regiões faciais
      if (String(inp.id || '') === 'focus' || /regi[aã]o|incomoda|preocup/i.test(label)) {
        const baseFocus = base.calculator.inputs.find((x) => x.id === 'focus');
        if (baseFocus) {
          return { ...baseFocus };
        }
      }
      return inp;
    });
    // Garante input focus se ausente
    if (!(calc.inputs || []).some((x) => x.id === 'focus')) {
      const focus = base.calculator.inputs.find((x) => x.id === 'focus');
      if (focus) calc.inputs = [focus, ...calc.inputs];
    }
  }

  const packages = Array.isArray(calc.packages) ? calc.packages : [];
  const priceHints = packages.map((p) => String(p.priceHint || '').trim()).filter(Boolean);
  const uniquePrices = new Set(priceHints);
  const missingRegions = packages.some(
    (p) => !Array.isArray(p.regions) || p.regions.length === 0
  );
  // Preços diferentes na tela assustam — forçamos o mesmo "a partir de" do catálogo
  const pricesDiverge = packages.length >= 2 && uniquePrices.size > 1;
  const badPkg = /laudo|diagn[oó]stico|perfil|adequa/i;

  if (!packages.length || pricesDiverge || missingRegions) {
    calc.packages = base.calculator.packages;
  } else {
    calc.packages = packages.slice(0, 3).map((pkg, i) => {
      const fb = base.calculator.packages[i] || base.calculator.packages[0];
      const title = String(pkg.title || '').trim();
      const summary = String(pkg.summary || '').trim();
      return {
        ...fb,
        ...pkg,
        id: pkg.id || fb.id,
        title: badPkg.test(title) || !title ? fb.title : title,
        procedureName: fb.procedureName,
        procedureValue: fb.procedureValue,
        priceHint: fb.priceHint,
        regions:
          Array.isArray(pkg.regions) && pkg.regions.length ? pkg.regions.slice(0, 6) : fb.regions,
        summary: badPkg.test(summary) || !summary ? fb.summary : summary,
        recommendation: String(pkg.recommendation || '').trim() || fb.recommendation,
        highlights:
          Array.isArray(pkg.highlights) && pkg.highlights.length
            ? pkg.highlights.slice(0, 6)
            : fb.highlights,
        match: { budget: [String(pkg.id || fb.id)] },
      };
    });
  }

  if (badPkg.test(String(calc.title || '')) || /perfil|diagn/i.test(String(calc.title || ''))) {
    calc.title = base.calculator.title;
  }
  if (/selfie|laudo|diagn/i.test(String(calc.subtitle || ''))) {
    calc.subtitle = base.calculator.subtitle;
  }
  if (!calc.disclaimer) calc.disclaimer = base.calculator.disclaimer;
  if (!calc.intro) calc.intro = base.calculator.intro;

  return { ...content, calculator: calc };
}

/* ---------- Checklist / Avaliação / eBook / Quiz: temas alinhados ao tipo ---------- */

const CHECKLIST_ANGLE_POOL = [
  {
    id: 'before_decide',
    hint: 'o que verificar antes de decidir',
    titleHint: 'Checklist: o que checar antes de {t}',
  },
  {
    id: 'questions',
    hint: 'perguntas para levar na avaliação',
    titleHint: 'Checklist de perguntas para sua avaliação de {t}',
  },
  {
    id: 'red_flags',
    hint: 'sinais de alerta ao escolher profissional/clínica',
    titleHint: 'Checklist: sinais de alerta antes de marcar {t}',
  },
  {
    id: 'prepare',
    hint: 'como se preparar no dia / na semana',
    titleHint: 'Checklist rápido: prepare-se para {t}',
  },
];

const EVALUATION_ANGLE_POOL = [
  {
    id: 'week_slots',
    hint: 'vagas desta semana com confirmação no WhatsApp',
    titleHint: 'Vagas desta semana para avaliação de {t}',
  },
  {
    id: 'scarce',
    hint: 'escassez / fila curta',
    titleHint: 'Fila curta: reserve interesse na avaliação de {t}',
  },
  {
    id: 'morning_afternoon',
    hint: 'escolher manhã ou tarde',
    titleHint: 'Manhã ou tarde? Entre na fila de avaliação de {t}',
  },
  {
    id: 'confirm_wa',
    hint: 'confirmação rápida pelo WhatsApp',
    titleHint: 'Avaliação de {t}: escolha o horário e confirme no WhatsApp',
  },
];

const EBOOK_ANGLE_POOL = [
  {
    id: 'guide',
    hint: 'guia prático para decidir com clareza',
    titleHint: 'Guia prático: o que saber antes de {t}',
  },
  {
    id: 'myths',
    hint: 'mitos e verdades do procedimento',
    titleHint: 'Mitos e verdades sobre {t} (guia gratuito)',
  },
  {
    id: 'criteria',
    hint: 'critérios para escolher bem',
    titleHint: 'Como decidir se {t} faz sentido para você',
  },
  {
    id: 'expect',
    hint: 'expectativa realista de resultado e cuidados',
    titleHint: 'O que esperar de {t}: guia objetivo',
  },
];

const QUIZ_ANGLE_POOL = [
  {
    id: 'quick_test',
    hint: 'teste rápido de 1 minuto',
    titleHint: 'Teste rápido: qual caminho de {t} combina com você?',
  },
  {
    id: 'style',
    hint: 'estilo de resultado (sutil vs marcado)',
    titleHint: 'Quiz: resultado sutil ou mais marcado em {t}?',
  },
  {
    id: 'ready',
    hint: 'pronta para avançar ou ainda pesquisando',
    titleHint: 'Quiz: você está pronta para {t}?',
  },
  {
    id: 'priority',
    hint: 'prioridade do momento',
    titleHint: 'Em 5 perguntas: o que priorizar em {t}?',
  },
];

function pickAnglesFrom(pool, count = 4) {
  return shuffleInPlace([...pool]).slice(0, count);
}

function themeBlob(theme) {
  return `${theme?.title || ''} ${theme?.description || ''} ${theme?.promise || ''} ${theme?.adHook || ''}`;
}

function isChecklistThemeOk(theme) {
  const blob = themeBlob(theme);
  if (/laudo|diagn[oó]stico|selfie|antes\s*\/?\s*depois|calcule sua faixa|pacote essencial|fila de avalia|vagas desta semana/i.test(blob)) {
    return false;
  }
  return /checklist|lista|marque|itens|verificar|checar|perguntas para|prepare-se|sinais de alerta|antes de/i.test(
    blob
  );
}

function isEvaluationThemeOk(theme) {
  const blob = themeBlob(theme);
  if (/laudo|diagn[oó]stico|selfie|calcule|pacote|ebook|guia completo|checklist|mitos?\s*e\s*verdades/i.test(blob)) {
    return false;
  }
  return /vaga|avalia|fila|hor[aá]rio|agenda|semana|reserva|entrar na fila|confirma/i.test(blob);
}

function isEbookThemeOk(theme) {
  const blob = themeBlob(theme);
  if (
    /laudo personalizado|diagn[oó]stico:|selfie|antes\s*\/?\s*depois|calcule sua faixa|pacote essencial|entrar na fila|vagas desta semana/i.test(
      blob
    )
  ) {
    return false;
  }
  return /guia|ebook|o que saber|antes de|mitos|verdades|como decidir|o que esperar|material|baixe/i.test(
    blob
  );
}

function isQuizThemeOk(theme) {
  const blob = themeBlob(theme);
  if (
    /laudo personalizado|diagn[oó]stico:|selfie|calcule sua faixa|pacote essencial|faixa de investimento|vagas desta semana|guia completo|ebook/i.test(
      blob
    )
  ) {
    return false;
  }
  return /quiz|teste|perguntas|descubra|em 1 minuto|qual caminho|pronta para|priorizar/i.test(blob);
}

function heuristicMagnetThemes(magnetType, topic, angles = null) {
  const t = String(topic || 'estética').trim() || 'estética';
  const scores = (intent = 4, impact = 4) => ({
    icpFit: 4,
    specificity: 4,
    intent,
    distribution: 4,
    commercialImpact: impact,
  });

  const catalogs = {
    checklist: {
      pool: CHECKLIST_ANGLE_POOL,
      byId: {
        before_decide: {
          title: `Checklist: o que checar antes de ${t}`,
          description: 'Lista prática para marcar item a item antes de decidir.',
          pain: 'Decidir sem critério e cair em conversa genérica',
          promise: 'Checklist acionável + próximo passo com a clínica',
          conversionReason: 'Quem baixa já chega no WhatsApp com perguntas prontas',
          adHook: `Baixe o checklist antes de marcar ${t}`,
          scores: scores(4, 4),
        },
        questions: {
          title: `Checklist de perguntas para sua avaliação de ${t}`,
          description: 'Perguntas objetivas para levar na conversa com a especialista.',
          pain: 'Sair da avaliação sem ter perguntado o essencial',
          promise: 'Lista de perguntas + confiança na conversa',
          conversionReason: 'Aumenta qualidade do lead e da avaliação',
          adHook: `Leve estas perguntas na avaliação de ${t}`,
          scores: scores(5, 4),
        },
        red_flags: {
          title: `Checklist: sinais de alerta antes de marcar ${t}`,
          description: 'Itens para evitar escolha errada de clínica/profissional.',
          pain: 'Medo de cair em conversa agressiva ou pouco clara',
          promise: 'Checklist de alerta + critério de escolha',
          conversionReason: 'Posiciona a clínica como transparente',
          adHook: `Sinais de alerta antes de ${t}`,
          scores: scores(5, 5),
        },
        prepare: {
          title: `Checklist rápido: prepare-se para ${t}`,
          description: 'O que organizar na semana e no dia do procedimento/avaliação.',
          pain: 'Chegar despreparada e ansiosa',
          promise: 'Checklist de preparação + tranquilidade',
          conversionReason: 'Reduz no-show e aquece a conversa',
          adHook: `Prepare-se para ${t} com este checklist`,
          scores: scores(4, 4),
        },
      },
    },
    evaluation: {
      pool: EVALUATION_ANGLE_POOL,
      byId: {
        week_slots: {
          title: `Vagas desta semana para avaliação de ${t}`,
          description: 'Escolha um horário da fila — a clínica confirma no WhatsApp.',
          pain: 'Querer avaliar e não saber quando caber',
          promise: 'Interesse em vaga + confirmação rápida',
          conversionReason: 'BOFU direto: horário + WhatsApp',
          adHook: `Vagas da semana: avaliação de ${t}`,
          scores: scores(5, 5),
        },
        scarce: {
          title: `Fila curta: reserve interesse na avaliação de ${t}`,
          description: 'Poucas vagas — entre na fila e receba confirmação no WhatsApp.',
          pain: 'Adiar a avaliação e perder o momento',
          promise: 'Lugar na fila + retorno da clínica',
          conversionReason: 'Escassez aumenta conversão',
          adHook: `Entre na fila de avaliação de ${t}`,
          scores: scores(5, 5),
        },
        morning_afternoon: {
          title: `Manhã ou tarde? Entre na fila de avaliação de ${t}`,
          description: 'Escolha o período que prefere; confirmamos disponibilidade.',
          pain: 'Agenda apertada',
          promise: 'Preferência de horário + confirmação',
          conversionReason: 'Facilita encaixe real na agenda da clínica',
          adHook: `Escolha manhã ou tarde para ${t}`,
          scores: scores(4, 4),
        },
        confirm_wa: {
          title: `Avaliação de ${t}: escolha o horário e confirme no WhatsApp`,
          description: 'Fila da semana com confirmação humana pelo WhatsApp.',
          pain: 'Formulário frio sem retorno',
          promise: 'Horário preferido + contato da clínica',
          conversionReason: 'Lead quente com preferência de agenda',
          adHook: `Reserve sua avaliação de ${t}`,
          scores: scores(5, 4),
        },
      },
    },
    ebook: {
      pool: EBOOK_ANGLE_POOL,
      byId: {
        guide: {
          title: `Guia prático: o que saber antes de ${t}`,
          description: 'Material objetivo para decidir com mais clareza — baixe grátis.',
          pain: 'Informação espalhada e contraditória',
          promise: 'Guia em PDF + clareza para a conversa',
          conversionReason: 'TOFU clássico com captura de lead',
          adHook: `Baixe o guia antes de ${t}`,
          scores: scores(4, 4),
        },
        myths: {
          title: `Mitos e verdades sobre ${t} (guia gratuito)`,
          description: 'Separe o que é mito do que importa de verdade.',
          pain: 'Achar que já sabe e travar na dúvida',
          promise: 'Guia de mitos/verdades + próximo passo',
          conversionReason: 'Alto compartilhamento e captura',
          adHook: `Mitos e verdades de ${t}`,
          scores: scores(5, 4),
        },
        criteria: {
          title: `Como decidir se ${t} faz sentido para você`,
          description: 'Critérios práticos num guia curto para baixar.',
          pain: 'Comparar sem critério',
          promise: 'Critérios claros + material para reler',
          conversionReason: 'Qualifica intenção de pesquisa',
          adHook: `Guia: ${t} faz sentido para mim?`,
          scores: scores(4, 5),
        },
        expect: {
          title: `O que esperar de ${t}: guia objetivo`,
          description: 'Expectativa, cuidados e perguntas — tudo num material só.',
          pain: 'Medo do desconhecido',
          promise: 'Guia de expectativa + segurança emocional',
          conversionReason: 'Reduz objeção e gera lead',
          adHook: `O que esperar de ${t}`,
          scores: scores(4, 4),
        },
      },
    },
    quiz: {
      pool: QUIZ_ANGLE_POOL,
      byId: {
        quick_test: {
          title: `Teste rápido: qual caminho de ${t} combina com você?`,
          description: 'Perguntas curtas → resultado personalizado → WhatsApp.',
          pain: 'Não saber por onde começar',
          promise: 'Resultado do quiz + próximo passo',
          conversionReason: 'Engajamento alto e lead com contexto',
          adHook: `Faça o teste de ${t} em 1 minuto`,
          scores: scores(5, 5),
        },
        style: {
          title: `Quiz: resultado sutil ou mais marcado em ${t}?`,
          description: 'Descubra o estilo que combina com você em poucas perguntas.',
          pain: 'Medo de escolher o tom errado',
          promise: 'Perfil de estilo + conversa alinhada',
          conversionReason: 'Personaliza a oferta sem ser laudo clínico',
          adHook: `Sutil ou marcado? Teste de ${t}`,
          scores: scores(5, 4),
        },
        ready: {
          title: `Quiz: você está pronta para ${t}?`,
          description: 'Um teste leve de prontidão — sem pressão.',
          pain: 'Pressão para decidir sem clareza',
          promise: 'Leitura de prontidão + próximo passo',
          conversionReason: 'Segmenta temperatura do lead',
          adHook: `Você está pronta para ${t}? Faça o quiz`,
          scores: scores(4, 5),
        },
        priority: {
          title: `Em 5 perguntas: o que priorizar em ${t}?`,
          description: 'Prioridade do momento → recomendação de conversa.',
          pain: 'Muitas opções e nenhuma prioridade',
          promise: 'Prioridade clara + CTA',
          conversionReason: 'Abre WhatsApp com foco definido',
          adHook: `O que priorizar em ${t}?`,
          scores: scores(4, 4),
        },
      },
    },
  };

  const cat = catalogs[magnetType];
  if (!cat) return [];
  const chosen = (angles && angles.length ? angles : pickAnglesFrom(cat.pool, 3)).map((a) =>
    typeof a === 'string' ? a : a.id
  );
  const ids = chosen.filter((id) => cat.byId[id]);
  const pickIds = ids.length >= 3 ? ids.slice(0, 3) : pickAnglesFrom(cat.pool, 3).map((a) => a.id);

  return pickIds.map((id) => ({
    ...cat.byId[id],
    targetAudience: `Pessoas interessadas em ${t}`,
    beliefToChange: 'Dá para decidir só com preço no Instagram',
    leadMagnetType: magnetType,
  }));
}

function rewriteThemeAsMagnet(theme, magnetType, topic, angleHint = null) {
  const t = String(topic || 'estética').trim() || 'estética';
  let title = String(theme?.title || '').trim();
  const ok =
    magnetType === 'checklist'
      ? isChecklistThemeOk(theme)
      : magnetType === 'evaluation'
        ? isEvaluationThemeOk(theme)
        : magnetType === 'ebook'
          ? isEbookThemeOk(theme)
          : magnetType === 'quiz'
            ? isQuizThemeOk(theme)
            : true;
  if (!ok) {
    title = angleHint?.titleHint
      ? String(angleHint.titleHint).replace(/\{t\}/g, t)
      : `Tema de ${magnetType} sobre ${t}`;
  }
  const defaults = {
    checklist: {
      description: 'Checklist prático para marcar item a item e chegar preparada na conversa.',
      promise: `Checklist de ${t} + próximo passo`,
      adHook: `Baixe o checklist de ${t}`,
    },
    evaluation: {
      description: 'Escolha um horário da fila — a clínica confirma no WhatsApp.',
      promise: 'Interesse em vaga + confirmação no WhatsApp',
      adHook: `Entre na fila de avaliação de ${t}`,
    },
    ebook: {
      description: 'Material educativo para baixar e decidir com mais clareza.',
      promise: `Guia de ${t} em PDF`,
      adHook: `Baixe o guia de ${t}`,
    },
    quiz: {
      description: 'Perguntas rápidas → resultado → WhatsApp com contexto.',
      promise: `Resultado do quiz de ${t}`,
      adHook: `Faça o quiz de ${t}`,
    },
  };
  const d = defaults[magnetType] || defaults.ebook;
  return {
    ...theme,
    title,
    description: String(theme?.description || '').trim() || d.description,
    promise: String(theme?.promise || '').trim() || d.promise,
    conversionReason:
      theme?.conversionReason || 'Gera lead qualificado alinhado ao tipo de isca',
    adHook: theme?.adHook || d.adHook,
    leadMagnetType: magnetType,
    scores: theme?.scores || {
      icpFit: 4,
      specificity: 4,
      intent: 4,
      distribution: 4,
      commercialImpact: 4,
    },
  };
}

function filterMagnetThemes(magnetType, themes, topic, angles = null) {
  const list = Array.isArray(themes) ? themes : [];
  const pool =
    magnetType === 'checklist'
      ? CHECKLIST_ANGLE_POOL
      : magnetType === 'evaluation'
        ? EVALUATION_ANGLE_POOL
        : magnetType === 'ebook'
          ? EBOOK_ANGLE_POOL
          : QUIZ_ANGLE_POOL;
  const angleList = angles && angles.length ? angles : pickAnglesFrom(pool, 4);
  const isOk =
    magnetType === 'checklist'
      ? isChecklistThemeOk
      : magnetType === 'evaluation'
        ? isEvaluationThemeOk
        : magnetType === 'ebook'
          ? isEbookThemeOk
          : isQuizThemeOk;

  const good = list.filter((th) => isOk(th));
  const rewritten = list
    .filter((th) => !good.includes(th))
    .map((th, idx) =>
      rewriteThemeAsMagnet(th, magnetType, topic, angleList[idx % angleList.length])
    );

  const merged = [];
  const pushUnique = (th) => {
    if (!th?.title || !isOk(th)) return false;
    if (merged.some((m) => titlesTooSimilar(m.title, th.title))) return false;
    merged.push({ ...th, leadMagnetType: magnetType });
    return true;
  };
  for (const th of [...good, ...rewritten]) {
    pushUnique(th);
    if (merged.length >= 5) break;
  }
  if (merged.length >= 3) return merged.slice(0, 5);

  for (const th of heuristicMagnetThemes(magnetType, topic, angleList)) {
    pushUnique(th);
    if (merged.length >= 3) break;
  }
  return merged.slice(0, 5);
}

function sanitizeChecklistContent(content, topic) {
  if (!content?.checklist) return content;
  const base = heuristicMagnetContent('checklist', topic || 'estética');
  const c = { ...content.checklist };
  const bad = /laudo|diagn[oó]stico|selfie|calcule|pacote essencial/i;
  if (bad.test(String(c.title || ''))) c.title = base.checklist.title;
  if (bad.test(String(c.subtitle || ''))) c.subtitle = base.checklist.subtitle;
  if (!Array.isArray(c.items) || c.items.length < 4) c.items = base.checklist.items;
  if (!c.disclaimer) c.disclaimer = base.checklist.disclaimer;
  return { ...content, checklist: c };
}

function sanitizeEvaluationContent(content, topic) {
  if (!content?.evaluation) return content;
  const base = heuristicMagnetContent('evaluation', topic || 'estética');
  const e = { ...content.evaluation };
  const bad = /laudo|diagn[oó]stico|selfie|calcule|ebook|checklist/i;
  if (bad.test(String(e.title || ''))) e.title = base.evaluation.title;
  if (bad.test(String(e.subtitle || ''))) e.subtitle = base.evaluation.subtitle;
  if (!Array.isArray(e.slots) || e.slots.length < 3) e.slots = base.evaluation.slots;
  if (!e.ctaText) e.ctaText = base.evaluation.ctaText;
  if (!e.formTitle) e.formTitle = base.evaluation.formTitle;
  if (!e.successNote) e.successNote = base.evaluation.successNote;
  return { ...content, evaluation: e };
}

function normalizeCouponPercent(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 100) return null;
  return rounded;
}

function formatCampaign(doc) {
  const obj = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(obj._id),
    title: obj.title,
    topic: obj.topic || '',
    procedureName: obj.procedureName || '',
    publicSlug: obj.publicSlug,
    status: obj.status,
    leadMagnetType: obj.leadMagnetType || 'ebook',
    diagnosisVariant: normalizeDiagnosisVariant(obj.diagnosisVariant),
    contactWhatsApp: obj.contactWhatsApp || '',
    couponCode: obj.couponCode || '',
    couponPercent: normalizeCouponPercent(obj.couponPercent),
    couponMessage: obj.couponMessage || '',
    selectedTheme: obj.selectedTheme || null,
    content: obj.content || null,
    qualityReport: obj.qualityReport || null,
    source: obj.source || null,
    pdfKey: obj.pdfKey || null,
    visits: obj.visits || 0,
    leadsCount: obj.leadsCount || 0,
    metrics: obj.metrics || {},
    createdAt: obj.createdAt,
    publishedAt: obj.publishedAt,
  };
}

async function withPdfUrl(formatted) {
  if (!formatted.pdfKey || !isR2Configured()) {
    return { ...formatted, pdfUrl: null };
  }
  try {
    const pdfUrl = await resolveReadUrl(formatted.pdfKey);
    return { ...formatted, pdfUrl };
  } catch {
    return { ...formatted, pdfUrl: null };
  }
}

function heuristicCampaignContent(topic) {
  const t = topic || 'estética';
  const sections = [
    {
      heading: 'Por que a decisão trava',
      body: `Falta de informação clara sobre ${t} gera o clássico "vou pensar". Este guia responde as dúvidas mais comuns.`,
    },
    {
      heading: 'O que avaliar antes',
      body: 'Objetivo, expectativa de resultado, cuidado pós e quando fazer uma avaliação presencial.',
    },
    {
      heading: 'Perguntas para a consulta',
      body: 'Quem realiza? Qual a experiência? Como é o acompanhamento?',
    },
    {
      heading: 'Próximo passo',
      body: 'Se fizer sentido, agende uma avaliação. Este material não substitui a consulta.',
    },
  ];
  return {
    ebook: {
      title: `Guia prático: o que saber antes de ${t}`,
      subtitle: 'Material educativo para decidir com mais clareza',
      coverTagline: 'Decida com segurança',
      sections,
      disclaimer: 'Conteúdo educativo. Não substitui avaliação profissional presencial.',
    },
    landing: {
      heroHeadline: `Baixe o guia gratuito sobre ${t}`,
      heroSubheadline: 'Respostas claras para decidir com mais segurança, sem enrolação.',
      painTitle: 'Isso parece familiar?',
      painPoints: [
        'Você pesquisa, mas cada lugar diz uma coisa diferente',
        'Tem medo de escolher errado e se arrepender',
        'Não sabe o que perguntar na avaliação',
      ],
      learnTitle: 'O que você vai aprender',
      learnItems: sections.map((s) => s.heading),
      benefits: [
        'Leitura rápida e direta',
        'Feito para quem está pesquisando agora',
        'Receba e tire dúvidas com a clínica',
      ],
      urgencyNote: 'Material gratuito por tempo limitado.',
      formTitle: 'Receba o guia agora',
      ctaText: 'Baixar grátis',
      headline: `Baixe o guia gratuito sobre ${t}`,
      bullets: [
        'Respostas claras, sem enrolação',
        'Feito para quem está pesquisando agora',
        'Receba e tire dúvidas com a clínica',
      ],
      cta: 'Baixar grátis',
    },
    adCreatives: [
      {
        headline: `Guia gratuito: ${t}`,
        primaryText: `Pensando em ${t}? Baixe o guia e entenda o que avaliar antes de decidir.`,
        cta: 'Saiba mais',
        format: 'post',
        visualSuggestion: `Foto clean do resultado natural de ${t}, com selo "Guia gratuito".`,
      },
      {
        headline: 'Pare de adiar a decisão',
        primaryText: `Um guia curto e direto sobre ${t}. Baixe grátis.`,
        cta: 'Baixar agora',
        format: 'post',
        visualSuggestion: 'Mockup do eBook em um celular, fundo com a cor da marca.',
      },
      {
        headline: 'O que ninguém te explica',
        primaryText: `Dúvidas comuns sobre ${t} em um material objetivo. Baixe e leia em 5 minutos.`,
        cta: 'Quero o guia',
        format: 'story',
        visualSuggestion: 'Story com pergunta em texto grande e sticker de link para o guia.',
      },
    ],
    audienceSuggestion:
      'Mulheres 25–45, interesse em estética/beleza, raio de 15–25 km da clínica.',
  };
}

async function ensureAgnoAvailable() {
  if (!isAgnoEnabled()) {
    const err = new Error(
      'IA indisponível: serviço de agentes não configurado (AGNO_BASE_URL). Configure e tente novamente.'
    );
    err.statusCode = 503;
    throw err;
  }
  const health = await healthCheck();
  if (!health.ok) {
    const err = new Error(
      'IA indisponível: o serviço de agentes não respondeu. Verifique se ele está no ar e tente novamente.'
    );
    err.statusCode = 503;
    throw err;
  }
}

async function buildClinicBrief(userId) {
  const user = await User.findById(userId).select('clinic name').lean();
  const clinicName = user?.clinic || user?.name || 'Gerenciei';
  const procedures = await Procedure.find({ userId })
    .select('name value category')
    .sort({ value: -1 })
    .limit(30)
    .lean();
  return {
    clinicName,
    procedures: procedures.map((p) => ({
      name: p.name,
      value: p.value,
      category: p.category || 'estetica',
    })),
  };
}

/**
 * Etapa de validação de tema: a IA analisa o contexto da clínica e devolve
 * 3–5 temas com racional e score, antes de qualquer geração de conteúdo.
 */
async function suggestCampaignThemes(userId, payload = {}) {
  await ensureAgnoAvailable();
  const { clinicName, procedures } = await buildClinicBrief(userId);

  let procedureDetail = null;
  if (payload.procedureId) {
    const proc = await Procedure.findOne({ _id: payload.procedureId, userId })
      .select('name value category')
      .lean();
    if (proc) {
      procedureDetail = { name: proc.name, value: proc.value, category: proc.category };
    }
  }

  const magnetType = normalizeLeadMagnetType(payload.leadMagnetType || 'ebook');
  const diversityAngles =
    magnetType === 'diagnosis'
      ? pickDiagnosisAngles(4)
      : magnetType === 'calculator'
        ? pickCalculatorAngles(4)
        : magnetType === 'checklist'
          ? pickAnglesFrom(CHECKLIST_ANGLE_POOL, 4)
          : magnetType === 'evaluation'
            ? pickAnglesFrom(EVALUATION_ANGLE_POOL, 4)
            : magnetType === 'ebook'
              ? pickAnglesFrom(EBOOK_ANGLE_POOL, 4)
              : magnetType === 'quiz'
                ? pickAnglesFrom(QUIZ_ANGLE_POOL, 4)
                : [];

  const brief = {
    procedureName: payload.procedureName || procedureDetail?.name || '',
    procedure: procedureDetail,
    idea: payload.topic || '',
    leadMagnetType: magnetType,
    clinicName,
    procedures,
    diversitySeed: Date.now() % 997,
    diversityAngles: diversityAngles.map((a) => ({
      id: a.id,
      hint: a.hint,
      titleHint: a.titleHint,
    })),
  };
  if (magnetType === 'diagnosis') {
    brief.diagnosisVariant = normalizeDiagnosisVariant(payload.diagnosisVariant);
  }

  let themes = [];
  let source = 'heuristic';
  try {
    const res = await agnoSuggestThemes({
      userId: String(userId),
      campaignBrief: brief,
      context: { clinicName, procedures },
    });
    themes = res?.data?.themes || [];
    source = res?.source || 'agno';
  } catch (err) {
    console.warn('[campaign] theme suggestions failed:', err.message);
    const e = new Error('A IA não conseguiu analisar os temas agora. Tente novamente em instantes.');
    e.statusCode = 502;
    throw e;
  }

  if (source === 'heuristic' || themes.length < 3) {
    const e = new Error(
      'IA indisponível: a análise de temas retornou conteúdo simplificado. Verifique a chave do modelo e tente novamente.'
    );
    e.statusCode = 503;
    throw e;
  }

  const topicKey = brief.procedureName || brief.idea;

  if (brief.leadMagnetType === 'diagnosis') {
    const passed = themes.filter(
      (th) =>
        isDiagnosisThemeTitleOk(th?.title) &&
        isDiagnosisThemePromiseOk(th?.promise) &&
        !isDiagnosisThemeCliché(th?.title)
    );
    if (passed.length < 2) {
      try {
        const angleLines = diversityAngles
          .map((a, i) => `${i + 1}) ${a.hint} → título no espírito de: ${a.titleHint}`)
          .join('\n');
        const retryBrief = {
          ...brief,
          retryHint:
            'TEMAS ANTERIORES REJEITADOS (clichês ou educativos). Gere 4 temas NOVOS, ' +
            'cada um em um ângulo DIFERENTE da lista abaixo. PROIBIDO repetir: ' +
            '"Qual seu perfil com…", "Iniciar, manter ou explorar…", "O que pesa mais no seu caso…".\n' +
            angleLines,
        };
        const retry = await agnoSuggestThemes({
          userId: String(userId),
          campaignBrief: retryBrief,
          context: { clinicName, procedures },
        });
        const retryThemes = retry?.data?.themes || [];
        if (retryThemes.length >= 3) themes = retryThemes;
      } catch (retryErr) {
        console.warn('[campaign] diagnosis theme retry failed:', retryErr.message);
      }
    }

    themes = filterDiagnosisThemes(
      themes,
      topicKey,
      brief.diagnosisVariant,
      diversityAngles
    );
  } else if (brief.leadMagnetType === 'calculator') {
    const passed = themes.filter((th) => isCalculatorThemeOk(th));
    if (passed.length < 2) {
      try {
        const angleLines = diversityAngles
          .map((a, i) => `${i + 1}) ${a.hint} → ${a.titleHint}`)
          .join('\n');
        const retryBrief = {
          ...brief,
          retryHint:
            'TEMAS REJEITADOS: pareciam diagnóstico/laudo/selfie. Gere 4 temas de CALCULADORA ' +
            '(investimento, pacote, faixa). PROIBIDO: laudo, perfil, selfie, o que pesa mais.\n' +
            angleLines,
        };
        const retry = await agnoSuggestThemes({
          userId: String(userId),
          campaignBrief: retryBrief,
          context: { clinicName, procedures },
        });
        const retryThemes = retry?.data?.themes || [];
        if (retryThemes.length >= 3) themes = retryThemes;
      } catch (retryErr) {
        console.warn('[campaign] calculator theme retry failed:', retryErr.message);
      }
    }
    themes = filterCalculatorThemes(themes, topicKey, diversityAngles);
  } else if (
    brief.leadMagnetType === 'checklist' ||
    brief.leadMagnetType === 'evaluation' ||
    brief.leadMagnetType === 'ebook' ||
    brief.leadMagnetType === 'quiz'
  ) {
    const type = brief.leadMagnetType;
    const okFn =
      type === 'checklist'
        ? isChecklistThemeOk
        : type === 'evaluation'
          ? isEvaluationThemeOk
          : type === 'ebook'
            ? isEbookThemeOk
            : isQuizThemeOk;
    const passed = themes.filter((th) => okFn(th));
    if (passed.length < 2) {
      try {
        const angleLines = diversityAngles
          .map((a, i) => `${i + 1}) ${a.hint} → ${a.titleHint}`)
          .join('\n');
        const retryBrief = {
          ...brief,
          retryHint:
            `TEMAS REJEITADOS: não casavam com leadMagnetType='${type}'. ` +
            `Gere 4 temas NOVOS só desse tipo. Use os ângulos:\n${angleLines}`,
        };
        const retry = await agnoSuggestThemes({
          userId: String(userId),
          campaignBrief: retryBrief,
          context: { clinicName, procedures },
        });
        const retryThemes = retry?.data?.themes || [];
        if (retryThemes.length >= 3) themes = retryThemes;
      } catch (retryErr) {
        console.warn(`[campaign] ${type} theme retry failed:`, retryErr.message);
      }
    }
    themes = filterMagnetThemes(type, themes, topicKey, diversityAngles);
  }

  // Garante badge/tipo consistente na UI
  themes = themes.map((th) => ({ ...th, leadMagnetType: magnetType }));

  return { themes: themes.slice(0, 5) };
}

async function listCampaigns(userId) {
  const rows = await Campaign.find({ userId }).sort({ createdAt: -1 }).lean();
  return Promise.all(rows.map((r) => withPdfUrl(formatCampaign(r))));
}

async function getCampaign(userId, id) {
  const row = await Campaign.findOne({ _id: id, userId });
  if (!row) {
    const err = new Error('Campanha não encontrada');
    err.statusCode = 404;
    throw err;
  }
  if (normalizeLeadMagnetType(row.leadMagnetType) === 'calculator' && row.content?.calculator) {
    try {
      const { procedures } = await buildClinicBrief(userId);
      const topic = row.topic || row.procedureName || row.title;
      row.content = sanitizeCalculatorContent(row.content, topic, procedures);
    } catch (err) {
      console.warn('[campaign] calculator get sanitize failed:', err.message);
    }
  }
  return withPdfUrl(formatCampaign(row));
}

/**
 * Estatísticas da campanha: visitas, leads, funil por etapa e lista das pessoas.
 */
async function getCampaignStats(userId, id) {
  const mongoose = require('mongoose');
  const Sale = require('../models/Sale');

  const campaign = await Campaign.findOne({ _id: id, userId }).lean();
  if (!campaign) {
    const err = new Error('Campanha não encontrada');
    err.statusCode = 404;
    throw err;
  }

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const leads = await CampaignLead.find({ userId: userObjectId, campaignId: campaign._id })
    .sort({ createdAt: -1 })
    .lean();

  const clientObjectIds = leads.map((l) => l.clientId).filter(Boolean);
  const [clients, salesRows] = await Promise.all([
    Client.find({ userId: userObjectId, _id: { $in: clientObjectIds } })
      .select('name phone pipelineStage leadTemperature leadScore createdAt category')
      .lean(),
    clientObjectIds.length
      ? Sale.aggregate([
          {
            $match: {
              userId: userObjectId,
              clientId: { $in: clientObjectIds },
              isDemo: { $ne: true },
            },
          },
          {
            $group: {
              _id: '$clientId',
              salesCount: { $sum: 1 },
              salesAmount: { $sum: '$netValue' },
            },
          },
        ])
      : Promise.resolve([]),
  ]);

  const clientMap = new Map(clients.map((c) => [String(c._id), c]));
  const salesMap = new Map(
    salesRows.map((r) => [String(r._id), { count: r.salesCount, amount: r.salesAmount || 0 }])
  );

  const byStage = {
    new: 0,
    qualified: 0,
    proposal: 0,
    negotiation: 0,
    won: 0,
    lost: 0,
  };

  const people = await Promise.all(
    leads.map(async (lead) => {
      const client = clientMap.get(String(lead.clientId));
      const stage = (client && client.pipelineStage) || 'new';
      if (byStage[stage] !== undefined) byStage[stage] += 1;
      else byStage.new += 1;
      const sale = salesMap.get(String(lead.clientId));
      const profiles = campaign.content?.quiz?.resultProfiles || [];
      const profile = lead.quizProfileId
        ? profiles.find((p) => p.id === lead.quizProfileId)
        : null;
      const { beforeUrl, afterUrl } = await resolveLeadImageUrls(lead);
      return {
        id: String(lead.clientId),
        campaignLeadId: String(lead._id),
        name: lead.respondentName || client?.name || 'Sem nome',
        phone: client?.phone || lead.phoneDigits || '',
        pipelineStage: stage,
        leadTemperature: client?.leadTemperature || null,
        leadScore: client?.leadScore ?? null,
        category: client?.category || 'lead',
        capturedAt: lead.createdAt,
        hasSale: Boolean(sale),
        salesCount: sale?.count || 0,
        salesAmount: Math.round((sale?.amount || 0) * 100) / 100,
        quizProfileId: lead.quizProfileId || null,
        quizProfileTitle: profile?.title || null,
        quizProfileLaudo:
          lead.personalizedLaudo || profile?.laudo || profile?.description || null,
        quizProfileRecommendation:
          lead.personalizedRecommendation || profile?.recommendation || null,
        quizAnswers: Array.isArray(lead.quizAnswers) ? lead.quizAnswers : [],
        simulationStatus: lead.simulationStatus || 'none',
        beforeUrl,
        afterUrl,
        waSalesMessage: lead.waSalesMessage || '',
        simulationError: lead.simulationError || null,
      };
    })
  );

  const visits = campaign.visits || 0;
  const salesAmount = people.reduce((acc, p) => acc + (p.salesAmount || 0), 0);

  return {
    campaign: {
      id: String(campaign._id),
      title: campaign.title,
      status: campaign.status,
      leadMagnetType: campaign.leadMagnetType || 'ebook',
      diagnosisVariant: normalizeDiagnosisVariant(campaign.diagnosisVariant),
      publicSlug: campaign.publicSlug,
    },
    visits,
    leadsCount: people.length,
    conversionRate: visits > 0 ? Math.round((people.length / visits) * 1000) / 10 : 0,
    byStage,
    clientsWithSale: people.filter((p) => p.hasSale).length,
    salesCount: people.reduce((acc, p) => acc + p.salesCount, 0),
    salesAmount: Math.round(salesAmount * 100) / 100,
    metrics: campaign.metrics || {},
    people,
  };
}

async function createCampaign(userId, payload = {}) {
  const theme = payload.selectedTheme || null;
  const topic = theme?.title || payload.topic || payload.procedureName || 'estética';
  const title = payload.title || theme?.title || `Campanha: ${topic}`;
  const leadMagnetType = normalizeLeadMagnetType(
    payload.leadMagnetType || theme?.leadMagnetType || 'ebook'
  );
  const diagnosisVariant =
    leadMagnetType === 'diagnosis'
      ? normalizeDiagnosisVariant(payload.diagnosisVariant)
      : 'laudo';
  let slug = generatePublicSlug();
  // rare collision retry
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await Campaign.exists({ publicSlug: slug });
    if (!exists) break;
    slug = generatePublicSlug();
  }

  let content = null;
  let source = null;
  if (leadMagnetType === 'ebook') {
    content = heuristicCampaignContent(topic);
    source = 'heuristic';
  } else if (leadMagnetType !== 'quiz') {
    content = heuristicMagnetContent(leadMagnetType, topic);
    source = 'heuristic';
  }

  const owner = await User.findById(userId).select('phone').lean();

  const campaign = await Campaign.create({
    userId,
    title,
    topic,
    procedureName: payload.procedureName || '',
    procedureId: payload.procedureId || null,
    publicSlug: slug,
    status: 'draft',
    leadMagnetType,
    diagnosisVariant,
    contactWhatsApp: payload.contactWhatsApp || owner?.phone || '',
    couponCode:
      diagnosisVariant === 'simulation'
        ? ''
        : String(payload.couponCode || '').trim().slice(0, 40),
    couponPercent:
      diagnosisVariant === 'simulation'
        ? null
        : normalizeCouponPercent(payload.couponPercent),
    couponMessage:
      diagnosisVariant === 'simulation'
        ? ''
        : String(payload.couponMessage || '').trim().slice(0, 280),
    selectedTheme: theme,
    content,
    source,
  });

  return formatCampaign(campaign);
}

/** Quality gate local: métricas e avisos sobre o conteúdo gerado. */
function buildQualityReport(content, leadMagnetType) {
  const warnings = [];
  const report = { leadMagnetType, generatedAt: new Date().toISOString() };

  if (leadMagnetType === 'ebook') {
    const sections = content?.ebook?.sections || [];
    const wordCount = sections.reduce(
      (acc, s) => acc + String(s.body || '').split(/\s+/).filter(Boolean).length,
      0
    );
    report.sectionCount = sections.length;
    report.wordCount = wordCount;
    if (sections.length < 8) warnings.push(`eBook com apenas ${sections.length} capítulos (mínimo esperado: 8)`);
    sections.forEach((s, i) => {
      const words = String(s.body || '').split(/\s+/).filter(Boolean).length;
      if (words < 100) warnings.push(`Capítulo ${i + 1} ("${s.heading}") curto demais: ${words} palavras`);
    });
  }

  if (leadMagnetType === 'quiz' || leadMagnetType === 'diagnosis') {
    const screens = content?.quiz?.screens || [];
    const types = screens.map((s) => s.type);
    report.screenCount = screens.length;
    report.questionCount = types.filter((t) => t === 'question').length;
    report.profileCount = (content?.quiz?.resultProfiles || []).length;
    if (!types.includes('intro')) warnings.push('Funil sem tela de abertura');
    if (!types.includes('capture')) warnings.push('Funil sem tela de captura');
    if (!types.includes('result')) warnings.push('Funil sem tela de resultado');
    if (report.questionCount < 3) warnings.push(`Funil com poucas perguntas: ${report.questionCount}`);
    if (report.profileCount < 2) warnings.push('Menos de 2 perfis de resultado');
    if (leadMagnetType === 'diagnosis') {
      (content?.quiz?.resultProfiles || []).forEach((p, i) => {
        const words = String(p.laudo || '').split(/\s+/).filter(Boolean).length;
        if (words < 60) {
          warnings.push(`Laudo do perfil ${i + 1} ("${p.title || p.id}") curto demais: ${words} palavras`);
        }
      });
    }
  }

  if (leadMagnetType === 'checklist') {
    const items = content?.checklist?.items || [];
    report.itemCount = items.length;
    if (items.length < 5) warnings.push(`Checklist com poucos itens: ${items.length}`);
  }

  if (leadMagnetType === 'calculator') {
    report.inputCount = (content?.calculator?.inputs || []).length;
    report.packageCount = (content?.calculator?.packages || []).length;
    if (report.inputCount < 2) warnings.push('Calculadora com poucos inputs');
    if (report.packageCount < 2) warnings.push('Calculadora com poucos pacotes');
  }

  if (leadMagnetType === 'evaluation') {
    report.slotCount = (content?.evaluation?.slots || []).length;
    if (report.slotCount < 3) warnings.push(`Poucas vagas na fila: ${report.slotCount}`);
  }

  const landing = content?.landing || {};
  const missingNarrative = ['statusQuoScenes', 'tensionBody', 'insightBody', 'transformationBody', 'howItWorks']
    .filter((k) => !landing[k] || (Array.isArray(landing[k]) && !landing[k].length));
  if (missingNarrative.length) {
    warnings.push(`Landing sem blocos narrativos: ${missingNarrative.join(', ')}`);
  }

  const creatives = content?.adCreatives || [];
  const formats = creatives.map((c) => c.format).join(',');
  if (formats !== 'post,post,story') {
    warnings.push(`Criativos fora do padrão 2 Feed + 1 Story: [${formats}]`);
  }

  report.warnings = warnings;
  return report;
}

/**
 * Normaliza criativos para exatamente 2 Feed + 1 Story, na ordem post, post, story.
 */
function normalizeAdCreatives(creatives, topic) {
  const list = Array.isArray(creatives) ? creatives.filter((c) => c && c.headline) : [];
  const posts = list.filter((c) => c.format !== 'story');
  const stories = list.filter((c) => c.format === 'story');
  const fallbackPost = (n) => ({
    headline: `Material gratuito: ${topic}`,
    primaryText: `Baixe o material sobre ${topic} e entenda o que avaliar antes de decidir. (variação ${n})`,
    cta: 'Saiba mais',
    format: 'post',
    visualSuggestion: 'Mockup do material com fundo da cor da marca.',
  });
  const fallbackStory = () => ({
    headline: 'Arrasta pra cima',
    primaryText: `Você tem 1 minuto? Descubra o essencial sobre ${topic}.`,
    cta: 'Quero ver',
    format: 'story',
    visualSuggestion: 'Story 9:16 com pergunta em texto grande e sticker de link.',
  });

  const feed1 = { ...(posts[0] || fallbackPost(1)), format: 'post' };
  const feed2 = { ...(posts[1] || fallbackPost(2)), format: 'post' };
  const story = { ...(stories[0] || posts[2] || fallbackStory()), format: 'story' };
  return [feed1, feed2, story];
}

async function generateCampaignContent(userId, id) {
  const campaign = await Campaign.findOne({ _id: id, userId });
  if (!campaign) {
    const err = new Error('Campanha não encontrada');
    err.statusCode = 404;
    throw err;
  }

  const leadMagnetType = normalizeLeadMagnetType(campaign.leadMagnetType);
  const isLegacyStrict = leadMagnetType === 'ebook' || leadMagnetType === 'quiz';

  if (isLegacyStrict) {
    await ensureAgnoAvailable();
  }

  const { clinicName, procedures } = await buildClinicBrief(userId);
  const focusProcedures =
    leadMagnetType === 'calculator'
      ? proceduresForTopic(procedures, campaign.topic || campaign.procedureName || campaign.title)
      : procedures;

  const brief = {
    topic: campaign.topic || campaign.procedureName || campaign.title,
    procedureName: campaign.procedureName,
    title: campaign.title,
    clinicName,
    procedures: focusProcedures,
    catalogProcedures: focusProcedures,
    leadMagnetType,
    selectedTheme: campaign.selectedTheme || null,
  };

  if (leadMagnetType === 'calculator') {
    brief.calculatorRules =
      'OBRIGATÓRIO: input budget (essencial/completo/premium) por abrangência/regiões, SEM assustar com totais altos. ' +
      'TODOS os packages usam o MESMO priceHint “A partir de {valor-base do catálogo}”. ' +
      'Diferença entre planos = regiões/protocolo, não multiplicar o preço na tela. ' +
      'Campo regions = regiões FACIAIS (nunca norte/sul/bairro). match só {budget:[id]}. ' +
      'Mencione simulação sem compromisso. PROIBIDO perguntar região geográfica de atendimento. ' +
      `Tema único (${brief.topic}).`;
  }

  let content = null;
  let source = 'heuristic';
  try {
    let call;
    if (leadMagnetType === 'quiz') call = generateQuizCampaign;
    else if (leadMagnetType === 'ebook') call = generateCampaign;
    else if (leadMagnetType === 'diagnosis') {
      call = (payload) =>
        generateQuizCampaign({
          ...payload,
          campaignBrief: {
            ...(payload.campaignBrief || {}),
            leadMagnetType: 'diagnosis',
            diagnosisMode: true,
          },
        });
    } else {
      call = generateMagnetCampaign;
    }

    const res = await call({
      userId: String(userId),
      campaignBrief: brief,
      context: { clinicName, procedures: focusProcedures },
    });
    content = res?.data || null;
    source = res?.source || 'agno';
  } catch (err) {
    console.warn('[campaign] agno failed:', err.message);
    if (isLegacyStrict) {
      const e = new Error(
        'A IA não conseguiu gerar a campanha agora. Tente novamente em instantes.'
      );
      e.statusCode = 502;
      throw e;
    }
    content = heuristicMagnetContent(leadMagnetType, brief.topic, focusProcedures);
    source = 'heuristic';
  }

  if (!contentIsComplete(leadMagnetType, content)) {
    if (!isLegacyStrict) {
      content = heuristicMagnetContent(leadMagnetType, brief.topic, focusProcedures);
      source = 'heuristic';
    }
  }

  if (!contentIsComplete(leadMagnetType, content)) {
    const e = new Error('A IA retornou conteúdo incompleto. Tente gerar novamente.');
    e.statusCode = 502;
    throw e;
  }

  // eBook/quiz: sem material fraco silencioso
  if (isLegacyStrict && source === 'heuristic') {
    const e = new Error(
      'IA indisponível: o serviço de agentes respondeu com conteúdo simplificado. Verifique a chave do modelo e regenere.'
    );
    e.statusCode = 503;
    throw e;
  }

  // Diagnóstico: garantir laudo elaborado + tags internas (não exibidas no funil)
  if (leadMagnetType === 'diagnosis' && content?.quiz?.resultProfiles) {
    content.quiz.resultProfiles = content.quiz.resultProfiles.map((p) => {
      const title = String(p.title || 'seu perfil').trim();
      const description = String(p.description || '').trim();
      const recommendation = String(p.recommendation || '').trim();
      let laudo = String(p.laudo || '').trim();
      if (laudo.length < 180) {
        const bits = [description, laudo, recommendation].filter(Boolean);
        const core = bits.join(' ').trim() || `Suas respostas apontam para ${title}.`;
        laudo =
          `${core} ` +
          `O que isso revela na prática: dá para desenhar um caminho alinhado ao que você quer — ` +
          `sem chute e sem pressão. Adiar costuma alongar a dúvida (cada foto, cada comentário, cada evento). ` +
          `Agir agora é tirar a conversa do “será que?” e colocar no “faz sentido para mim?”. ` +
          `Na clínica, você alinha expectativa, timing e próximo passo com quem faz isso todo dia. ` +
          `O botão abaixo é o atalho: tire dúvidas e saia com clareza — mesmo que a decisão seja “ainda não”.`;
      }
      return {
        ...p,
        description: description || `Perfil alinhado ao que você busca em ${brief.topic || 'estética'}.`,
        recommendation:
          recommendation ||
          'Recomendamos uma conversa rápida com a especialista para alinhar o melhor caminho.',
        laudo,
        tags:
          Array.isArray(p.tags) && p.tags.length
            ? p.tags
            : [`perfil:${p.id || 'geral'}`],
      };
    });
  }

  if (leadMagnetType === 'calculator') {
    content = sanitizeCalculatorContent(content, brief.topic, focusProcedures);
  }
  if (leadMagnetType === 'checklist') {
    content = sanitizeChecklistContent(content, brief.topic);
  }
  if (leadMagnetType === 'evaluation') {
    content = sanitizeEvaluationContent(content, brief.topic);
  }

  content.adCreatives = normalizeAdCreatives(content.adCreatives, brief.topic);

  campaign.content = content;
  campaign.source = source;
  campaign.leadMagnetType = leadMagnetType;
  campaign.qualityReport = {
    ...buildQualityReport(content, leadMagnetType),
    promptVersion: content.promptVersion || null,
  };

  const generatedTitle =
    content.quiz?.title ||
    content.ebook?.title ||
    content.checklist?.title ||
    content.calculator?.title ||
    content.evaluation?.title;
  if (generatedTitle) {
    campaign.title = generatedTitle;
  }
  campaign.metrics = {
    ...(campaign.metrics || {}),
    generations: ((campaign.metrics || {}).generations || 0) + 1,
  };

  if (needsPdf(leadMagnetType)) {
    try {
      const ebookShape =
        leadMagnetType === 'checklist'
          ? checklistToEbookPdfShape(content.checklist)
          : content.ebook;
      if (ebookShape?.sections?.length) {
        const pdfBuffer = await buildEbookPdfBuffer(ebookShape, { clinicName });
        if (isR2Configured()) {
          const key = `campaigns/${userId}/${campaign._id}-${Date.now()}.pdf`;
          await putObject(key, pdfBuffer, 'application/pdf');
          campaign.pdfKey = key;
        }
      }
    } catch (err) {
      console.warn('[campaign] pdf/r2 failed:', err.message);
    }
  }

  await campaign.save();
  return withPdfUrl(formatCampaign(campaign));
}

async function updateCampaign(userId, id, payload = {}) {
  const campaign = await Campaign.findOne({ _id: id, userId });
  if (!campaign) {
    const err = new Error('Campanha não encontrada');
    err.statusCode = 404;
    throw err;
  }
  if (payload.title) campaign.title = payload.title;
  if (payload.content) campaign.content = payload.content;
  if (payload.contactWhatsApp !== undefined) {
    campaign.contactWhatsApp = String(payload.contactWhatsApp || '').trim();
  }
  if (payload.diagnosisVariant !== undefined) {
    campaign.diagnosisVariant = normalizeDiagnosisVariant(payload.diagnosisVariant);
  }
  if (payload.couponCode !== undefined) {
    campaign.couponCode =
      normalizeDiagnosisVariant(campaign.diagnosisVariant) === 'simulation'
        ? ''
        : String(payload.couponCode || '').trim().slice(0, 40);
  }
  if (payload.couponPercent !== undefined) {
    campaign.couponPercent =
      normalizeDiagnosisVariant(campaign.diagnosisVariant) === 'simulation'
        ? null
        : normalizeCouponPercent(payload.couponPercent);
  }
  if (payload.couponMessage !== undefined) {
    campaign.couponMessage =
      normalizeDiagnosisVariant(campaign.diagnosisVariant) === 'simulation'
        ? ''
        : String(payload.couponMessage || '').trim().slice(0, 280);
  }
  await campaign.save();
  return withPdfUrl(formatCampaign(campaign));
}

async function publishCampaign(userId, id) {
  const campaign = await Campaign.findOne({ _id: id, userId });
  if (!campaign) {
    const err = new Error('Campanha não encontrada');
    err.statusCode = 404;
    throw err;
  }
  const leadMagnetType = normalizeLeadMagnetType(campaign.leadMagnetType);
  if (!contentIsComplete(leadMagnetType, campaign.content)) {
    const err = new Error('Gere o conteúdo da campanha antes de publicar');
    err.statusCode = 400;
    throw err;
  }
  if (!isFunnelMagnet(leadMagnetType)) {
    const landing = campaign.content?.landing;
    if (!landing?.heroHeadline && !landing?.headline) {
      const err = new Error('Gere o conteúdo da campanha antes de publicar');
      err.statusCode = 400;
      throw err;
    }
  }
  campaign.status = 'published';
  campaign.publishedAt = new Date();
  await campaign.save();
  return withPdfUrl(formatCampaign(campaign));
}

async function deleteCampaign(userId, id) {
  const campaign = await Campaign.findOne({ _id: id, userId }).select('_id');
  if (!campaign) {
    const err = new Error('Campanha não encontrada');
    err.statusCode = 404;
    throw err;
  }

  await CampaignLead.deleteMany({ userId, campaignId: campaign._id });
  await Campaign.deleteOne({ _id: campaign._id, userId });
  return { deleted: true };
}

async function getPublicCampaign(slug) {
  const campaign = await Campaign.findOne({ publicSlug: slug, status: 'published' });
  if (!campaign) {
    const err = new Error('Campanha não encontrada');
    err.statusCode = 404;
    throw err;
  }
  campaign.visits = (campaign.visits || 0) + 1;
  await campaign.save();

  const user = await User.findById(campaign.userId).select('clinic name phone').lean();
  const clinicName = user?.clinic || user?.name || '';
  const landing = campaign.content?.landing || {};
  const ebook = campaign.content?.ebook || {};
  const quiz = campaign.content?.quiz || null;
  const checklist = campaign.content?.checklist || null;
  let calculator = campaign.content?.calculator || null;
  const evaluation = campaign.content?.evaluation || null;
  const leadMagnetType = normalizeLeadMagnetType(campaign.leadMagnetType);
  const contactWhatsApp = campaign.contactWhatsApp || user?.phone || '';
  const diagnosisVariant = normalizeDiagnosisVariant(campaign.diagnosisVariant);

  if (leadMagnetType === 'calculator' && calculator) {
    try {
      const { procedures } = await buildClinicBrief(campaign.userId);
      const topic = campaign.topic || campaign.procedureName || campaign.title;
      const sanitized = sanitizeCalculatorContent({ calculator }, topic, procedures);
      calculator = sanitized.calculator || calculator;
    } catch (err) {
      console.warn('[campaign] calculator public sanitize failed:', err.message);
    }
  }

  const showCoupon = Boolean(String(campaign.couponCode || '').trim()) && (
    leadMagnetType === 'calculator' ||
    (leadMagnetType === 'diagnosis' && diagnosisVariant !== 'simulation') ||
    leadMagnetType === 'checklist' ||
    leadMagnetType === 'ebook' ||
    leadMagnetType === 'quiz' ||
    leadMagnetType === 'evaluation'
  );

  return {
    title: campaign.title,
    clinicName,
    leadMagnetType,
    diagnosisVariant,
    contactWhatsApp,
    couponCode: showCoupon ? String(campaign.couponCode).trim() : undefined,
    couponPercent: showCoupon ? normalizeCouponPercent(campaign.couponPercent) : undefined,
    couponMessage: showCoupon
      ? String(campaign.couponMessage || '').trim() || undefined
      : undefined,
    landing: {
      // mantém todos os blocos narrativos vindos da IA
      ...landing,
      heroHeadline: landing.heroHeadline || landing.headline || campaign.title,
      heroSubheadline: landing.heroSubheadline || '',
      learnTitle: landing.learnTitle || 'O que você vai aprender',
      learnItems:
        landing.learnItems?.length
          ? landing.learnItems
          : (ebook.sections || []).map((s) => s.heading).filter(Boolean)
            .concat((checklist?.items || []).map((i) => i.text).filter(Boolean)),
      benefits: landing.benefits?.length ? landing.benefits : landing.bullets || [],
      formTitle: landing.formTitle || evaluation?.formTitle || 'Receba o material agora',
      ctaText: landing.ctaText || landing.cta || evaluation?.ctaText || 'Baixar grátis',
    },
    ebook: {
      title: ebook.title || checklist?.title || campaign.title,
      subtitle: ebook.subtitle || checklist?.subtitle || '',
      coverTagline: ebook.coverTagline || '',
    },
    quiz: isFunnelMagnet(leadMagnetType) ? quiz : undefined,
    checklist: leadMagnetType === 'checklist' ? checklist : undefined,
    calculator: leadMagnetType === 'calculator' ? calculator : undefined,
    evaluation: leadMagnetType === 'evaluation' ? evaluation : undefined,
  };
}

/**
 * Métricas do funil público (quiz_start, quiz_complete, result_view).
 */
async function trackPublicCampaignEvent(slug, type) {
  const allowed = { quiz_start: 'quizStarts', quiz_complete: 'quizCompletions', result_view: 'resultViews' };
  const key = allowed[type];
  if (!key) {
    const err = new Error('Evento inválido');
    err.statusCode = 400;
    throw err;
  }
  await Campaign.updateOne(
    { publicSlug: slug, status: 'published' },
    { $inc: { [`metrics.${key}`]: 1 } }
  );
  return { ok: true };
}

async function resolveCampaignPdfUrl(campaign) {
  if (!campaign.pdfKey || !isR2Configured()) return null;
  try {
    return await resolveReadUrl(campaign.pdfKey);
  } catch {
    return null;
  }
}

function duplicateCampaignLeadError(campaign, pdfUrl = null) {
  const err = new Error('Este WhatsApp já está cadastrado nesta campanha.');
  err.statusCode = 409;
  err.data = { alreadyRegistered: true, pdfUrl };
  return err;
}

async function submitPublicCampaignLead(slug, {
  phone,
  name,
  quizAnswers,
  quizProfileId,
  magnetPayload,
}) {
  const campaign = await Campaign.findOne({ publicSlug: slug, status: 'published' });
  if (!campaign) {
    const err = new Error('Campanha não encontrada');
    err.statusCode = 404;
    throw err;
  }
  const typedName = String(name || '').trim();
  if (!typedName) {
    const err = new Error('Informe seu nome.');
    err.statusCode = 400;
    throw err;
  }
  if (!isValidBrazilianPhone(phone)) {
    const err = new Error('Telefone inválido. Informe DDD + número.');
    err.statusCode = 400;
    throw err;
  }

  const phoneDigits = stripPhoneDigits(phone);
  const existingLead = await CampaignLead.findOne({
    campaignId: campaign._id,
    phoneDigits,
  }).select('_id clientId');

  if (existingLead) {
    const pdfUrl = await resolveCampaignPdfUrl(campaign);
    throw duplicateCampaignLeadError(campaign, pdfUrl);
  }

  let client = await findClientByPhone(Client, campaign.userId, phone);
  if (!client) {
    client = new Client({
      userId: campaign.userId,
      name: typedName || 'Lead campanha',
      phone: phoneDigits,
      category: 'lead',
      isNewClient: true,
      clientGroup: 'grupo_a',
      leadSource: 'outros',
      leadSourceOther: `Campanha: ${campaign.title}`.slice(0, 120),
      pipelineStage: 'new',
      sourceCampaignId: campaign._id,
    });
    await client.save();
  } else {
    let dirty = false;
    if (typedName && (!client.name || client.name.startsWith('Lead'))) {
      client.name = typedName;
      dirty = true;
    }
    // Preserva a primeira origem: só grava se o cliente ainda não tem nenhuma
    if (!client.sourceCampaignId && !client.sourceFormId) {
      client.sourceCampaignId = campaign._id;
      dirty = true;
    }
    if (dirty) await client.save();
  }

  const answers = Array.isArray(quizAnswers) ? quizAnswers.slice(0, 30) : [];
  const profiles = campaign.content?.quiz?.resultProfiles || [];
  const profile = quizProfileId
    ? profiles.find((p) => p.id === quizProfileId) || null
    : null;

  const payload = magnetPayload && typeof magnetPayload === 'object' ? magnetPayload : null;
  const leadMagnetType = normalizeLeadMagnetType(campaign.leadMagnetType);

  // Diagnóstico: personaliza laudo com IA a partir das respostas reais
  let resolvedProfile = profile
    ? {
        id: profile.id,
        title: profile.title,
        description: profile.description || '',
        recommendation: profile.recommendation || '',
        ctaText: profile.ctaText || 'Falar no WhatsApp',
        laudo: profile.laudo || profile.description || '',
        tags: Array.isArray(profile.tags) ? profile.tags : [],
      }
    : null;
  let personalizedFields = {
    personalizedLaudo: '',
    personalizedDescription: '',
    personalizedRecommendation: '',
  };

  if (leadMagnetType === 'diagnosis' && resolvedProfile && answers.length && isAgnoEnabled()) {
    try {
      const clinicUser = await User.findById(campaign.userId).select('name clinic').lean();
      const clinicName =
        clinicUser?.clinic || clinicUser?.name || 'a clínica';
      const res = await agnoPersonalizeDiagnosisLaudo({
        userId: String(campaign.userId),
        context: {
          clinicName,
          topic: campaign.topic || campaign.title || '',
          procedureName: campaign.procedureName || '',
          diagnosisVariant: normalizeDiagnosisVariant(campaign.diagnosisVariant),
          profile: {
            id: resolvedProfile.id,
            title: resolvedProfile.title,
            description: resolvedProfile.description,
            recommendation: resolvedProfile.recommendation,
          },
          answers: answers.map((a) => ({
            question: a?.question || a?.screenId || '',
            answer: a?.answer || '',
          })),
          couponCode: campaign.couponCode || '',
        },
      });
      const data = res?.data || {};
      const laudo = String(data.laudo || '').trim();
      if (laudo.length >= 80) {
        resolvedProfile = {
          ...resolvedProfile,
          description: String(data.description || '').trim() || resolvedProfile.description,
          laudo,
          recommendation:
            String(data.recommendation || '').trim() || resolvedProfile.recommendation,
          ctaText: String(data.ctaText || '').trim() || resolvedProfile.ctaText,
        };
        personalizedFields = {
          personalizedLaudo: resolvedProfile.laudo,
          personalizedDescription: resolvedProfile.description,
          personalizedRecommendation: resolvedProfile.recommendation,
        };
      }
    } catch (err) {
      console.warn('[campaign] diagnosis personalize failed:', err.message);
    }
  }

  // Diagnóstico: grava tags no qualification do lead
  if (leadMagnetType === 'diagnosis' && resolvedProfile) {
    const tags = Array.isArray(resolvedProfile.tags) ? resolvedProfile.tags : [];
    const laudo = resolvedProfile.laudo || resolvedProfile.description || '';
    const prev = client.qualification && typeof client.qualification === 'object'
      ? client.qualification
      : {};
    client.qualification = {
      ...prev,
      summary: laudo
        ? `Diagnóstico campanha: ${laudo}`.slice(0, 500)
        : prev.summary || '',
      nextStep: resolvedProfile.recommendation || prev.nextStep || '',
      campaignTags: tags,
      campaignProfileId: resolvedProfile.id || '',
      campaignProfileTitle: resolvedProfile.title || '',
    };
    await client.save();
  }

  // Calculadora: anota pacote sugerido
  if (leadMagnetType === 'calculator' && payload?.packageId) {
    const packages = campaign.content?.calculator?.packages || [];
    const pkg = packages.find((p) => p.id === payload.packageId);
    if (pkg) {
      const prev = client.qualification && typeof client.qualification === 'object'
        ? client.qualification
        : {};
      client.qualification = {
        ...prev,
        summary: `Calculadora: ${pkg.title} — ${pkg.summary || ''}`.slice(0, 500),
        nextStep: pkg.recommendation || prev.nextStep || 'Conversar sobre o pacote sugerido',
        suggestedPackageId: pkg.id,
        suggestedPackageTitle: pkg.title,
      };
      await client.save();
    }
  }

  // Avaliação: preferência de horário
  if (leadMagnetType === 'evaluation' && payload?.slotId) {
    const slots = campaign.content?.evaluation?.slots || [];
    const slot = slots.find((s) => s.id === payload.slotId);
    const prev = client.qualification && typeof client.qualification === 'object'
      ? client.qualification
      : {};
    client.qualification = {
      ...prev,
      summary: slot
        ? `Interesse em avaliação · ${slot.label || `${slot.day} ${slot.time}`}`.slice(0, 500)
        : 'Interesse em avaliação (fila da semana)',
      nextStep: 'Confirmar horário de avaliação no WhatsApp',
      preferredEvalSlot: slot?.label || payload.slotId,
    };
    if (leadMagnetType === 'evaluation') {
      client.pipelineStage = client.pipelineStage === 'new' ? 'qualified' : client.pipelineStage;
    }
    await client.save();
  }

  let campaignLeadId = null;
  let publicUploadToken = null;
  try {
    const leadDoc = {
      userId: campaign.userId,
      campaignId: campaign._id,
      clientId: client._id,
      phoneDigits,
      respondentName: typedName,
      quizAnswers: answers.length ? answers : null,
      quizProfileId: quizProfileId || null,
      magnetPayload: payload,
      simulationStatus: 'none',
      ...personalizedFields,
    };

    if (
      leadMagnetType === 'diagnosis' &&
      normalizeDiagnosisVariant(campaign.diagnosisVariant) === 'simulation'
    ) {
      const tok = createUploadToken();
      leadDoc.uploadTokenHash = tok.hash;
      leadDoc.uploadTokenExpiresAt = tok.expiresAt;
      publicUploadToken = tok.token;
    }

    const createdLead = await CampaignLead.create(leadDoc);
    campaignLeadId = String(createdLead._id);
  } catch (error) {
    if (error?.code === 11000) {
      const pdfUrl = await resolveCampaignPdfUrl(campaign);
      throw duplicateCampaignLeadError(campaign, pdfUrl);
    }
    throw error;
  }

  let activityContent = `Lead captado via campanha "${campaign.title}" (${leadMagnetType})`;
  if (answers.length) {
    const answerLines = answers
      .map((a) => `- ${a.question || a.screenId}: ${a.answer}`)
      .join('\n');
    activityContent += `\n\nRespostas:\n${answerLines}`;
  }
  if (resolvedProfile) {
    activityContent += `\n\nPerfil: ${resolvedProfile.title}`;
    if (resolvedProfile.laudo) activityContent += `\nLaudo: ${resolvedProfile.laudo}`;
    if (resolvedProfile.recommendation) {
      activityContent += `\nRecomendação: ${resolvedProfile.recommendation}`;
    }
    if (Array.isArray(resolvedProfile.tags) && resolvedProfile.tags.length) {
      activityContent += `\nTags: ${resolvedProfile.tags.join(', ')}`;
    }
  }
  if (payload?.packageId) {
    activityContent += `\n\nPacote calculadora: ${payload.packageTitle || payload.packageId}`;
  }
  if (payload?.slotId) {
    activityContent += `\n\nVaga preferida: ${payload.slotLabel || payload.slotId}`;
  }

  await logActivity({
    userId: campaign.userId,
    clientId: client._id,
    clientName: client.name,
    type: 'form_response',
    content: activityContent,
  });

  campaign.leadsCount = (campaign.leadsCount || 0) + 1;
  await campaign.save();

  // qualify in background
  setImmediate(() => {
    try {
      const { qualifyClient } = require('./commercialIntelligence.service');
      qualifyClient(campaign.userId, client._id, { force: true, advanceStage: false }).catch(() => {});
    } catch {
      /* ignore */
    }
  });

  const pdfUrl = await resolveCampaignPdfUrl(campaign);

  return {
    pdfUrl,
    clientId: String(client._id),
    leadId: campaignLeadId,
    uploadToken: publicUploadToken || undefined,
    profile: resolvedProfile,
    magnetPayload: payload,
    successNote:
      leadMagnetType === 'evaluation'
        ? (campaign.content?.evaluation?.successNote || null)
        : null,
  };
}

/**
 * Remove um lead da campanha e apaga o cliente da base (útil p/ limpar testes).
 * Também remove atividades e vendas ligadas ao cliente.
 */
async function removeCampaignLead(userId, campaignId, leadId) {
  const mongoose = require('mongoose');
  const Sale = require('../models/Sale');
  const ClientActivity = require('../models/ClientActivity');

  if (!mongoose.Types.ObjectId.isValid(campaignId) || !mongoose.Types.ObjectId.isValid(leadId)) {
    const err = new Error('ID inválido');
    err.statusCode = 400;
    throw err;
  }

  const campaign = await Campaign.findOne({ _id: campaignId, userId });
  if (!campaign) {
    const err = new Error('Campanha não encontrada');
    err.statusCode = 404;
    throw err;
  }

  const lead = await CampaignLead.findOneAndDelete({
    _id: leadId,
    campaignId: campaign._id,
    userId,
  });

  if (!lead) {
    const err = new Error('Lead da campanha não encontrado');
    err.statusCode = 404;
    throw err;
  }

  campaign.leadsCount = Math.max(0, (campaign.leadsCount || 0) - 1);
  await campaign.save();

  let clientDeleted = false;
  if (lead.clientId) {
    const client = await Client.findOneAndDelete({
      _id: lead.clientId,
      userId,
    });
    if (client) {
      clientDeleted = true;
      await Promise.all([
        ClientActivity.deleteMany({ userId, clientId: client._id }),
        Sale.deleteMany({ userId, clientId: client._id }),
        CampaignLead.deleteMany({ userId, clientId: client._id }),
      ]);
    }
  }

  return {
    campaignId: String(campaign._id),
    leadId: String(lead._id),
    clientId: lead.clientId ? String(lead.clientId) : null,
    clientDeleted,
    leadsCount: campaign.leadsCount || 0,
  };
}

module.exports = {
  listCampaigns,
  getCampaign,
  getCampaignStats,
  createCampaign,
  suggestCampaignThemes,
  generateCampaignContent,
  updateCampaign,
  publishCampaign,
  deleteCampaign,
  removeCampaignLead,
  getPublicCampaign,
  submitPublicCampaignLead,
  trackPublicCampaignEvent,
  formatCampaign,
  // exportado para testes
  normalizeAdCreatives,
  buildQualityReport,
};
