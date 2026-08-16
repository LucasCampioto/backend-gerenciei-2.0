const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('isSubscriptionBypassUser', () => {
  it('matches by mongo id', () => {
    const prev = process.env.SUBSCRIPTION_BYPASS_USER_IDS;
    process.env.SUBSCRIPTION_BYPASS_USER_IDS = 'aaaaaaaaaaaaaaaaaaaaaaaa,bbbbbbbbbbbbbbbbbbbbbbbb';
    try {
      const { isSubscriptionBypassUser } = require('./subscriptionBypass');
      assert.equal(
        isSubscriptionBypassUser({
          _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
          email: 'x@y.com',
        }),
        true,
      );
      assert.equal(
        isSubscriptionBypassUser({ _id: 'cccccccccccccccccccccccc', email: 'other@y.com' }),
        false,
      );
    } finally {
      if (prev === undefined) delete process.env.SUBSCRIPTION_BYPASS_USER_IDS;
      else process.env.SUBSCRIPTION_BYPASS_USER_IDS = prev;
    }
  });

  it('matches by email when the account was recreated with a new id', () => {
    const prev = process.env.SUBSCRIPTION_BYPASS_USER_IDS;
    process.env.SUBSCRIPTION_BYPASS_USER_IDS = 'oldid,andressa.microo@gmail.com';
    try {
      delete require.cache[require.resolve('./subscriptionBypass')];
      const { isSubscriptionBypassUser } = require('./subscriptionBypass');
      assert.equal(
        isSubscriptionBypassUser({
          _id: 'ffffffffffffffffffffffff',
          email: 'Andressa.Microo@gmail.com',
        }),
        true,
      );
      assert.equal(
        isSubscriptionBypassUser({
          _id: 'ffffffffffffffffffffffff',
          email: 'outra@clinica.com',
        }),
        false,
      );
    } finally {
      delete require.cache[require.resolve('./subscriptionBypass')];
      if (prev === undefined) delete process.env.SUBSCRIPTION_BYPASS_USER_IDS;
      else process.env.SUBSCRIPTION_BYPASS_USER_IDS = prev;
    }
  });
});
