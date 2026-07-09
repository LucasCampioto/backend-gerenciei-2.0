function stripPhoneDigits(value) {
  if (!value) return '';
  return String(value).replace(/\D/g, '').slice(0, 11);
}

function isValidBrazilianPhone(value) {
  const digits = stripPhoneDigits(value);
  return digits.length >= 10 && digits.length <= 11;
}

async function findClientByPhone(Client, userId, phone) {
  const digits = stripPhoneDigits(phone);
  if (!digits || digits.length < 10) {
    return null;
  }

  const clients = await Client.find({ userId }).select('_id name phone category clientGroup');

  return clients.find((client) => stripPhoneDigits(client.phone) === digits) ?? null;
}

module.exports = {
  stripPhoneDigits,
  isValidBrazilianPhone,
  findClientByPhone,
};
