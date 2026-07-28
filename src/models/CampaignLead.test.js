const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const CampaignLead = require('./CampaignLead');

test('CampaignLead exige campaignId + phoneDigits únicos', () => {
  const indexes = CampaignLead.schema.indexes();
  const uniquePair = indexes.find(
    ([fields, options]) =>
      fields.campaignId === 1 &&
      fields.phoneDigits === 1 &&
      options?.unique === true
  );
  assert.ok(uniquePair, 'deve existir índice único { campaignId, phoneDigits }');
});

test('CampaignLead persiste campos esperados', () => {
  const userId = new mongoose.Types.ObjectId();
  const campaignId = new mongoose.Types.ObjectId();
  const clientId = new mongoose.Types.ObjectId();

  const doc = new CampaignLead({
    userId,
    campaignId,
    clientId,
    phoneDigits: '11999998888',
    respondentName: 'Maria',
    quizProfileId: 'perfil-a',
  });

  const obj = doc.toObject();
  assert.equal(obj.phoneDigits, '11999998888');
  assert.equal(obj.respondentName, 'Maria');
  assert.equal(String(obj.campaignId), String(campaignId));
});
