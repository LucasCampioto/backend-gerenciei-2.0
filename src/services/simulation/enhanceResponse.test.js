const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { stripInlineImagesIfR2 } = require('./enhanceResponse');

describe('stripInlineImagesIfR2', () => {
  it('drops inline base64 when pairId and R2 URLs are present', () => {
    const out = stripInlineImagesIfR2({
      enhanced_image_base64: 'AAAA'.repeat(80),
      enhanced_mime_type: 'image/jpeg',
      usage_report: { total_token_count: 12 },
      pairId: 'pair-1',
      r2_original_url: 'https://cdn.example/original.jpg',
      r2_after_url: 'https://cdn.example/after.jpg',
    });
    assert.equal(out.pairId, 'pair-1');
    assert.equal(out.r2_after_url, 'https://cdn.example/after.jpg');
    assert.equal(out.enhanced_mime_type, 'image/jpeg');
    assert.equal(out.usage_report.total_token_count, 12);
    assert.equal(out.enhanced_image_base64, undefined);
  });

  it('keeps base64 when R2 URLs are missing (preview / R2 fail)', () => {
    const body = {
      enhanced_image_base64: 'abc123',
      enhanced_mime_type: 'image/png',
    };
    const out = stripInlineImagesIfR2(body);
    assert.equal(out.enhanced_image_base64, 'abc123');
  });
});
