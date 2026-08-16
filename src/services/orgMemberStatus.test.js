const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateMemberStatusChange } = require('./orgMemberStatus');

const base = {
  actorUserId: 'admin1',
  actorRole: 'owner',
  memberId: 'member1',
  memberRole: 'member',
  currentStatus: 'active',
};

describe('validateMemberStatusChange', () => {
  it('allows the owner to disable a member and does not consume a seat', () => {
    const out = validateMemberStatusChange({ ...base, nextStatus: 'disabled' });
    assert.equal(out.nextStatus, 'disabled');
    assert.equal(out.needsSeat, false);
  });

  it('requires a seat when reactivating a disabled member', () => {
    const out = validateMemberStatusChange({
      ...base,
      currentStatus: 'disabled',
      nextStatus: 'active',
    });
    assert.equal(out.needsSeat, true);
  });

  it('rejects disabling the organization owner', () => {
    assert.throws(
      () =>
        validateMemberStatusChange({
          ...base,
          memberId: 'owner1',
          memberRole: 'owner',
          nextStatus: 'disabled',
        }),
      (err) => err.status === 400 && /dono/.test(err.message),
    );
  });

  it('rejects disabling yourself', () => {
    assert.throws(
      () =>
        validateMemberStatusChange({
          ...base,
          actorUserId: 'member1',
          memberId: 'member1',
          nextStatus: 'disabled',
        }),
      (err) => err.status === 400 && /si mesmo/.test(err.message),
    );
  });

  it('allows only the owner to disable an admin', () => {
    assert.throws(
      () =>
        validateMemberStatusChange({
          ...base,
          actorRole: 'admin',
          memberRole: 'admin',
          nextStatus: 'disabled',
        }),
      (err) => err.status === 403,
    );
    const out = validateMemberStatusChange({
      ...base,
      actorRole: 'owner',
      memberRole: 'admin',
      nextStatus: 'disabled',
    });
    assert.equal(out.nextStatus, 'disabled');
  });

  it('rejects unknown status values', () => {
    assert.throws(
      () => validateMemberStatusChange({ ...base, nextStatus: 'banned' }),
      (err) => err.status === 400,
    );
  });
});
