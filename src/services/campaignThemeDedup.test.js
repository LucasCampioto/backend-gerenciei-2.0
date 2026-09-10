const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  themesAreSimilar,
  filterDuplicateThemes,
  filterDuplicateLabels,
  uniqueLabels,
} = require('./campaignThemeDedup');

test('themesAreSimilar matches exact and accent-insensitive titles', () => {
  assert.equal(themesAreSimilar('Checklist: Botox', 'checklist botox'), true);
  assert.equal(themesAreSimilar('Passo a passo de design', 'Tutorial de vendas'), false);
});

test('themesAreSimilar detects substring overlap', () => {
  assert.equal(
    themesAreSimilar('design de sobrancelha personalizado', 'Design de sobrancelha'),
    true
  );
});

test('filterDuplicateThemes removes themes already used', () => {
  const themes = [
    { title: 'Tutorial: design de sobrancelha' },
    { title: 'Captação de clientes (para clínicas)' },
  ];
  const used = [{ label: 'Tutorial design de sobrancelha passo a passo' }];
  const filtered = filterDuplicateThemes(themes, used);
  assert.equal(filtered.length, 1);
  assert.ok(filtered[0].title.includes('Captação'));
});

test('filterDuplicateLabels and uniqueLabels', () => {
  const labels = ['Botox', 'botox', 'Toxina'];
  assert.deepEqual(uniqueLabels(labels), ['Botox', 'Toxina']);
  const kept = filterDuplicateLabels(['Vendas (para clínicas)', 'Botox'], [{ label: 'Botox' }]);
  assert.deepEqual(kept, ['Vendas (para clínicas)']);
});
