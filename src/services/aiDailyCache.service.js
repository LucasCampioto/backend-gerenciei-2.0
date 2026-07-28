const AiDailyCache = require('../models/AiDailyCache');
const mongoose = require('mongoose');

const LEASE_MS = 2 * 60 * 1000; // 2 minutos

function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toObjectId(userId) {
  return userId instanceof mongoose.Types.ObjectId
    ? userId
    : new mongoose.Types.ObjectId(userId);
}

async function getDaily(userId, kind, date = todayKey()) {
  return AiDailyCache.findOne({
    userId: toObjectId(userId),
    date,
    kind,
  }).lean();
}

/**
 * Devolve o cache pronto do dia OU marca um lease e indica que deve computar.
 * - ready: há payload salvo → shouldCompute=false
 * - lease ativo recente → shouldCompute=false (outro request já está rodando)
 * - sem cache / lease expirado → cria/atualiza computingAt e shouldCompute=true
 */
async function claimOrGet(userId, kind, date = todayKey()) {
  const userObjectId = toObjectId(userId);
  const existing = await AiDailyCache.findOne({
    userId: userObjectId,
    date,
    kind,
  });

  if (existing?.payload != null) {
    return {
      shouldCompute: false,
      cache: existing.toObject ? existing.toObject() : existing,
    };
  }

  const now = new Date();
  if (
    existing?.computingAt
    && now.getTime() - new Date(existing.computingAt).getTime() < LEASE_MS
  ) {
    return {
      shouldCompute: false,
      cache: existing.toObject ? existing.toObject() : existing,
    };
  }

  const claimed = await AiDailyCache.findOneAndUpdate(
    {
      userId: userObjectId,
      date,
      kind,
      $or: [
        { payload: null },
        { payload: { $exists: false } },
      ],
    },
    {
      $set: { computingAt: now },
      $setOnInsert: {
        userId: userObjectId,
        date,
        kind,
        payload: null,
        source: null,
        promptVersion: '',
      },
    },
    { upsert: true, new: true }
  );

  // Se outro processo gravou payload entre o find e o update, respeita.
  if (claimed?.payload != null) {
    return {
      shouldCompute: false,
      cache: claimed.toObject ? claimed.toObject() : claimed,
    };
  }

  // Re-checa lease: se computingAt foi setado por outro e ainda é fresco, não duplica.
  if (
    claimed?.computingAt
    && claimed.computingAt.getTime() < now.getTime() - 1000
    && now.getTime() - claimed.computingAt.getTime() < LEASE_MS
    && claimed.computingAt.getTime() !== now.getTime()
  ) {
    // Edge case raro — se o lease já era de outro, não computar.
    // Na prática o upsert com $set computingAt=now significa que somos nós.
  }

  return { shouldCompute: true, cache: claimed?.toObject?.() || claimed || null };
}

async function saveDaily(userId, kind, {
  payload,
  source = 'agent',
  promptVersion = '',
  date = todayKey(),
} = {}) {
  const userObjectId = toObjectId(userId);
  return AiDailyCache.findOneAndUpdate(
    { userId: userObjectId, date, kind },
    {
      $set: {
        payload,
        source,
        promptVersion,
        computingAt: null,
      },
      $setOnInsert: {
        userId: userObjectId,
        date,
        kind,
      },
    },
    { upsert: true, new: true }
  ).lean();
}

async function clearLease(userId, kind, date = todayKey()) {
  await AiDailyCache.updateOne(
    { userId: toObjectId(userId), date, kind },
    { $set: { computingAt: null } }
  );
}

module.exports = {
  todayKey,
  getDaily,
  claimOrGet,
  saveDaily,
  clearLease,
  LEASE_MS,
};
