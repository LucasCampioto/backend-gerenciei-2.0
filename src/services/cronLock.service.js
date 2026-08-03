const crypto = require('crypto');
const CronLock = require('../models/CronLock');

const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Acquire a Mongo TTL lock. Returns owner token or null if held by another worker.
 */
async function acquireLock(lockId, ttlMs = DEFAULT_TTL_MS) {
  const now = new Date();
  const owner = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const lockedUntil = new Date(now.getTime() + ttlMs);

  try {
    await CronLock.create({ _id: lockId, owner, lockedUntil });
    return owner;
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }

  const updated = await CronLock.findOneAndUpdate(
    { _id: lockId, lockedUntil: { $lte: now } },
    { $set: { owner, lockedUntil } },
    { new: true }
  );

  if (!updated || updated.owner !== owner) {
    return null;
  }
  return owner;
}

async function releaseLock(lockId, owner) {
  if (!owner) return;
  await CronLock.deleteOne({ _id: lockId, owner });
}

module.exports = {
  acquireLock,
  releaseLock,
  DEFAULT_TTL_MS,
};
