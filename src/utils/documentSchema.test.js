const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { documentSchema } = require('../validators/document.validator');

describe('documentSchema physical_scan', () => {
  it('rejects a paper scan without patient or paper date', () => {
    const missingPatient = documentSchema.validate({
      origin: 'physical_scan',
      signedAt: '2026-08-12',
      fileName: 'ficha.jpg',
      fileType: 'image/jpeg',
    });
    assert.ok(missingPatient.error);

    const missingDate = documentSchema.validate({
      origin: 'physical_scan',
      clientId: '6a7bce947ec426ba5ba15f78',
      fileName: 'ficha.jpg',
      fileType: 'image/jpeg',
    });
    assert.ok(missingDate.error);
  });

  it('accepts a paper scan with patient and date', () => {
    const { error, value } = documentSchema.validate({
      origin: 'physical_scan',
      clientId: '6a7bce947ec426ba5ba15f78',
      signedAt: '2026-08-12',
      fileName: 'ficha.jpg',
      fileType: 'image/jpeg',
      hasFile: true,
    });
    assert.equal(error, undefined);
    assert.equal(value.origin, 'physical_scan');
  });

  it('rejects a paper scan without a file (400)', () => {
    const missingFile = documentSchema.validate({
      origin: 'physical_scan',
      clientId: '6a7bce947ec426ba5ba15f78',
      signedAt: '2026-08-12',
      fileName: 'ficha.jpg',
      fileType: 'image/jpeg',
    });
    assert.ok(missingFile.error);
  });

  it('still accepts a digital signature with name and email', () => {
    const { error } = documentSchema.validate({
      origin: 'digital_signature',
      userName: 'Kamila Camilo',
      userEmail: 'kamilacamilo90@gmail.com',
      fileName: 'termo.pdf',
      fileType: 'application/pdf',
    });
    assert.equal(error, undefined);
  });
});
