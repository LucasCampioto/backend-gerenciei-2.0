const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Document = require('./Document');

const S3_URL = 'https://gerenciei-documentos.s3.us-east-2.amazonaws.com/documents/1786573747617-822662462.pdf';

function baseFields(overrides = {}) {
  return {
    userId: new mongoose.Types.ObjectId(),
    fileName: 'ficha.jpg',
    fileType: 'image/jpeg',
    fileUrl: S3_URL,
    signatureUrl: S3_URL,
    userName: 'Kamila Camilo',
    organizationId: new mongoose.Types.ObjectId(),
    ...overrides,
  };
}

describe('Document schema', () => {
  it('accepts a physical_scan with patient, paper date and no email (201 payload)', () => {
    const doc = new Document(baseFields({
      origin: 'physical_scan',
      clientId: new mongoose.Types.ObjectId(),
      signedAt: new Date(2026, 7, 12),
      title: 'Anamnese',
    }));
    assert.equal(doc.validateSync(), undefined);
    assert.equal(doc.origin, 'physical_scan');
    assert.equal(doc.userEmail, undefined);
  });

  it('defaults origin to digital_signature on legacy docs', () => {
    const doc = new Document(baseFields({
      userEmail: 'kamilacamilo90@gmail.com',
    }));
    assert.equal(doc.validateSync(), undefined);
    assert.equal(doc.origin, 'digital_signature');
  });

  it('requires email when there is no clientId', () => {
    const doc = new Document(baseFields({
      origin: 'digital_signature',
    }));
    const err = doc.validateSync();
    assert.ok(err && err.errors.userEmail);
  });

  it('keeps a deleted templateId as an optional pointer (deleting the model must not cascade)', () => {
    const templateId = new mongoose.Types.ObjectId();
    const doc = new Document(baseFields({
      userEmail: 'ana@example.com',
      origin: 'digital_signature',
      templateId,
    }));
    assert.equal(doc.validateSync(), undefined);
    assert.equal(doc.templateId.toString(), templateId.toString());
  });
});
