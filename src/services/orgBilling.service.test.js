const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldInheritOrgOwnerBilling,
  overlayPublicBillingFields,
} = require('./orgBilling.service');
const { getSubscriptionLockState } = require('./simulation/subscriptionAccess');

describe('shouldInheritOrgOwnerBilling', () => {
  it('does not inherit for owner', () => {
    assert.equal(
      shouldInheritOrgOwnerBilling({
        organizationId: 'org1',
        role: 'owner',
      }),
      false,
    );
  });

  it('does not inherit when role is missing (legado owner)', () => {
    assert.equal(
      shouldInheritOrgOwnerBilling({
        organizationId: 'org1',
        role: '',
      }),
      false,
    );
  });

  it('inherits for member of an organization', () => {
    assert.equal(
      shouldInheritOrgOwnerBilling({
        organizationId: 'org1',
        role: 'member',
      }),
      true,
    );
  });

  it('inherits for admin of an organization', () => {
    assert.equal(
      shouldInheritOrgOwnerBilling({
        organizationId: 'org1',
        role: 'admin',
      }),
      true,
    );
  });

  it('does not inherit without organization', () => {
    assert.equal(shouldInheritOrgOwnerBilling({ role: 'member' }), false);
  });
});

describe('org member billing lock', () => {
  it('locks a member account looked up in isolation (no own Stripe)', () => {
    const state = getSubscriptionLockState({
      accountType: 'official',
      role: 'member',
      organizationId: 'org1',
      subscriptionStatus: '',
      stripeSubscriptionId: '',
    });
    assert.equal(state.locked, true);
    assert.equal(state.code, 'SUBSCRIPTION_REQUIRED');
  });

  it('unlocks when lock is evaluated against the org owner subscription', () => {
    const owner = {
      _id: 'owner1',
      accountType: 'official',
      role: 'owner',
      subscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_owner',
      planTier: 'profissional',
    };
    const state = getSubscriptionLockState(owner);
    assert.equal(state.locked, false);
  });
});

describe('overlayPublicBillingFields', () => {
  it('copies plan and status from owner without Stripe ids', () => {
    const publicUser = { id: 'member1', name: 'Lucas', role: 'member' };
    const owner = {
      _id: 'owner1',
      planTier: 'profissional',
      subscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_secret',
      currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
    };
    const out = overlayPublicBillingFields(publicUser, owner);
    assert.equal(out.planTier, 'profissional');
    assert.equal(out.subscriptionStatus, 'active');
    assert.equal(out.currentPeriodEnd, '2026-09-01T00:00:00.000Z');
    assert.equal(out.stripeSubscriptionId, undefined);
    assert.equal(out.subscriptionBillingBypass, undefined);
  });

  it('does not copy canceled Stripe status when the org owner is an admin bypass', () => {
    const prev = process.env.SUBSCRIPTION_BYPASS_USER_IDS;
    process.env.SUBSCRIPTION_BYPASS_USER_IDS = 'owner1,andressa.microo@gmail.com';
    try {
      const publicUser = { id: 'member1', name: 'Lucas', role: 'member' };
      const owner = {
        _id: 'owner1',
        email: 'andressa.microo@gmail.com',
        planTier: 'profissional',
        subscriptionStatus: 'canceled',
        cancelAtPeriodEnd: true,
      };
      const out = overlayPublicBillingFields(publicUser, owner);
      assert.equal(out.subscriptionBillingBypass, true);
      assert.equal(out.subscriptionStatus, 'active');
      assert.equal(out.planTier, 'profissional');
      assert.equal(out.cancelAtPeriodEnd, undefined);
    } finally {
      if (prev === undefined) delete process.env.SUBSCRIPTION_BYPASS_USER_IDS;
      else process.env.SUBSCRIPTION_BYPASS_USER_IDS = prev;
    }
  });

  it('leaves owner payload unchanged when billing user is self', () => {
    const publicUser = { id: 'owner1', role: 'owner' };
    const out = overlayPublicBillingFields(publicUser, { _id: 'owner1', planTier: 'gestao' });
    assert.deepEqual(out, publicUser);
  });
});
