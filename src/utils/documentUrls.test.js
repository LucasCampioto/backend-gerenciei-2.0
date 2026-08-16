const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isPersistableDocumentUrl,
  resolveStoredDocumentUrls,
  resolveDownloadUrl,
  extractS3ObjectKey,
  isTemplateObjectKey,
} = require('./documentUrls');

const S3_URL = 'https://gerenciei-documentos.s3.us-east-2.amazonaws.com/documents/1786573747617-822662462.pdf';
const KAMILA_BLOB = 'blob:https://gerenciei-app.vercel.app/10786dbd-8526-4be3-a439-51497c81db28';

describe('isPersistableDocumentUrl', () => {
  it('accepts https S3 urls', () => {
    assert.equal(isPersistableDocumentUrl(S3_URL), true);
  });

  it('rejects blob urls from the browser', () => {
    assert.equal(isPersistableDocumentUrl(KAMILA_BLOB), false);
  });

  it('rejects data urls', () => {
    assert.equal(isPersistableDocumentUrl('data:image/png;base64,abc'), false);
  });

  it('rejects empty values', () => {
    assert.equal(isPersistableDocumentUrl(''), false);
    assert.equal(isPersistableDocumentUrl(null), false);
    assert.equal(isPersistableDocumentUrl(undefined), false);
  });
});

describe('resolveStoredDocumentUrls', () => {
  it('does not persist a blob signatureUrl when an S3 upload location is present', () => {
    const resolved = resolveStoredDocumentUrls({
      uploadedLocation: S3_URL,
      fileUrl: 'blob:https://gerenciei-app.vercel.app/local-file',
      signatureUrl: KAMILA_BLOB,
    });
    assert.equal(resolved.fileUrl, S3_URL);
    assert.equal(resolved.signatureUrl, S3_URL);
  });

  it('uses persistable client urls when there is no upload', () => {
    const resolved = resolveStoredDocumentUrls({
      fileUrl: S3_URL,
      signatureUrl: S3_URL,
    });
    assert.equal(resolved.fileUrl, S3_URL);
    assert.equal(resolved.signatureUrl, S3_URL);
  });

  it('drops blob/data urls when there is no persistable file', () => {
    const resolved = resolveStoredDocumentUrls({
      fileUrl: KAMILA_BLOB,
      signatureUrl: 'data:image/png;base64,abc',
    });
    assert.equal(resolved.fileUrl, '');
    assert.equal(resolved.signatureUrl, '');
  });
});

describe('resolveDownloadUrl', () => {
  it('falls back to fileUrl when signatureUrl is a dead blob (Kamila case)', () => {
    assert.equal(
      resolveDownloadUrl({ fileUrl: S3_URL, signatureUrl: KAMILA_BLOB }),
      S3_URL
    );
  });

  it('prefers a persistable signatureUrl', () => {
    assert.equal(
      resolveDownloadUrl({
        fileUrl: 'https://example.com/original.pdf',
        signatureUrl: S3_URL,
      }),
      S3_URL
    );
  });

  it('returns null when neither url can be opened later', () => {
    assert.equal(
      resolveDownloadUrl({ fileUrl: KAMILA_BLOB, signatureUrl: KAMILA_BLOB }),
      null
    );
  });
});

describe('extractS3ObjectKey', () => {
  it('extracts documents/ and templates/ keys', () => {
    assert.equal(
      extractS3ObjectKey(S3_URL),
      'documents/1786573747617-822662462.pdf'
    );
    assert.equal(
      extractS3ObjectKey(
        'https://gerenciei-documentos.s3.us-east-2.amazonaws.com/templates/1-2.pdf'
      ),
      'templates/1-2.pdf'
    );
  });

  it('ignores blob urls so delete never hits a random S3 key', () => {
    assert.equal(extractS3ObjectKey(KAMILA_BLOB), null);
  });
});

describe('isTemplateObjectKey', () => {
  it('only treats templates/ as the blank-form prefix so signed PDFs stay in documents/', () => {
    assert.equal(isTemplateObjectKey('templates/1-2.pdf'), true);
    assert.equal(isTemplateObjectKey('documents/1786573747617-822662462.pdf'), false);
    assert.equal(isTemplateObjectKey(null), false);
  });
});
