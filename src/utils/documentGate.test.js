const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authenticate } = require('../middleware/auth.middleware');

function mockRes() {
  const res = {};
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

describe('document routes authn', () => {
  it('returns 401 without a token (POST /documents and /document-templates)', async () => {
    const req = { headers: {} };
    const res = mockRes();
    let nextCalled = false;
    await authenticate(req, res, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.success, false);
    assert.equal(nextCalled, false);
  });
});
