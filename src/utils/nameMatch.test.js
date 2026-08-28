const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeName, namesAreEqual } = require('./nameMatch');

describe('nameMatch normalizeName', () => {
  it('remove acentos, case e espaços extras', () => {
    assert.equal(normalizeName('  Jaqueline   SAMPAIO '), 'jaqueline sampaio');
    assert.equal(normalizeName('José da Conceição'), 'jose da conceicao');
  });

  it('namesAreEqual compara nomes normalizados', () => {
    assert.equal(namesAreEqual('Jaqueline Sampaio', 'JAQUELINE sampaio'), true);
    assert.equal(namesAreEqual('Jaqueline', 'Jaqueline Sampaio'), false);
  });
});
