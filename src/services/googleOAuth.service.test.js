const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

describe('googleOAuth signed state', () => {
  let validateState;
  let buildSignedState;
  let previousJwt;
  let previousOauth;

  before(() => {
    previousJwt = process.env.JWT_SECRET;
    previousOauth = process.env.OAUTH_STATE_SECRET;
    process.env.JWT_SECRET = 'test-jwt-secret-for-oauth-state';
    delete process.env.OAUTH_STATE_SECRET;
    // Re-require after env is set
    delete require.cache[require.resolve('./googleOAuth.service')];
    ({ validateState, buildSignedState } = require('./googleOAuth.service'));
  });

  after(() => {
    if (previousJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwt;
    if (previousOauth === undefined) delete process.env.OAUTH_STATE_SECRET;
    else process.env.OAUTH_STATE_SECRET = previousOauth;
    delete require.cache[require.resolve('./googleOAuth.service')];
  });

  it('accepts a freshly signed state', () => {
    const state = buildSignedState('507f1f77bcf86cd799439011');
    const userId = validateState(state);
    assert.equal(userId, '507f1f77bcf86cd799439011');
  });

  it('rejects forged base64 state without HMAC', () => {
    const forged = Buffer.from(
      JSON.stringify({ userId: '507f1f77bcf86cd799439011', timestamp: Date.now() })
    ).toString('base64');
    assert.throws(() => validateState(forged), /State inválido/);
  });

  it('rejects state with tampered signature', () => {
    const state = buildSignedState('507f1f77bcf86cd799439011');
    const [payload] = state.split('.');
    const bad = `${payload}.${Buffer.from('tampered').toString('base64url')}`;
    assert.throws(() => validateState(bad), /State inválido/);
  });

  it('rejects expired state', () => {
    const payload = Buffer.from(
      JSON.stringify({
        userId: '507f1f77bcf86cd799439011',
        timestamp: Date.now() - 16 * 60 * 1000,
      })
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    const sig = crypto
      .createHmac('sha256', 'test-jwt-secret-for-oauth-state')
      .update(payload)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    assert.throws(() => validateState(`${payload}.${sig}`), /State expirado/);
  });
});
