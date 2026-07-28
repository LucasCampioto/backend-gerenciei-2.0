const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  getPlan,
  regeneratePlan,
  patchPost,
} = require('../controllers/contentPlan.controller');

router.use(authenticate);

router.get('/content-plan', getPlan);
router.post('/content-plan', regeneratePlan);
router.patch('/content-plan/posts/:idx', patchPost);

module.exports = router;
