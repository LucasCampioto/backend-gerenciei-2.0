const mongoose = require('mongoose');
const Client = require('../../models/Client');
const { LEGAL_VERSION } = require('../../legal/version');

function clientHasPhotoConsent(client, version = LEGAL_VERSION) {
  if (!client?.photoConsentAt) return false;
  const v = String(client.photoConsentVersion || '').trim();
  return !v || v === String(version).trim();
}

async function recordClientPhotoConsent(userId, clientId, { consentVersion = LEGAL_VERSION } = {}) {
  if (!mongoose.isValidObjectId(clientId)) {
    return { error: 'Cliente inválido', status: 400 };
  }
  const now = new Date();
  const doc = await Client.findOneAndUpdate(
    { _id: clientId, userId },
    {
      $set: {
        photoConsentAt: now,
        photoConsentVersion: String(consentVersion).trim() || LEGAL_VERSION,
        photoConsentMethod: 'attested_by_professional',
        photoConsentedByUserId: userId,
      },
    },
    { new: true },
  ).lean();
  if (!doc) return { error: 'Cliente não encontrado', status: 404 };
  return { client: doc };
}

module.exports = {
  clientHasPhotoConsent,
  recordClientPhotoConsent,
};
