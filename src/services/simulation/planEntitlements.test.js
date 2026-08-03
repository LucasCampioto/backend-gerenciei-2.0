const { describe, it, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolvePlanTierFromPriceId,
  resolvePlanTier,
  planHasFeature,
  FEATURES_BY_TIER,
} = require('./planEntitlements');

describe('planEntitlements', () => {
  const prev = process.env.PLAN_TIER_BY_PRICE_ID;

  after(() => {
    if (prev === undefined) delete process.env.PLAN_TIER_BY_PRICE_ID;
    else process.env.PLAN_TIER_BY_PRICE_ID = prev;
  });

  beforeEach(() => {
    process.env.PLAN_TIER_BY_PRICE_ID = JSON.stringify({
      price_gestao_m: 'gestao',
      price_pro_m: 'profissional',
      price_legado_m: 'legado',
      price_ent: 'enterprise',
    });
  });

  it('resolvePlanTierFromPriceId maps known prices', () => {
    assert.equal(resolvePlanTierFromPriceId('price_gestao_m'), 'gestao');
    assert.equal(resolvePlanTierFromPriceId('price_pro_m'), 'profissional');
    assert.equal(resolvePlanTierFromPriceId('price_legado_m'), 'legado');
    assert.equal(resolvePlanTierFromPriceId('price_unknown'), null);
  });

  it('resolvePlanTier prefers priceId over stored', () => {
    assert.equal(
      resolvePlanTier({ planTier: 'profissional', stripeSubscriptionId: 'sub_x' }, 'price_gestao_m'),
      'gestao',
    );
  });

  it('resolvePlanTier uses stored tier when no price map', () => {
    assert.equal(resolvePlanTier({ planTier: 'profissional' }), 'profissional');
  });

  it('planHasFeature: gestao blocks AI and CRM', () => {
    assert.equal(planHasFeature('gestao', 'ops'), true);
    assert.equal(planHasFeature('gestao', 'pricing_simulator'), true);
    assert.equal(planHasFeature('gestao', 'ai_simulation'), false);
    assert.equal(planHasFeature('gestao', 'whatsapp'), false);
    assert.equal(planHasFeature('gestao', 'crm'), false);
    assert.equal(planHasFeature('gestao', 'marketing'), false);
  });

  it('planHasFeature: profissional/legado/enterprise have full set', () => {
    for (const tier of ['profissional', 'legado', 'enterprise']) {
      for (const f of FEATURES_BY_TIER.profissional) {
        assert.equal(planHasFeature(tier, f), true);
      }
    }
  });

  it('resolvePlanTier: partner_test gets full app', () => {
    assert.equal(resolvePlanTier({ accountType: 'partner_test' }), 'profissional');
  });

  it('resolvePlanTier: bypass respects planTier override', () => {
    const prev = process.env.SUBSCRIPTION_BYPASS_USER_IDS;
    process.env.SUBSCRIPTION_BYPASS_USER_IDS = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    try {
      assert.equal(
        resolvePlanTier({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', planTier: 'gestao' }),
        'gestao',
      );
      assert.equal(
        resolvePlanTier({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }),
        'profissional',
      );
    } finally {
      if (prev === undefined) delete process.env.SUBSCRIPTION_BYPASS_USER_IDS;
      else process.env.SUBSCRIPTION_BYPASS_USER_IDS = prev;
    }
  });
});
