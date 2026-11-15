/**
 * Lead magnet "Jogos": roleta + escolha a caixa.
 * Sorteio ponderado no servidor (anti-fraude); jackpot só na roleta.
 */

const GAME_VARIANTS = ['roulette', 'boxes'];
const JACKPOT_CHANCE_MIN = 2;
const JACKPOT_CHANCE_MAX = 12;
const JACKPOT_CHANCE_DEFAULT = 5;
const BOXES_COUNT_MIN = 3;
const BOXES_COUNT_MAX = 8;
const BOXES_COUNT_DEFAULT = 6;

const DEFAULT_PRIZE_COLORS = [
  '#E11D48',
  '#DB2777',
  '#C026D3',
  '#9333EA',
  '#7C3AED',
  '#4F46E5',
  '#2563EB',
  '#0891B2',
];

function normalizeGameVariant(value) {
  const v = String(value || 'roulette').toLowerCase().trim();
  return GAME_VARIANTS.includes(v) ? v : 'roulette';
}

function clampJackpotChance(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return JACKPOT_CHANCE_DEFAULT;
  return Math.min(JACKPOT_CHANCE_MAX, Math.max(JACKPOT_CHANCE_MIN, Math.round(n)));
}

function clampBoxesCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return BOXES_COUNT_DEFAULT;
  return Math.min(BOXES_COUNT_MAX, Math.max(BOXES_COUNT_MIN, Math.round(n)));
}

function makePrizeId(prefix, index) {
  return `${prefix}-${index + 1}`;
}

function normalizePrize(raw, index, prefix = 'prize') {
  if (!raw || typeof raw !== 'object') return null;
  const label = String(raw.label || '').trim();
  if (!label) return null;
  const weight = Number(raw.weight);
  const id = String(raw.id || makePrizeId(prefix, index)).trim() || makePrizeId(prefix, index);
  const color =
    typeof raw.color === 'string' && raw.color.trim()
      ? raw.color.trim()
      : DEFAULT_PRIZE_COLORS[index % DEFAULT_PRIZE_COLORS.length];
  return {
    id,
    label: label.slice(0, 80),
    weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
    color,
  };
}

function normalizeJackpot(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      enabled: true,
      id: 'jackpot',
      label: 'Prêmio especial VIP',
      chancePercent: JACKPOT_CHANCE_DEFAULT,
    };
  }
  const enabled = raw.enabled !== false;
  const label = String(raw.label || '').trim().slice(0, 80);
  return {
    enabled,
    id: String(raw.id || 'jackpot').trim() || 'jackpot',
    label: label || 'Prêmio especial VIP',
    chancePercent: clampJackpotChance(raw.chancePercent),
  };
}

function sanitizeGameContent(game, topic = 'estética', gameVariant = 'roulette') {
  const variant = normalizeGameVariant(gameVariant);
  const t = String(topic || 'estética').trim() || 'estética';
  const base = heuristicGameBlock(t, variant);
  const incoming = game && typeof game === 'object' ? game : {};

  const prizesRaw = Array.isArray(incoming.prizes) ? incoming.prizes : base.prizes;
  let prizes = prizesRaw
    .map((p, i) => normalizePrize(p, i))
    .filter(Boolean);
  if (prizes.length < 2) {
    prizes = base.prizes.map((p, i) => normalizePrize(p, i)).filter(Boolean);
  }

  const jackpot = normalizeJackpot(incoming.jackpot ?? base.jackpot);
  const boxesCount = clampBoxesCount(incoming.boxesCount ?? base.boxesCount);

  return {
    title: String(incoming.title || base.title || `Roleta de ${t}`).trim().slice(0, 120),
    headline: String(incoming.headline || base.headline || '').trim().slice(0, 200),
    playCta: String(
      incoming.playCta || base.playCta || (variant === 'boxes' ? 'Abrir caixa' : 'Girar')
    )
      .trim()
      .slice(0, 40),
    prizes,
    jackpot,
    boxesCount,
    colors: Array.isArray(incoming.colors) ? incoming.colors : undefined,
  };
}

function heuristicGameBlock(topic, gameVariant = 'roulette') {
  const t = topic || 'estética';
  const variant = normalizeGameVariant(gameVariant);
  return {
    title: variant === 'boxes' ? `Escolha a caixa · ${t}` : `Roleta da sorte · ${t}`,
    headline:
      variant === 'boxes'
        ? 'Deixe seu WhatsApp, escolha uma caixa e descubra seu prêmio'
        : 'Deixe seu WhatsApp, gire a roleta e ganhe um prêmio na hora',
    playCta: variant === 'boxes' ? 'Abrir caixa' : 'Girar a roleta',
    prizes: [
      { id: 'prize-1', label: `10% off em ${t}`, weight: 30, color: DEFAULT_PRIZE_COLORS[0] },
      { id: 'prize-2', label: 'Consulta / avaliação com desconto', weight: 25, color: DEFAULT_PRIZE_COLORS[1] },
      { id: 'prize-3', label: 'Kit de cuidados pós-procedimento', weight: 25, color: DEFAULT_PRIZE_COLORS[2] },
      { id: 'prize-4', label: 'Brinde da clínica', weight: 20, color: DEFAULT_PRIZE_COLORS[3] },
    ],
    jackpot: {
      enabled: true,
      id: 'jackpot',
      label: `Avaliação VIP + 50% off em ${t}`,
      chancePercent: JACKPOT_CHANCE_DEFAULT,
    },
    boxesCount: BOXES_COUNT_DEFAULT,
  };
}

