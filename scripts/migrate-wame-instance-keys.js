/**
 * One-shot: copy WAME_INSTANCE_KEY from env onto WhatsAppSettings without a key.
 *
 * Usage: node scripts/migrate-wame-instance-keys.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const WhatsAppSettings = require('../src/models/WhatsAppSettings');

async function main() {
  const key = String(process.env.WAME_INSTANCE_KEY || '').trim();
  if (!key) {
    console.error('WAME_INSTANCE_KEY is empty — nothing to migrate.');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI required');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const filter = {
    $or: [
      { wameInstanceKey: { $exists: false } },
      { wameInstanceKey: null },
      { wameInstanceKey: '' },
    ],
  };
  const result = await WhatsAppSettings.updateMany(filter, {
    $set: { wameInstanceKey: key },
  });
  console.log(
    `Migrated wameInstanceKey for ${result.modifiedCount} settings (matched ${result.matchedCount}).`
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
