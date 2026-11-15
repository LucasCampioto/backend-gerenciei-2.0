const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRouletteEntries,
  buildBoxesEntries,
  drawWeightedPrize,
  sanitizeGameContent,
  resolveGameDraw,
  normalizeGameVariant,
  heuristicGameContent,
} = require('./campaignGame');

test('normalizeGameVariant defaults to roulette', () => {
  assert.equal(normalizeGameVariant('boxes'), 'boxes');
  assert.equal(normalizeGameVariant('nope'), 'roulette');
});

test('buildRouletteEntries inclui jackpot com chance configurada', () => {
  const game = sanitizeGameContent(
    {
      prizes: [
        { id: 'a', label: '10% off', weight: 50 },
        { id: 'b', label: 'Brinde', weight: 50 },
      ],
      jackpot: { enabled: true, id: 'jackpot', label: 'VIP', chancePercent: 5 },
    },
    'botox',
    'roulette'
  );
  const entries = buildRouletteEntries(game);
  const jp = entries.find((e) => e.isJackpot);
  assert.ok(jp);
  assert.equal(jp.label, 'VIP');
  assert.equal(jp.weight, 5);
  const commons = entries.filter((e) => !e.isJackpot);
  const commonWeight = commons.reduce((a, e) => a + e.weight, 0);
  assert.ok(Math.abs(commonWeight - 95) < 0.01);
});

test('buildRouletteEntries ignora jackpot desligado', () => {
  const game = sanitizeGameContent(
    {
      prizes: [
        { id: 'a', label: '10% off', weight: 1 },
        { id: 'b', label: 'Brinde', weight: 1 },
      ],
      jackpot: { enabled: false, label: 'VIP', chancePercent: 5 },
    },
    'botox',
    'roulette'
  );
  const entries = buildRouletteEntries(game);
  assert.equal(entries.some((e) => e.isJackpot), false);
  assert.equal(entries.length, 2);
});

test('drawWeightedPrize sempre retorna id válido', () => {
  const entries = [
    { id: 'a', label: 'A', weight: 10, isJackpot: false },
    { id: 'b', label: 'B', weight: 90, isJackpot: false },
  ];
  for (let i = 0; i < 20; i += 1) {
    const won = drawWeightedPrize(entries, () => i / 20);
    assert.ok(['a', 'b'].includes(won.id));
  }
});

test('drawWeightedPrize com rng 0 pega o primeiro', () => {
  const entries = [
    { id: 'a', label: 'A', weight: 50, isJackpot: false },
    { id: 'b', label: 'B', weight: 50, isJackpot: false },
  ];
  assert.equal(drawWeightedPrize(entries, () => 0).id, 'a');
});

test('boxes entries não incluem jackpot', () => {
  const game = sanitizeGameContent(
    {
      prizes: [
        { id: 'a', label: '10% off', weight: 1 },
        { id: 'b', label: 'Brinde', weight: 1 },
      ],
      jackpot: { enabled: true, label: 'VIP', chancePercent: 5 },
    },
    'botox',
    'boxes'
  );
  const entries = buildBoxesEntries(game);
  assert.equal(entries.some((e) => e.isJackpot), false);
});

test('resolveGameDraw roleta retorna prize', () => {
  const content = heuristicGameContent('botox', 'roulette');
  const campaign = {
    gameVariant: 'roulette',
    topic: 'botox',
    title: 'Roleta',
    content,
  };
  const drawn = resolveGameDraw(campaign, {});
  assert.ok(drawn.prize.id);
  assert.ok(drawn.prize.label);
  assert.equal(drawn.magnetPayload.prizeId, drawn.prize.id);
  assert.equal(drawn.boxReveal, undefined);
});

test('resolveGameDraw boxes retorna boxReveal', () => {
  const content = heuristicGameContent('botox', 'boxes');
  const campaign = {
    gameVariant: 'boxes',
    topic: 'botox',
    title: 'Caixas',
    content,
  };
  const drawn = resolveGameDraw(campaign, { boxIndex: 2 });
  assert.ok(drawn.prize.id);
  assert.equal(drawn.boxReveal.selectedIndex, 2);
  assert.equal(drawn.boxReveal.labelsByIndex[2], drawn.prize.label);
  assert.equal(drawn.boxReveal.labelsByIndex.length, content.game.boxesCount);
});

test('heuristicGameContent completa', () => {
  const content = heuristicGameContent('preenchimento', 'roulette');
  assert.ok(content.game.prizes.length >= 2);
  assert.equal(content.game.jackpot.enabled, true);
  assert.ok(content.landing.heroHeadline);
});
