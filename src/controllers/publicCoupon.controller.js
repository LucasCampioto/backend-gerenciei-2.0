const { getPublicCoupon } = require('../services/coupon.service');

async function getOne(req, res, next) {
  try {
    const viaQr = String(req.query.via || '') === 'qr';
    const data = await getPublicCoupon(req.params.slug, viaQr);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = { getOne };
