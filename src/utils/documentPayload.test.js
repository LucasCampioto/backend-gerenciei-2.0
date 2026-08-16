const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { andFilters } = require('./tenantScope');
const {
  normalizeOrigin,
  parseSignedAt,
  physicalScanError,
  digitalSignatureError,
  resolveSignerFields,
  buildDocumentListParts,
} = require('./documentPayload');

describe('normalizeOrigin', () => {
  it('defaults missing origin to digital_signature so legacy docs keep listing', () => {
    assert.equal(normalizeOrigin(undefined), 'digital_signature');
    assert.equal(normalizeOrigin(''), 'digital_signature');
  });

  it('accepts physical_scan', () => {
    assert.equal(normalizeOrigin('physical_scan'), 'physical_scan');
  });

  it('rejects unknown origin', () => {
    assert.equal(normalizeOrigin('ocr'), null);
  });
});

describe('physicalScanError', () => {
  it('requires clientId and signedAt for physical_scan', () => {
    assert.equal(
      physicalScanError({ origin: 'physical_scan', clientId: null, signedAt: new Date() }),
      'Paciente é obrigatório para ficha física'
    );
    assert.equal(
      physicalScanError({ origin: 'physical_scan', clientId: 'abc', signedAt: undefined }),
      'Data da assinatura no papel é obrigatória'
    );
    assert.equal(
      physicalScanError({
        origin: 'physical_scan',
        clientId: 'abc',
        signedAt: new Date('2026-08-12'),
      }),
      null
    );
  });

  it('does not require paper date for digital signatures', () => {
    assert.equal(
      physicalScanError({ origin: 'digital_signature', clientId: null, signedAt: undefined }),
      null
    );
  });
});

describe('resolveSignerFields', () => {
  it('uses the client name on physical_scan and allows missing email', () => {
    const fields = resolveSignerFields({
      origin: 'physical_scan',
      client: { name: 'Kamila Camilo' },
      userName: 'ignored',
      userEmail: '',
    });
    assert.equal(fields.userName, 'Kamila Camilo');
    assert.equal(fields.userEmail, undefined);
  });

  it('keeps signer name and email for digital_signature', () => {
    const fields = resolveSignerFields({
      origin: 'digital_signature',
      userName: ' Kamila ',
      userEmail: 'kamilacamilo90@gmail.com',
    });
    assert.equal(fields.userName, 'Kamila');
    assert.equal(fields.userEmail, 'kamilacamilo90@gmail.com');
  });
});

describe('digitalSignatureError', () => {
  it('requires email when there is no clientId', () => {
    assert.equal(
      digitalSignatureError({
        origin: 'digital_signature',
        userName: 'Ana',
        userEmail: undefined,
        clientId: undefined,
      }),
      'Email do usuário é obrigatório'
    );
  });

  it('allows missing email when clientId is present', () => {
    assert.equal(
      digitalSignatureError({
        origin: 'digital_signature',
        userName: 'Ana',
        userEmail: undefined,
        clientId: 'abc',
      }),
      null
    );
  });
});

describe('buildDocumentListParts', () => {
  it('keeps tenant $or when combining origin and search via andFilters', () => {
    const tenant = {
      $or: [{ organizationId: 'org1' }, { userId: 'owner1' }],
    };
    const { error, parts } = buildDocumentListParts({
      origin: 'physical_scan',
      search: 'Kamila',
    });
    assert.equal(error, null);
    const query = andFilters(tenant, ...parts);
    assert.ok(query.$and);
    assert.equal(query.$and[0].$or, tenant.$or);
    assert.equal(query.$and[1].origin, 'physical_scan');
    assert.ok(query.$and[2].$or);
  });

  it('treats missing origin as digital_signature so legacy docs keep listing', () => {
    const { error, parts } = buildDocumentListParts({ origin: 'digital_signature' });
    assert.equal(error, null);
    assert.deepEqual(parts[0].$or, [
      { origin: 'digital_signature' },
      { origin: { $exists: false } },
      { origin: null },
    ]);
  });

  it('rejects invalid origin instead of listing everything', () => {
    const { error } = buildDocumentListParts({ origin: 'blob' });
    assert.equal(error, 'origin inválido');
  });
});

describe('parseSignedAt', () => {
  it('parses ISO dates and rejects garbage', () => {
    assert.ok(parseSignedAt('2026-08-12T22:29:07.000Z') instanceof Date);
    assert.equal(parseSignedAt('not-a-date'), null);
    assert.equal(parseSignedAt(''), undefined);
  });

  it('keeps a paper YYYY-MM-DD date in the local calendar day', () => {
    const date = parseSignedAt('2026-08-12');
    assert.ok(date instanceof Date);
    assert.equal(date.getFullYear(), 2026);
    assert.equal(date.getMonth(), 7);
    assert.equal(date.getDate(), 12);
  });
});
