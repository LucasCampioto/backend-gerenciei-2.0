const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isSubscriptionEligibleForQuotaRenewal,
  isQuotaRecoveryTransition,
  getSubscriptionLockState,
} = require('./subscriptionAccess');
const { buildQuotaPeriodResetSet } = require('./simulationQuotas');

describe('isSubscriptionEligibleForQuotaRenewal', () => {
  const base = {
    accountType: 'official',
    stripeSubscriptionId: 'sub_123',
    subscriptionStatus: 'active',
  };

  it('returns true for official active subscription', () => {
    assert.equal(isSubscriptionEligibleForQuotaRenewal(base), true);
  });

  it('returns false for trialing', () => {
    assert.equal(
      isSubscriptionEligibleForQuotaRenewal({ ...base, subscriptionStatus: 'trialing' }),
      false
    );
  });

  it('returns false for canceled', () => {
    assert.equal(
      isSubscriptionEligibleForQuotaRenewal({ ...base, subscriptionStatus: 'canceled' }),
      false
    );
  });

  it('returns true for bypass admin even when canceled', () => {
    const prev = process.env.SUBSCRIPTION_BYPASS_USER_IDS;
    process.env.SUBSCRIPTION_BYPASS_USER_IDS = '69e7860a6265eab8b0fc6718';
    try {
      assert.equal(
        isSubscriptionEligibleForQuotaRenewal({
          _id: '69e7860a6265eab8b0fc6718',
          accountType: 'official',
          subscriptionStatus: 'canceled',
          stripeSubscriptionId: 'sub_123',
        }),
        true
      );
    } finally {
      if (prev === undefined) delete process.env.SUBSCRIPTION_BYPASS_USER_IDS;
      else process.env.SUBSCRIPTION_BYPASS_USER_IDS = prev;
    }
  });

  it('returns false for past_due', () => {
    assert.equal(
      isSubscriptionEligibleForQuotaRenewal({ ...base, subscriptionStatus: 'past_due' }),
      false
    );
  });

  it('returns false for partner_test', () => {
    assert.equal(
      isSubscriptionEligibleForQuotaRenewal({
        ...base,
        accountType: 'partner_test',
        stripeSubscriptionId: '',
      }),
      false
    );
  });

  it('returns false without stripeSubscriptionId', () => {
    assert.equal(
      isSubscriptionEligibleForQuotaRenewal({ ...base, stripeSubscriptionId: '' }),
      false
    );
  });
});

describe('isQuotaRecoveryTransition', () => {
  it('returns true for past_due to active', () => {
    assert.equal(isQuotaRecoveryTransition('past_due', 'active'), true);
  });

  it('returns true for unpaid to active', () => {
    assert.equal(isQuotaRecoveryTransition('unpaid', 'active'), true);
  });

  it('returns false for active to active', () => {
    assert.equal(isQuotaRecoveryTransition('active', 'active'), false);
  });

  it('returns false for canceled to active', () => {
    assert.equal(isQuotaRecoveryTransition('canceled', 'active'), false);
  });
});

describe('buildQuotaPeriodResetSet', () => {
  const periodKey = '2026-06';

  it('updates only preview when simulation period is current', () => {
    const set = buildQuotaPeriodResetSet(
      {
        simulationQuotaPeriodKey: '2026-06',
        simulationMonthlyQuota: 40,
        previewQuotaPeriodKey: '2026-05',
        previewMonthlyQuota: 20,
      },
      periodKey
    );
    assert.deepEqual(set, {
      previewCreditsRemaining: 20,
      previewQuotaPeriodKey: '2026-06',
    });
  });

  it('updates both when both periods are stale', () => {
    const set = buildQuotaPeriodResetSet(
      {
        simulationQuotaPeriodKey: '2026-05',
        simulationMonthlyQuota: 40,
        previewQuotaPeriodKey: '2026-05',
        previewMonthlyQuota: 20,
      },
      periodKey
    );
    assert.deepEqual(set, {
      simulationCreditsRemaining: 40,
      simulationQuotaPeriodKey: '2026-06',
      previewCreditsRemaining: 20,
      previewQuotaPeriodKey: '2026-06',
    });
  });

  it('returns empty object when both periods are current', () => {
    const set = buildQuotaPeriodResetSet(
      {
        simulationQuotaPeriodKey: '2026-06',
        previewQuotaPeriodKey: '2026-06',
      },
      periodKey
    );
    assert.deepEqual(set, {});
  });
});

describe('getSubscriptionLockState gate total', () => {
  it('locks official user without subscription', () => {
    const state = getSubscriptionLockState({
      accountType: 'official',
      subscriptionStatus: '',
      stripeSubscriptionId: '',
    });
    assert.equal(state.locked, true);
    assert.equal(state.code, 'SUBSCRIPTION_REQUIRED');
  });

  it('allows active subscription', () => {
    const state = getSubscriptionLockState({
      accountType: 'official',
      subscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_1',
    });
    assert.equal(state.locked, false);
  });

  it('allows trialing', () => {
    const state = getSubscriptionLockState({
      accountType: 'official',
      subscriptionStatus: 'trialing',
      stripeSubscriptionId: 'sub_1',
    });
    assert.equal(state.locked, false);
  });

  it('locks past_due', () => {
    const state = getSubscriptionLockState({
      accountType: 'official',
      subscriptionStatus: 'past_due',
      stripeSubscriptionId: 'sub_1',
    });
    assert.equal(state.locked, true);
    assert.equal(state.code, 'PAYMENT_OVERDUE');
  });

  it('bypass never locks', () => {
    const prev = process.env.SUBSCRIPTION_BYPASS_USER_IDS;
    process.env.SUBSCRIPTION_BYPASS_USER_IDS = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    try {
      const state = getSubscriptionLockState({
        _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        accountType: 'official',
        subscriptionStatus: '',
        stripeSubscriptionId: '',
      });
      assert.equal(state.locked, false);
    } finally {
      if (prev === undefined) delete process.env.SUBSCRIPTION_BYPASS_USER_IDS;
      else process.env.SUBSCRIPTION_BYPASS_USER_IDS = prev;
    }
  });

  it('partner_test without stripe is not subscription-locked', () => {
    const state = getSubscriptionLockState({
      accountType: 'partner_test',
      subscriptionStatus: '',
      stripeSubscriptionId: '',
      simulationCreditsRemaining: 5,
    });
    assert.equal(state.locked, false);
  });
});
