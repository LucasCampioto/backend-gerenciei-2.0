const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  renderTemplate,
  normalizeName,
  pickClientByEventSummary,
  isEventBeforeDailyReminderDispatch,
  formatDailyReminderTime,
} = require('./whatsapp.service');

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

describe('whatsapp.service pickClientByEventSummary', () => {
  const clients = [
    { _id: '1', name: 'Jaqueline Dantas', phone: '11986163972', category: 'cliente' },
    { _id: '2', name: 'Jaqueline', phone: '11989619763', category: 'cliente' },
    { _id: '3', name: 'Jaqueline Sampaio', phone: '11950805012', category: 'cliente' },
  ];

  it('casa nome composto exato do evento', () => {
    const picked = pickClientByEventSummary(clients, 'Jaqueline Sampaio/design personalizado');
    assert.equal(picked?.name, 'Jaqueline Sampaio');
  });

  it('casa nome simples exato do evento', () => {
    const picked = pickClientByEventSummary(clients, 'Jaqueline/consulta');
    assert.equal(picked?.name, 'Jaqueline');
  });

  it('não envia para homônimo parcial quando agenda pede nome composto', () => {
    const withoutSampaio = clients.filter((c) => c.name !== 'Jaqueline Sampaio');
    const picked = pickClientByEventSummary(withoutSampaio, 'Jaqueline Sampaio/design');
    assert.equal(picked, null);
  });

  it('retorna null quando há nomes duplicados normalizados', () => {
    const duplicated = [
      { _id: '1', name: 'Ana Silva', phone: '11911111111', category: 'cliente' },
      { _id: '2', name: 'ANA   SILVA', phone: '11922222222', category: 'cliente' },
    ];
    const picked = pickClientByEventSummary(duplicated, 'Ana Silva/consulta');
    assert.equal(picked, null);
  });
});

describe('whatsapp.service daily reminder dispatch window', () => {
  it('formatDailyReminderTime retorna 8:30', () => {
    assert.equal(formatDailyReminderTime(), '08:30');
  });

  it('isEventBeforeDailyReminderDispatch: antes das 8:30 no fuso da clínica', () => {
    const early = new Date('2026-08-22T07:45:00-03:00');
    const onTime = new Date('2026-08-22T08:30:00-03:00');
    const later = new Date('2026-08-22T10:00:00-03:00');
    assert.equal(isEventBeforeDailyReminderDispatch(early), true);
    assert.equal(isEventBeforeDailyReminderDispatch(onTime), false);
    assert.equal(isEventBeforeDailyReminderDispatch(later), false);
  });
});
