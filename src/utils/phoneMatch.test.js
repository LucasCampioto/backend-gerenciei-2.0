const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  stripPhoneDigits,
  toNationalPhoneDigits,
  toInternationalPhoneDigits,
  isValidBrazilianPhone,
  findClientByPhone,
} = require('../utils/phoneMatch');
const wame = require('../services/wame.client');

test('stripPhoneDigits não trunca DDI 55', () => {
  assert.equal(stripPhoneDigits('(11) 99999-8888'), '11999998888');
  assert.equal(stripPhoneDigits('5511947837190'), '5511947837190');
});

test('toInternationalPhoneDigits é idempotente com 55', () => {
  assert.equal(toInternationalPhoneDigits('11947837190'), '5511947837190');
  assert.equal(toInternationalPhoneDigits('5511947837190'), '5511947837190');
  assert.equal(toInternationalPhoneDigits('(11) 94783-7190'), '5511947837190');
  // não pode virar 5555…
  assert.equal(wame.toInternationalPhone('5511947837190'), '5511947837190');
  assert.notEqual(wame.toInternationalPhone('5511947837190'), '5555119478371');
});

test('toNationalPhoneDigits remove 55', () => {
  assert.equal(toNationalPhoneDigits('5511947837190'), '11947837190');
  assert.equal(toNationalPhoneDigits('11947837190'), '11947837190');
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

  const foundIntl = await findClientByPhone(Client, 'user-id', '5511988887777');
  assert.equal(foundIntl?._id, '1');
});

test('isValidBrazilianPhone exige 10 ou 11 dígitos nacionais', () => {
  assert.equal(isValidBrazilianPhone('11999998888'), true);
  assert.equal(isValidBrazilianPhone('5511999998888'), true);
  assert.equal(isValidBrazilianPhone('1133334444'), true);
  assert.equal(isValidBrazilianPhone('99999'), false);
});
