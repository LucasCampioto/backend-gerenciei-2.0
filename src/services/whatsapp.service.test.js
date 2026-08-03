const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { renderTemplate, normalizeName, matchScore } = require('./whatsapp.service');

describe('whatsapp.service renderTemplate', () => {
  it('substitui nome, data e horario', () => {
    const out = renderTemplate(
      'Olá {{nome}}! Em {{data}} às {{horario}}.',
      { nome: 'Maria', data: '29/07/2026', horario: '15:00' }
    );
    assert.equal(out, 'Olá Maria! Em 29/07/2026 às 15:00.');
  });

  it('aceita horário com acento no token', () => {
    const out = renderTemplate('às {{horário}}', { horario: '09:30' });
    assert.equal(out, 'às 09:30');
  });
});

describe('whatsapp.service normalizeName', () => {
  it('remove acentos, case e espaços extras', () => {
    assert.equal(normalizeName('  Letícia   PEREIRA '), 'leticia pereira');
    assert.equal(normalizeName('José da Conceição'), 'jose da conceicao');
  });

  it('trata pontuação no título da agenda', () => {
    assert.equal(normalizeName('Milena Cortez/design'), 'milena cortez design');
  });
});

describe('whatsapp.service matchScore nome completo', () => {
  it('casa Letícia com Leticia no nome completo', () => {
    const score = matchScore('Letícia Pereira', 'leticia pereira');
    assert.ok(score >= 200);
  });

  it('casa título com sobrenome parcial forte', () => {
    const score = matchScore('Leticia Pereira Silva', 'Leticia Pereira');
    assert.ok(score >= 120);
  });
});
