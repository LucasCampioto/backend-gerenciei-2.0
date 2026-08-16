/** IDs Mongo (User._id) ou e-mails isentos de bloqueio por assinatura — env SUBSCRIPTION_BYPASS_USER_IDS. */
function bypassEntries() {
  const raw = String(process.env.SUBSCRIPTION_BYPASS_USER_IDS || '').trim();
  const ids = new Set();
  const emails = new Set();
  if (!raw) return { ids, emails };
  for (const part of raw.split(/[,;\s]+/)) {
    const token = part.trim();
    if (!token) continue;
    if (token.includes('@')) emails.add(token.toLowerCase());
    else ids.add(token);
  }
  return { ids, emails };
}

/** @param {Record<string, unknown> | null | undefined} userDoc */
function isSubscriptionBypassUser(userDoc) {
  if (!userDoc) return false;
  const { ids, emails } = bypassEntries();
  if (ids.size === 0 && emails.size === 0) return false;
  const id = String(userDoc._id || userDoc.id || '').trim();
  if (id && ids.has(id)) return true;
  const email = String(userDoc.email || '').trim().toLowerCase();
  return Boolean(email && emails.has(email));
}

module.exports = { isSubscriptionBypassUser };
