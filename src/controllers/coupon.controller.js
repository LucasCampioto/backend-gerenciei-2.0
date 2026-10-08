const {
  listCoupons,
  getCoupon,
  createCoupon,
  updateCoupon,
} = require('../services/coupon.service');

async function list(req, res, next) {
  try {
    const data = await listCoupons(req);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function getOne(req, res, next) {
  try {
    const data = await getCoupon(req, req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  try {
    const data = await createCoupon(req, req.body || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const data = await updateCoupon(req, req.params.id, req.body || {});
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = { list, getOne, create, update };
