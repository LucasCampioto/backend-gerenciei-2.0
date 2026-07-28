/** IDs Mongo (User._id) isentos de bloqueio por assinatura inativa — env SUBSCRIPTION_BYPASS_USER_IDS. */
function bypassUserIdSet() {
  const raw = String(process.env.SUBSCRIPTION_BYPASS_USER_IDS || '').trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** @param {Record<string, unknown> | null | undefined} userDoc */
function isSubscriptionBypassUser(userDoc) {
  if (!userDoc) return false;
  const ids = bypassUserIdSet();
  if (ids.size === 0) return false;
  const id = String(userDoc._id || userDoc.id || '').trim();
  return id.length > 0 && ids.has(id);
}

module.exports = { isSubscriptionBypassUser };