function heuristicGameContent(topic, gameVariant = 'roulette') {
  const t = topic || 'estética';
  const variant = normalizeGameVariant(gameVariant);
  const game = sanitizeGameContent(heuristicGameBlock(t, variant), t, variant);
  return {
    game,
    landing: {
      heroHeadline: game.title,
      heroSubheadline: game.headline,
      formTitle: 'Deixe seu WhatsApp para jogar',
      ctaText: game.playCta,
      learnTitle: 'Como funciona',
      learnItems: [
        'Informe nome e WhatsApp',
        variant === 'boxes' ? 'Escolha uma caixa' : 'Gire a roleta',
        'Receba seu prêmio na hora',
      ],
      benefits: ['Prêmio na hora', 'Só uma jogada por WhatsApp', 'Ideal para eventos'],
      urgencyNote: 'Válido enquanto o evento / campanha estiver no ar.',
      painTitle: 'Por que jogar?',
      painPoints: [
        'Você está no evento e quer um incentivo real',
        'Prefere algo divertido antes de conversar com a clínica',
      ],
      howItWorksTitle: 'Passo a passo',
      howItWorks: [
        'Preencha nome e WhatsApp',
        variant === 'boxes' ? 'Toque na caixa da sorte' : 'Toque em girar',
        'Mostre o prêmio na recepção / WhatsApp',
      ],
      faq: [
        {
          question: 'Posso jogar mais de uma vez?',
          answer: 'Cada WhatsApp joga uma vez nesta campanha.',
        },
        {
          question: 'O prêmio é garantido?',
          answer: 'Sim — você sempre ganha um dos prêmios configurados pela clínica.',
        },
      ],
      trustPoints: ['Captura segura', 'Prêmio sorteado na hora', 'Clínica real'],
      headline: game.title,
      bullets: game.prizes.map((p) => p.label),
      cta: game.playCta,
    },
    adCreatives: [
      {
        headline: game.title,
        primaryText: `${game.headline} — ideal para eventos e estandes.`,
        cta: 'Quero jogar',
        format: 'post',
        visualSuggestion: 'Tablet com a roleta/caixas e pessoas no estande.',
      },
      {
        headline: 'Ganhe um prêmio no estande',
        primaryText: `Participe da campanha de ${t} e saia com um incentivo.`,
        cta: 'Participar',
        format: 'post',
        visualSuggestion: 'Close da tela do jogo com CTA.',
      },
      {
        headline: 'Sorte no evento',
        primaryText: 'Gire ou escolha — prêmio na hora.',
        cta: 'Jogar',
        format: 'story',
        visualSuggestion: 'Story 9:16 com a roleta girando.',
      },
    ],
    audienceSuggestion: `Visitantes de evento interessados em ${t}.`,
  };
}

/**
 * Entradas ponderadas para a roleta (jackpot + comuns).
 * Pesos em “pontos” proporcionais à chance % (soma ~100).
 */
function buildRouletteEntries(game) {
  const g = game && typeof game === 'object' ? game : {};
  const prizes = (Array.isArray(g.prizes) ? g.prizes : [])
    .map((p, i) => normalizePrize(p, i))
    .filter(Boolean);
  const jackpot = normalizeJackpot(g.jackpot);
  const entries = [];

  let jackpotChance = 0;
  if (jackpot.enabled && jackpot.label) {
    jackpotChance = clampJackpotChance(jackpot.chancePercent);
    entries.push({
      id: jackpot.id,
      label: jackpot.label,
      weight: jackpotChance,
      isJackpot: true,
      color: '#F59E0B',
    });
  }

  const remaining = Math.max(0, 100 - jackpotChance);
  const weightSum = prizes.reduce((acc, p) => acc + p.weight, 0) || 1;
  prizes.forEach((p) => {
    const share = (p.weight / weightSum) * remaining;
    entries.push({
      id: p.id,
      label: p.label,
      weight: Math.max(0.01, share),
      isJackpot: false,
      color: p.color,
    });
  });

  return entries;
}

