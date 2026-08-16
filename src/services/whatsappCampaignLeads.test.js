const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCampaignLeads } = require('./whatsappCampaign.service');

describe('normalizeCampaignLeads', () => {
  it('keeps valid name + brazilian phone and drops junk', () => {
    const out = normalizeCampaignLeads([
      { id: 'a', name: 'Ingrid', phone: '11993908223' },
      { id: 'b', name: '', phone: '11988887777' },
      { id: 'c', name: 'Dayana', phone: '123' },
      { name: 'Lucelia', phone: '(11) 96228-7742' },
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0].name, 'Ingrid');
    assert.equal(out[1].name, 'Lucelia');
  });

  it('dedupes by last 11 digits', () => {
    const out = normalizeCampaignLeads([
      { name: 'Ana', phone: '11999998888' },
      { name: 'Ana 2', phone: '(11) 99999-8888' },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'Ana');
  });

  it('caps at max leads', () => {
    const raw = Array.from({ length: 40 }, (_, i) => ({
      name: `Pessoa ${i}`,
      phone: `1199999${String(i).padStart(4, '0')}`,
    }));
    const out = normalizeCampaignLeads(raw, { max: 30 });
    assert.equal(out.length, 30);
  });

  it('does not treat random ids as mongo clientId', () => {
    const out = normalizeCampaignLeads([
      { id: 'lead-local-xyz', name: 'Nova', phone: '11987654321' },
    ]);
    assert.equal(out[0].clientId, null);
    assert.equal(out[0].id, 'lead-local-xyz');
  });
});
