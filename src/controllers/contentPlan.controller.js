const {
  getOrCreateContentPlan,
  markContentPost,
} = require('../services/contentPlan.service');

async function getPlan(req, res, next) {
  try {
    const data = await getOrCreateContentPlan(req.userId, {
      month: req.query.month,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function regeneratePlan(req, res, next) {
  try {
    const data = await getOrCreateContentPlan(req.userId, {
      month: req.body?.month,
      regenerate: Boolean(req.body?.regenerate ?? true),
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function patchPost(req, res, next) {
  try {
    const data = await markContentPost(
      req.userId,
      req.params.idx,
      req.body?.status
    );
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 400) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    next(error);
  }
}

module.exports = {
  getPlan,
  regeneratePlan,
  patchPost,
};
