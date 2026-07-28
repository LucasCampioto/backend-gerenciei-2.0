const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  stripPhoneDigits,
  isValidBrazilianPhone,
  findClientByPhone,
} = require('../utils/phoneMatch');

test('stripPhoneDigits normaliza formatos comuns', () => {
  assert.equal(stripPhoneDigits('(11) 99999-8888'), '11999998888');
  assert.equal(stripPhoneDigits('11 999998888'), '11999998888');
});

test('findClientByPhone encontra cliente pelo telefone normalizado', async () => {
  const clients = [
    { _id: '1', name: 'Ana', phone: '(11) 98888-7777' },
    { _id: '2', name: 'Bia', phone: '21999997777' },
  ];
  const Client = {
    find: () => ({
      select: () => Promise.resolve(clients),
    }),
  };

  const found = await findClientByPhone(Client, 'user-id', '11988887777');
  assert.equal(found?._id, '1');
});

test('isValidBrazilianPhone exige 10 ou 11 dígitos', () => {
  assert.equal(isValidBrazilianPhone('11999998888'), true);
  assert.equal(isValidBrazilianPhone('1133334444'), true);
  assert.equal(isValidBrazilianPhone('99999'), false);
});
