const PricingBase = require('../../models/PricingBase');

const ALLOWED_FIELDS = [
  'desiredMargin',
  'estimatedUnits',
  'actualUnits',
  'costPerUnit',
  'botoxVialPrice',
  'botoxPointsPerVial',
  'monthlyPatients',
  'additionalCosts',
];

function sanitize(payload) {
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (payload[key] !== undefined) {
      out[key] = payload[key];
    }
  }
  return out;
}

function toDto(doc) {
  if (!doc) return null;
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: obj._id?.toString?.() ?? obj._id,
    procedureId: obj.procedureId,
    desiredMargin: obj.desiredMargin ?? 35,
    estimatedUnits: obj.estimatedUnits ?? 20,
    actualUnits: obj.actualUnits ?? 20,
    costPerUnit: obj.costPerUnit ?? 15,
    botoxVialPrice: obj.botoxVialPrice ?? null,
    botoxPointsPerVial: obj.botoxPointsPerVial ?? null,
    monthlyPatients: obj.monthlyPatients ?? 30,
    additionalCosts: {
      supplies: obj.additionalCosts?.supplies ?? 0,
      ppeAndHygiene: obj.additionalCosts?.ppeAndHygiene ?? 0,
      cardFee: obj.additionalCosts?.cardFee ?? 0,
      fixedClinicShare: obj.additionalCosts?.fixedClinicShare ?? 0,
    },
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

async function getPricingBase(userId, procedureId) {
  const doc = await PricingBase.findOne({ userId, procedureId }).lean();
  return toDto(doc);
}

async function upsertPricingBase(userId, procedureId, payload) {
  const data = sanitize(payload || {});
  const doc = await PricingBase.findOneAndUpdate(
    { userId, procedureId },
    { $set: data },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
  );
  return toDto(doc);
}

module.exports = {
  getPricingBase,
  upsertPricingBase,
};
