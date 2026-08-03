const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  mapWameError,
  isNotConnectedMessage,
  mapConnectionStatus,
} = require('./wame.client');

describe('wame mapWameError', () => {
  it('maps WAME 401 instance message to 409, not 401', () => {
    const err = mapWameError(
      401,
      'Instância não conectada. Reconecte via QR Code / código antes de usar este recurso.',
      {}
    );
    assert.equal(err.statusCode, 409);
    assert.equal(err.code, 'WAME_NOT_CONNECTED');
    assert.notEqual(err.statusCode, 401);
  });

  it('maps plain 401 without confusing Gerenciei auth', () => {
    const err = mapWameError(401, 'Unauthorized', {});
    assert.equal(err.statusCode, 409);
    assert.equal(err.code, 'WAME_NOT_CONNECTED');
  });

  it('detects not-connected messages', () => {
    assert.equal(
      isNotConnectedMessage(
        'Instância não conectada. Reconecte via QR Code / código antes de usar este recurso.'
      ),
      true
    );
  });
});

describe('wame mapConnectionStatus', () => {
  it('treats stale phoneConnected=true with dead socket as disconnected', () => {
    const status = mapConnectionStatus({
      status: 200,
      instance: {
        socketConnection: 0,
        connected: false,
        phoneConnected: true,
        user: { id: '5511999999999@s.whatsapp.net' },
      },
    });
    assert.equal(status, 'disconnected');
  });

  it('prefers connected=true over stale socket=0', () => {
    const status = mapConnectionStatus({
      status: 200,
      instance: {
        socketConnection: 0,
        connected: true,
        phoneConnected: true,
      },
    });
    assert.equal(status, 'connected');
  });

  it('returns qr when disconnected but qr payload present', () => {
    const status = mapConnectionStatus({
      phoneConnected: false,
      connected: false,
      socketConnection: 0,
      image: 'data:image/png;base64,abc',
    });
    assert.equal(status, 'qr');
  });
});
