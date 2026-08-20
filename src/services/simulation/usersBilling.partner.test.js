const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizePartnerPlanTier } = require('./usersBilling');

describe('normalizePartnerPlanTier', () => {
  it('defaults to profissional when omitted', () => {
    assert.deepEqual(normalizePartnerPlanTier(undefined), { tier: 'profissional' });
    assert.deepEqual(normalizePartnerPlanTier(''), { tier: 'profissional' });
    assert.deepEqual(normalizePartnerPlanTier(null), { tier: 'profissional' });
  });

  it('requires planTier when required=true', () => {
    const r = normalizePartnerPlanTier(undefined, { required: true });
    assert.equal(r.error, 'planTier é obrigatório (gestao ou profissional)');
  });

  it('accepts gestao and profissional (case-insensitive)', () => {
    assert.deepEqual(normalizePartnerPlanTier('gestao'), { tier: 'gestao' });
    assert.deepEqual(normalizePartnerPlanTier('Gestao'), { tier: 'gestao' });
    assert.deepEqual(normalizePartnerPlanTier('profissional'), { tier: 'profissional' });
    assert.deepEqual(normalizePartnerPlanTier('PROFISSIONAL'), { tier: 'profissional' });
  });

  it('rejects invalid tiers', () => {
    const r = normalizePartnerPlanTier('enterprise');
    assert.equal(r.error, 'planTier inválido (use gestao ou profissional)');
  });
});

describe('updatePartnerTestUser export', () => {
  it('is exported from usersBilling', () => {
    const { updatePartnerTestUser } = require('./usersBilling');
    assert.equal(typeof updatePartnerTestUser, 'function');
  });
});
