const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { documentTemplateSchema, documentTemplateUpdateSchema } = require('./documentTemplate.validator');

describe('documentTemplateSchema', () => {
  it('requires a name to create a template', () => {
    const { error } = documentTemplateSchema.validate({ fileName: 'a.pdf', fileType: 'application/pdf' });
    assert.ok(error);
  });
});

describe('documentTemplateUpdateSchema', () => {
  it('allows renaming without a file payload', () => {
    const { error, value } = documentTemplateUpdateSchema.validate({ name: 'Anamnese 2' });
    assert.equal(error, undefined);
    assert.equal(value.name, 'Anamnese 2');
  });

  it('allows replacing the file metadata', () => {
    const { error } = documentTemplateUpdateSchema.validate({
      fileName: 'termo.pdf',
      fileType: 'application/pdf',
    });
    assert.equal(error, undefined);
  });
});
