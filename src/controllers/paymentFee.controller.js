const PaymentFee = require('../models/PaymentFee');
const {
  FEE_SCHEDULE,
  BRAND_GROUP_IDS,
  resolveFeeKey,
  resolveBrandGroup,
  buildDefaultFeesResponse,
} = require('../constants/paymentFee.constants');

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function isValidFeeEntry(brandGroup, feeKey) {
  const group = FEE_SCHEDULE.find((item) => item.brandGroup === brandGroup);
  if (!group) return false;
  return group.feeKeys.some((item) => item.key === feeKey);
}

async function getFeePercentageForUser(userId, paymentMethod, cardBrandGroup, installments) {
  const feeKey = resolveFeeKey(paymentMethod, installments);
  if (!feeKey) return 0;

  const brandGroup = resolveBrandGroup(paymentMethod, cardBrandGroup);
  const fee = await PaymentFee.findOne({ userId, brandGroup, feeKey });
  return fee?.feePercentage ?? 0;
}

async function getAllPaymentFees(req, res, next) {
  try {
    const stored = await PaymentFee.find({ userId: req.userId });
    const feeMap = {};
    for (const fee of stored) {
      feeMap[`${fee.brandGroup}:${fee.feeKey}`] = fee.feePercentage;
    }

    const data = FEE_SCHEDULE.map((group) => ({
      brandGroup: group.brandGroup,
      label: group.label,
      fees: group.feeKeys.map((feeKey) => ({
        feeKey: feeKey.key,
        label: feeKey.label,
        feePercentage: round2(feeMap[`${group.brandGroup}:${feeKey.key}`] ?? 0),
      })),
    }));

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function updatePaymentFees(req, res, next) {
  try {
    const { fees } = req.body;

    if (!Array.isArray(fees)) {
      return res.status(400).json({
        success: false,
        message: 'fees deve ser um array',
      });
    }

    const docs = [];

    for (const item of fees) {
      const { brandGroup, feeKey, feePercentage } = item;

      if (!BRAND_GROUP_IDS.includes(brandGroup) && brandGroup !== 'default') {
        return res.status(400).json({
          success: false,
          message: `Grupo de bandeira inválido: ${brandGroup}`,
        });
      }

      if (!isValidFeeEntry(brandGroup, feeKey)) {
        return res.status(400).json({
          success: false,
          message: `Taxa inválida: ${brandGroup} / ${feeKey}`,
        });
      }

      const pct = Number(feePercentage);
      if (Number.isNaN(pct) || pct < 0 || pct > 100) {
        return res.status(400).json({
          success: false,
          message: `Percentual inválido para ${feeKey}`,
        });
      }

      docs.push({
        userId: req.userId,
        brandGroup,
        feeKey,
        feePercentage: round2(pct),
      });
    }

    await PaymentFee.deleteMany({ userId: req.userId });
    if (docs.length > 0) {
      await PaymentFee.insertMany(docs, { ordered: true });
    }

    const stored = await PaymentFee.find({ userId: req.userId });
    const feeMap = {};
    for (const fee of stored) {
      feeMap[`${fee.brandGroup}:${fee.feeKey}`] = fee.feePercentage;
    }

    const data = FEE_SCHEDULE.map((group) => ({
      brandGroup: group.brandGroup,
      label: group.label,
      fees: group.feeKeys.map((feeKey) => ({
        feeKey: feeKey.key,
        label: feeKey.label,
        feePercentage: round2(feeMap[`${group.brandGroup}:${feeKey.key}`] ?? 0),
      })),
    }));

    res.json({
      success: true,
      data,
      message: 'Taxas atualizadas com sucesso',
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllPaymentFees,
  updatePaymentFees,
  getFeePercentageForUser,
  round2,
  buildDefaultFeesResponse,
};
