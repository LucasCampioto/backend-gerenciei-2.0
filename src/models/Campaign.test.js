const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Campaign = require('./Campaign');
const {
  richCampaignContent,
  richSelectedTheme,
} = require('../testFixtures/campaignContent.fixture');

/**
 * Round-trip de casting do Mongoose (sem banco): garante que nenhum campo rico
 * do conteúdo gerado pela IA é descartado pelo schema (regressão do bug em que
 * `strict` derrubava bullets, tip, heroHeadline, format etc.).
 */
test('Campaign preserva integralmente o conteúdo rico (eBook, landing, quiz, ads)', () => {
  const doc = new Campaign({
    userId: new mongoose.Types.ObjectId(),
    title: 'Campanha teste',
    publicSlug: 'slug-teste',
    leadMagnetType: 'quiz',
    selectedTheme: richSelectedTheme,
    content: richCampaignContent,
    qualityReport: { wordCount: 2400, warnings: ['exemplo'], promptVersion: 'campaign-v2' },
    metrics: { quizStarts: 3, quizCompletions: 1 },
  });

  const obj = doc.toObject();

  assert.deepEqual(obj.content, richCampaignContent);
  assert.deepEqual(obj.selectedTheme, richSelectedTheme);
  assert.equal(obj.leadMagnetType, 'quiz');
  assert.deepEqual(obj.qualityReport.warnings, ['exemplo']);
  assert.equal(obj.metrics.quizStarts, 3);

  // campos que o schema antigo descartava
  assert.equal(obj.content.ebook.sections[0].tip, richCampaignContent.ebook.sections[0].tip);
  assert.deepEqual(obj.content.ebook.sections[0].bullets, richCampaignContent.ebook.sections[0].bullets);
  assert.equal(obj.content.ebook.coverTagline, richCampaignContent.ebook.coverTagline);
  assert.equal(obj.content.landing.heroHeadline, richCampaignContent.landing.heroHeadline);
  assert.deepEqual(obj.content.landing.faq, richCampaignContent.landing.faq);
  assert.equal(obj.content.adCreatives[2].format, 'story');
  assert.equal(obj.content.quiz.screens.length, 6);
  assert.deepEqual(
    obj.content.quiz.screens[1].question.options[0].weights,
    { natural: 2, prevencao: 1 }
  );
});

test('Campaign rejeita leadMagnetType inválido', () => {
  const doc = new Campaign({
    userId: new mongoose.Types.ObjectId(),
    title: 'Campanha teste',
    publicSlug: 'slug-teste-2',
    leadMagnetType: 'video',
  });
  const err = doc.validateSync();
  assert.ok(err && err.errors.leadMagnetType);
});
