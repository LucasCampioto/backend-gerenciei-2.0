const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAdCreatives, buildQualityReport } = require('./campaign.service');
const { richCampaignContent } = require('../testFixtures/campaignContent.fixture');

test('normalizeAdCreatives sempre devolve exatamente post, post, story', () => {
  const cases = [
    [],
    [{ headline: 'a', primaryText: 'x', cta: 'c', format: 'story' }],
    [
      { headline: 'a', primaryText: 'x', cta: 'c', format: 'post' },
      { headline: 'b', primaryText: 'y', cta: 'c', format: 'post' },
      { headline: 'c', primaryText: 'z', cta: 'c', format: 'post' },
    ],
    richCampaignContent.adCreatives,
  ];
  for (const input of cases) {
    const out = normalizeAdCreatives(input, 'botox');
    assert.equal(out.length, 3);
    assert.deepEqual(out.map((c) => c.format), ['post', 'post', 'story']);
    out.forEach((c) => assert.ok(c.headline && c.primaryText));
  }
});

test('buildQualityReport aprova o golden fixture de quiz sem avisos estruturais', () => {
  const report = buildQualityReport(richCampaignContent, 'quiz');
  assert.equal(report.screenCount, 6);
  assert.equal(report.questionCount, 2); // fixture tem 2 perguntas → deve avisar
  assert.equal(report.profileCount, 3);
  assert.ok(report.warnings.some((w) => w.includes('poucas perguntas')));
  // funil completo: intro/captura/resultado presentes → sem avisos sobre eles
  assert.ok(!report.warnings.some((w) => w.includes('sem tela')));
});

test('buildQualityReport avisa sobre eBook raso e criativos fora do padrão', () => {
  const weak = {
    ebook: { sections: [{ heading: 'Só um', body: 'curto demais' }] },
    landing: {},
    adCreatives: [{ headline: 'x', format: 'story' }],
  };
  const report = buildQualityReport(weak, 'ebook');
  assert.ok(report.warnings.some((w) => w.includes('capítulos')));
  assert.ok(report.warnings.some((w) => w.includes('curto demais')));
  assert.ok(report.warnings.some((w) => w.includes('blocos narrativos')));
  assert.ok(report.warnings.some((w) => w.includes('2 Feed + 1 Story')));
});

test('buildQualityReport não gera avisos narrativos para o golden fixture de landing', () => {
  const report = buildQualityReport(richCampaignContent, 'ebook');
  assert.ok(!report.warnings.some((w) => w.includes('blocos narrativos')));
  assert.ok(!report.warnings.some((w) => w.includes('2 Feed + 1 Story')));
});
