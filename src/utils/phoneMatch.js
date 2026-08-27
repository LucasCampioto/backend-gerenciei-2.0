/**
 * Só dígitos. Não truncar: números BR com DDI 55 têm 12–13 dígitos
 * (ex.: 5511947837190). Truncar em 11 quebrava o envio WAME
 * (5511… → 555511…).
 */
function stripPhoneDigits(value) {
  if (!value) return '';
  return String(value).replace(/\D/g, '');
}

/**
 * DDD + número nacional (10 ou 11 dígitos), sem código do país.
 * Aceita entrada já com 55 ou só local.
 */
function toNationalPhoneDigits(value) {
  let digits = stripPhoneDigits(value);
  if (!digits) return '';

  // JID WAME às vezes vem como "5511940452242:13" → já limpo por strip,
  // mas se sobrar device id longo, fica só o núcleo do telefone.
  if (digits.startsWith('55') && digits.length >= 12) {
    digits = digits.slice(2);
  }
  if (digits.length > 11) {
    digits = digits.slice(-11);
  }
  return digits;
}

function isValidBrazilianPhone(value) {
  const digits = toNationalPhoneDigits(value);
  return digits.length >= 10 && digits.length <= 11;
}

/**
 * Formato internacional só dígitos para WAME (55 + DDD + número).
 */
function toInternationalPhoneDigits(value) {
  const national = toNationalPhoneDigits(value);
  if (!national) return '';
  if (national.length === 10 || national.length === 11) return `55${national}`;
  return national;
}

async function findClientByPhone(Client, userId, phone) {
  const digits = toNationalPhoneDigits(phone);
  if (!digits || digits.length < 10) {
    return null;
  }

  const clients = await Client.find({ userId }).select('_id name phone category clientGroup');

  return (
    clients.find((client) => toNationalPhoneDigits(client.phone) === digits) ?? null
  );
}

module.exports = {
  stripPhoneDigits,
  toNationalPhoneDigits,
  toInternationalPhoneDigits,
  isValidBrazilianPhone,
  findClientByPhone,
};
