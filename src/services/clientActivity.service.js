const ClientActivity = require('../models/ClientActivity');

const GROUP_ORDER = {
  grupo_a: 1,
  grupo_b: 2,
  grupo_c: 3,
  grupo_d: 4,
};

function getGroupDirection(fromGroup, toGroup) {
  if (!fromGroup || !toGroup || fromGroup === toGroup) return 'unchanged';
  const from = GROUP_ORDER[fromGroup] ?? 0;
  const to = GROUP_ORDER[toGroup] ?? 0;
  if (to < from) return 'upgrade';
  if (to > from) return 'downgrade';
  return 'unchanged';
}

async function logActivity({
  userId,
  clientId,
  clientName,
  type,
  fromGroup = null,
  toGroup = null,
  content = '',
}) {
  const payload = {
    userId,
    clientId,
    clientName,
    type,
    content,
  };

  if (fromGroup) payload.fromGroup = fromGroup;
  if (toGroup) payload.toGroup = toGroup;

  return ClientActivity.create(payload);
}

function formatActivity(activity) {
  const obj = activity.toObject ? activity.toObject() : activity;
  return {
    id: obj._id.toString(),
    clientId: obj.clientId.toString(),
    clientName: obj.clientName,
    type: obj.type,
    fromGroup: obj.fromGroup ?? null,
    toGroup: obj.toGroup ?? null,
    content: obj.content || '',
    direction: obj.type === 'group_change'
      ? getGroupDirection(obj.fromGroup, obj.toGroup)
      : null,
    isInitialGroup: obj.type === 'initial_group',
    createdAt: obj.createdAt instanceof Date
      ? obj.createdAt.toISOString()
      : obj.createdAt,
  };
}

module.exports = {
  GROUP_ORDER,
  getGroupDirection,
  logActivity,
  formatActivity,
};