/** Entradas para caixas: só prêmios comuns (sem fatia jackpot). */
function buildBoxesEntries(game) {
  const g = game && typeof game === 'object' ? game : {};
  return (Array.isArray(g.prizes) ? g.prizes : [])
    .map((p, i) => normalizePrize(p, i))
    .filter(Boolean)
    .map((p) => ({
      id: p.id,
      label: p.label,
      weight: p.weight,
      isJackpot: false,
      color: p.color,
    }));
}

function drawWeightedPrize(entries, rng = Math.random) {
  const list = Array.isArray(entries) ? entries.filter((e) => e && e.weight > 0) : [];
  if (!list.length) {
    const err = new Error('Campanha de jogo sem prêmios válidos.');
    err.statusCode = 400;
    throw err;
  }
  const total = list.reduce((acc, e) => acc + e.weight, 0);
  let r = rng() * total;
  for (let i = 0; i < list.length; i += 1) {
    r -= list[i].weight;
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}

function assertGamePlayable(game, gameVariant) {
  const variant = normalizeGameVariant(gameVariant);
  const entries =
    variant === 'boxes' ? buildBoxesEntries(game) : buildRouletteEntries(game);
  if (entries.length < 2) {
    const err = new Error('Configure pelo menos 2 prêmios para publicar o jogo.');
    err.statusCode = 400;
    throw err;
  }
  if (variant === 'roulette') {
    const jackpot = normalizeJackpot(game?.jackpot);
    if (jackpot.enabled && !String(jackpot.label || '').trim()) {
      const err = new Error('Informe o texto do prêmio especial (jackpot).');
      err.statusCode = 400;
      throw err;
    }
  }
  return entries;
}

/**
 * Monta labels das caixas para o reveal (escolhida = prêmio real; demais embaralhadas).
 */
function buildBoxReveal(game, selectedIndex, wonEntry, rng = Math.random) {
  const boxesCount = clampBoxesCount(game?.boxesCount);
  const idx = Number(selectedIndex);
  const safeIndex =
    Number.isFinite(idx) && idx >= 0 && idx < boxesCount ? Math.floor(idx) : 0;

  const others = buildBoxesEntries(game)
    .filter((e) => e.id !== wonEntry.id)
    .map((e) => e.label);

  // preenche até boxesCount-1 labels “falsos”
  while (others.length < boxesCount - 1) {
    others.push(wonEntry.label);
  }

  // shuffle
  for (let i = others.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }

  const labelsByIndex = [];
  let oi = 0;
  for (let i = 0; i < boxesCount; i += 1) {
    if (i === safeIndex) labelsByIndex.push(wonEntry.label);
    else {
      labelsByIndex.push(others[oi] || 'Brinde');
      oi += 1;
    }
  }

  return { selectedIndex: safeIndex, labelsByIndex, boxesCount };
}

function resolveGameDraw(campaign, magnetPayload) {
  const variant = normalizeGameVariant(campaign.gameVariant);
  const game = sanitizeGameContent(
    campaign.content?.game,
    campaign.topic || campaign.title,
    variant
  );
  const entries = assertGamePlayable(game, variant);
  const won = drawWeightedPrize(entries);

  const result = {
    prize: {
      id: won.id,
      label: won.label,
      isJackpot: Boolean(won.isJackpot),
    },
    magnetPayload: {
      gameVariant: variant,
      prizeId: won.id,
      prizeLabel: won.label,
      isJackpot: Boolean(won.isJackpot),
      weightsSnapshot: entries.map((e) => ({
        id: e.id,
        weight: Math.round(e.weight * 100) / 100,
        isJackpot: Boolean(e.isJackpot),
      })),
    },
    boxReveal: undefined,
  };

  if (variant === 'boxes') {
    const reveal = buildBoxReveal(game, magnetPayload?.boxIndex, won);
    result.magnetPayload.boxIndex = reveal.selectedIndex;
    result.boxReveal = {
      selectedIndex: reveal.selectedIndex,
      labelsByIndex: reveal.labelsByIndex,
    };
  }

  return result;
}

function gameContentIsComplete(content) {
  const game = content?.game;
  if (!game) return false;
  const prizes = (Array.isArray(game.prizes) ? game.prizes : [])
    .map((p, i) => normalizePrize(p, i))
    .filter(Boolean);
  return prizes.length >= 2;
}

module.exports = {
  GAME_VARIANTS,
  JACKPOT_CHANCE_MIN,
  JACKPOT_CHANCE_MAX,
  JACKPOT_CHANCE_DEFAULT,
  BOXES_COUNT_DEFAULT,
  normalizeGameVariant,
  clampJackpotChance,
  clampBoxesCount,
  sanitizeGameContent,
  heuristicGameContent,
  heuristicGameBlock,
  buildRouletteEntries,
  buildBoxesEntries,
  drawWeightedPrize,
  assertGamePlayable,
  buildBoxReveal,
  resolveGameDraw,
  gameContentIsComplete,
};
