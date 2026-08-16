const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { requireOrgAdmin } = require('../middleware/orgAuth.middleware');
const {
  getOrganization,
  getMembers,
  patchMember,
  deleteMember,
  getInvites,
  postInvite,
  postRevokeInvite,
  postResendInvite,
} = require('../controllers/organization.controller');

router.use(authenticate);

router.get('/', getOrganization);

router.get('/members', requireOrgAdmin, getMembers);
router.patch('/members/:memberId', requireOrgAdmin, patchMember);
router.delete('/members/:memberId', requireOrgAdmin, deleteMember);

router.get('/invites', requireOrgAdmin, getInvites);
router.post('/invites', requireOrgAdmin, postInvite);
router.post('/invites/:inviteId/revoke', requireOrgAdmin, postRevokeInvite);
router.post('/invites/:inviteId/resend', requireOrgAdmin, postResendInvite);

module.exports = router;
