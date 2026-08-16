#!/usr/bin/env node
/**
 * Seed / migração idempotente: Organization por User existente + backfill organizationId
 * nas collections de negócio.
 *
 * Usage:
 *   node scripts/migrate-to-organizations.js --dry-run
 *   node scripts/migrate-to-organizations.js --apply
 *   node scripts/migrate-to-organizations.js --apply --email=cliente@exemplo.com
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Organization = require('../src/models/Organization');
const { OWNER_PERMISSIONS } = require('../src/constants/orgPermissions');
const { ensureOwnerOrganization } = require('../src/services/organization.service');

const BUSINESS_COLLECTIONS = [
  'clients',
  'sales',
  'expenses',
  'employees',
  'procedures',
  'stockitems',
  'documents',
  'forms',
  'formresponses',
  'paymentfees',
  'clientactivities',
  'commercialactions',
  'campaigns',
  'campaignleads',
  'contentplans',
  'pricingbases',
  'simulations',
  'enhancepairs',
  'dailybriefings',
  'whatsappsettings',
  'whatsappcampaigns',
  'whatsappoutboxes',
  'whatsappreminderlogs',
  'calendarnoshows',
  'aidailycaches',
  'aiusageevents',
];

function parseArgs(argv) {
  const out = { dryRun: true, email: null };
  for (const a of argv) {
    if (a === '--apply') out.dryRun = false;
    if (a === '--dry-run') out.dryRun = true;
    if (a.startsWith('--email=')) out.email = a.slice('--email='.length).toLowerCase().trim();
  }
  return out;
}

async function backfillUserDocs(db, userId, organizationId, dryRun) {
  const filter = {
    userId: new mongoose.Types.ObjectId(userId),
    $or: [{ organizationId: null }, { organizationId: { $exists: false } }],
  };
  const set = { $set: { organizationId: new mongoose.Types.ObjectId(organizationId) } };
  const summary = [];

  for (const name of BUSINESS_COLLECTIONS) {
    const col = db.collection(name);
    const exists = await col.findOne(filter, { projection: { _id: 1 } });
    // count even if empty is fine — list collections that exist
    let matched = 0;
    try {
      matched = await col.countDocuments(filter);
    } catch {
      continue;
    }
    if (matched === 0) continue;
    if (!dryRun) {
      const result = await col.updateMany(filter, set);
      summary.push({ collection: name, matched, modified: result.modifiedCount });
    } else {
      summary.push({ collection: name, matched, modified: 0 });
    }
  }
  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI required');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const userQuery = args.email ? { email: args.email } : {};
  // Prefer owners / users without org (accounts that own data). Skip members already in an org.
  const users = await User.find(userQuery).sort({ createdAt: 1 });

  console.log(
    `\n[migrate-to-organizations] mode=${args.dryRun ? 'DRY-RUN' : 'APPLY'} users=${users.length}${
      args.email ? ` email=${args.email}` : ''
    }\n`,
  );

  let orgsCreated = 0;
  let usersUpdated = 0;
  let docsUpdated = 0;

  for (const user of users) {
    // Já é membro (não owner) com org — não criar org nova
    if (user.organizationId && user.role && user.role !== 'owner') {
      console.log(`skip member ${user.email} org=${user.organizationId} role=${user.role}`);
      continue;
    }

    let organization;
    if (args.dryRun) {
      if (user.organizationId) {
        organization = await Organization.findById(user.organizationId);
        console.log(`would keep org for ${user.email} → ${user.organizationId}`);
      } else {
        orgsCreated += 1;
        usersUpdated += 1;
        console.log(
          `would create org for ${user.email} name="${user.clinic || user.name}"`,
        );
      }
      // Estimate backfill using existing or placeholder — for dry-run without org id, use temp count by userId
      const filter = {
        userId: user._id,
        $or: [{ organizationId: null }, { organizationId: { $exists: false } }],
      };
      for (const name of BUSINESS_COLLECTIONS) {
        try {
          const n = await db.collection(name).countDocuments(filter);
          if (n > 0) {
            docsUpdated += n;
            console.log(`  would backfill ${name}: ${n}`);
          }
        } catch {
          /* collection may not exist */
        }
      }
      continue;
    }

    const result = await ensureOwnerOrganization(user, {
      name: user.clinic || user.name,
    });
    organization = result.organization;
    if (!user.organizationId || user.role !== 'owner') {
      usersUpdated += 1;
    }
    // Count new orgs: if created in this run — ensureOwner always returns org; detect via createdAt ~ now is flaky.
    // Log always.
    console.log(`owner ${user.email} → org ${organization._id} (${organization.name})`);

    const summary = await backfillUserDocs(db, user._id, organization._id, false);
    for (const row of summary) {
      docsUpdated += row.modified;
      console.log(`  ${row.collection}: matched=${row.matched} modified=${row.modified}`);
    }
    if (!user.organizationId) orgsCreated += 1;
  }

  console.log('\n--- summary ---');
  console.log({
    mode: args.dryRun ? 'dry-run' : 'apply',
    orgsCreated,
    usersUpdated,
    docsTouched: docsUpdated,
  });
  console.log(
    args.dryRun
      ? '\nRe-run with --apply to persist changes.'
      : '\nDone. Existing clients now have Organization + organizationId on business docs.',
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
