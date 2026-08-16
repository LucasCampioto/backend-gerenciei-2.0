const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const DocumentTemplate = require('./DocumentTemplate');
const { tenantFilter, tenantCreateFields, assertSameTenant } = require('../utils/tenantScope');

const ORG_A = '6a7f51c5428df3b528a5936e';
const ORG_B = '6a7f51c5428df3b528a5936f';
const USER_A = '69653d3c1dbcc56c465b9ee7';
const USER_B = '69653d3c1dbcc56c465b9ee8';
const TEMPLATE_URL = 'https://gerenciei-documentos.s3.us-east-2.amazonaws.com/templates/1-2.pdf';

describe('DocumentTemplate schema', () => {
  it('accepts a named blank PDF on the templates/ prefix', () => {
    const create = tenantCreateFields({
      orgId: ORG_A,
      orgOwnerUserId: USER_A,
      userId: USER_A,
    });
    const doc = new DocumentTemplate({
      ...create,
      name: 'Anamnese',
      fileName: 'anamnese.pdf',
      fileType: 'application/pdf',
      fileUrl: TEMPLATE_URL,
    });
    assert.equal(doc.validateSync(), undefined);
    assert.equal(doc.organizationId.toString(), ORG_A);
    assert.equal(doc.name, 'Anamnese');
  });

  it('rejects a template without a name', () => {
    const doc = new DocumentTemplate({
      userId: new mongoose.Types.ObjectId(),
      fileName: 'anamnese.pdf',
      fileType: 'application/pdf',
      fileUrl: TEMPLATE_URL,
    });
    const err = doc.validateSync();
    assert.ok(err && err.errors.name);
  });
});

describe('DocumentTemplate org isolation', () => {
  it('GET-style tenantFilter for org A does not match a template created in org B', () => {
    const createdInB = tenantCreateFields({
      orgId: ORG_B,
      orgOwnerUserId: USER_B,
      userId: USER_B,
    });
    const templateB = {
      _id: new mongoose.Types.ObjectId(),
      ...createdInB,
      name: 'Termo org B',
      fileUrl: TEMPLATE_URL,
    };

    const reqA = { orgId: ORG_A, orgOwnerUserId: USER_A, userId: USER_A };
    const reqB = { orgId: ORG_B, orgOwnerUserId: USER_B, userId: USER_B };

    assert.equal(assertSameTenant(reqA, templateB), false);
    assert.equal(assertSameTenant(reqB, templateB), true);
    assert.equal(tenantFilter(reqA).$or[0].organizationId.toString(), ORG_A);
    assert.notEqual(tenantFilter(reqA).$or[0].organizationId.toString(), ORG_B);
  });
});
