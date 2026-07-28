/**
 * Migra dados LUNI → Gerenciei (somente leitura na LUNI — nunca deleta nada lá).
 *
 * Fonte: luni-backend/.env → MONGODB_URI (cluster LUNI / beleza_estrategica)
 * Destino: backend-gerenciei-2.0/.env → MONGODB_URI (gerenciei)
 *
 * Uso:
 *   node scripts/migrate-luni-to-gerenciei.js --dry-run
 *   node scripts/migrate-luni-to-gerenciei.js --apply
 *
 * Flags:
 *   --dry-run   (padrão) só reporta
 *   --apply     escreve na Gerenciei
 *   --email=x   limita a um e-mail
 */
const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function digits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function argFlag(name) {
  return process.argv.includes(`--${name}`);
}

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : '';
}

const APPLY = argFlag('apply');
const DRY_RUN = !APPLY;
const ONLY_EMAIL = String(argValue('email') || '').toLowerCase().trim();

const ROOT = path.join(__dirname, '..');
const LUNI_ENV = parseEnvFile(path.join(ROOT, '../luni-backend/.env'));
const GER_ENV = parseEnvFile(path.join(ROOT, '.env'));

const LUNI_URI = LUNI_ENV.MONGODB_URI;
const GER_URI = GER_ENV.MONGODB_URI;

if (!LUNI_URI || !GER_URI) {
  console.error('Defina MONGODB_URI em luni-backend/.env e backend-gerenciei-2.0/.env');
  process.exit(1);
}

/** Campos de billing/perfil copiados no MERGE (nunca password / Google). */
const USER_MERGE_FIELDS = [
  'clinic',
  'phone',
  'notifEmail',
  'notifSms',
  'stripeCustomerId',
  'stripeSubscriptionId',
  'subscriptionStatus',
  'trialEndsAt',
  'currentPeriodEnd',
  'cancelAtPeriodEnd',
  'simulationMonthlyQuota',
  'simulationCreditsRemaining',
  'simulationQuotaPeriodKey',
  'previewMonthlyQuota',
  'previewCreditsRemaining',
  'previewQuotaPeriodKey',
  'accountType',
  'partnerTestExpiresAt',
  'termsAcceptedAt',
  'privacyAcceptedAt',
  'termsVersion',
  'patientDataResponsibilityAckAt',
  'firstAccess',
];

function isEmptyValue(v) {
  if (v == null) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  return false;
}

/**
 * Merge: preenche vazios; campos Stripe/cota da LUNI sempre vêm se existirem na LUNI
 * (exceto firstAccess — se Gerenciei já é false, mantém).
 */
function buildUserMergeSet(luniUser, gerUser) {
  const set = {};
  for (const key of USER_MERGE_FIELDS) {
    const src = luniUser[key];
    if (src === undefined) continue;

    if (key === 'firstAccess') {
      // Não forçar firstAccess=true em conta que já usa o app
      if (gerUser.firstAccess === false) continue;
      set[key] = src === true;
      continue;
    }

    const stripeOrQuota =
      key.startsWith('stripe') ||
      key.startsWith('subscription') ||
      key.startsWith('simulation') ||
      key.startsWith('preview') ||
      key === 'trialEndsAt' ||
      key === 'currentPeriodEnd' ||
      key === 'cancelAtPeriodEnd' ||
      key === 'accountType' ||
      key === 'partnerTestExpiresAt';

    if (stripeOrQuota) {
      if (!isEmptyValue(src) || src === false || typeof src === 'number') {
        set[key] = src;
      }
      continue;
    }

    // clinic, phone, notifs, terms: só se Gerenciei vazio
    if (isEmptyValue(gerUser[key]) && !isEmptyValue(src)) {
      set[key] = src;
    }
  }
  set.updatedAt = new Date();
  return set;
}

function patientToClientDoc(patient, gerUserId) {
  const now = new Date();
  return {
    userId: gerUserId,
    name: String(patient.name || '').trim() || 'Cliente',
    phone: String(patient.phone || '').trim() || '00000000000',
    category: 'lead',
    isNewClient: true,
    convertedAt: null,
    clientGroup: 'grupo_a',
    noReturnReason: '',
    improvementReason: '',
    leadSource: null,
    leadSourceOther: '',
    pipelineStage: 'new',
    leadScore: null,
    qualification: {
      pain: '',
      goal: '',
      budgetBand: '',
      urgency: '',
      procedureInterest: [],
      missingQuestions: [],
      nextStep: '',
      summary: '',
      scoredAt: null,
      agentRunId: '',
    },
    nextFollowUpAt: null,
    lostReason: '',
    assignedTo: '',
    photoConsentAt: patient.photoConsentAt || null,
    photoConsentVersion: patient.photoConsentVersion || '',
    photoConsentMethod: patient.photoConsentMethod || 'attested_by_professional',
    photoConsentedByUserId: patient.photoConsentedByUserId
      ? gerUserId
      : null,
    createdAt: patient.createdAt || now,
    updatedAt: now,
    __v: 0,
    _migratedFromLuniPatientId: String(patient._id),
  };
}

function simulationToGerDoc(sim, gerUserId, clientId) {
  return {
    _id: sim._id instanceof ObjectId ? sim._id : new ObjectId(String(sim._id)),
    userId: gerUserId,
    clientId,
    clientName: sim.patientName || sim.clientName || '',
    clientPhone: sim.patientPhone || sim.clientPhone || '',
    clientEmail: sim.patientEmail || sim.clientEmail || '',
    procedure: sim.procedure,
    procedureId: sim.procedureId || '',
    date: sim.date,
    intensity: sim.intensity ?? 0,
    points: sim.points ?? null,
    costPerPoint: sim.costPerPoint ?? null,
    image: sim.image || '',
    enhancePairId: sim.enhancePairId || '',
    activePointIds: Array.isArray(sim.activePointIds) ? sim.activePointIds : [],
    saleCompleted: sim.saleCompleted === true,
    clientConsentAt: sim.patientConsentAt || sim.clientConsentAt || null,
    clientConsentVersion: sim.patientConsentVersion || sim.clientConsentVersion || '',
    createdAt: sim.createdAt,
    updatedAt: sim.updatedAt || new Date(),
    __v: sim.__v ?? 0,
    _migratedFromLuni: true,
  };
}

function enhancePairToGerDoc(pair, gerUserId) {
  return {
    _id: pair._id instanceof ObjectId ? pair._id : new ObjectId(String(pair._id)),
    pairId: pair.pairId,
    userId: gerUserId,
    originalKey: pair.originalKey,
    afterKey: pair.afterKey,
    originalContentType: pair.originalContentType || 'image/jpeg',
    afterContentType: pair.afterContentType || 'image/png',
    createdAt: pair.createdAt,
    updatedAt: pair.updatedAt || new Date(),
    __v: pair.__v ?? 0,
    _migratedFromLuni: true,
  };
}

function usageToGerDoc(ev, gerUserId, clientId) {
  return {
    _id: ev._id instanceof ObjectId ? ev._id : new ObjectId(String(ev._id)),
    userId: gerUserId,
    userEmail: ev.userEmail || '',
    userName: ev.userName || '',
    accountType: ev.accountType === 'partner_test' ? 'partner_test' : 'official',
    stripeSubscriptionId: ev.stripeSubscriptionId || '',
    eventType: ev.eventType,
    outcome: ev.outcome,
    clientId: clientId || null,
    procedureTypes: Array.isArray(ev.procedureTypes) ? ev.procedureTypes : [],
    practiceProfile: ev.practiceProfile || '',
    intensityPct: ev.intensityPct ?? null,
    regioes: ev.regioes || '',
    enhancePairId: ev.enhancePairId || '',
    inputImageBytes: ev.inputImageBytes || 0,
    latencyMs: ev.latencyMs || 0,
    attempts: Array.isArray(ev.attempts) ? ev.attempts : [],
    promptTokens: ev.promptTokens || 0,
    outputTokens: ev.outputTokens || 0,
    totalTokens: ev.totalTokens || 0,
    agentAttempts: ev.agentAttempts || 0,
    billableAttempts: ev.billableAttempts || 0,
    successfulAttempts: ev.successfulAttempts || 0,
    estimatedCostUsd: ev.estimatedCostUsd || 0,
    pricingSnapshot: ev.pricingSnapshot || null,
    createdAt: ev.createdAt,
    updatedAt: ev.updatedAt || new Date(),
    __v: ev.__v ?? 0,
    _migratedFromLuni: true,
  };
}

async function migrateUser(luniDb, gerDb, luniUser, stats) {
  const email = String(luniUser.email || '').toLowerCase().trim();
  console.log(`\n── ${email} ──`);

  let gerUser = await gerDb.collection('users').findOne({ email });
  let gerUserId;
  let mode;

  if (gerUser) {
    mode = 'MERGE';
    gerUserId = gerUser._id;
    const set = buildUserMergeSet(luniUser, gerUser);
    console.log(`  user: MERGE → ${gerUserId}`);
    console.log(`  user.$set keys: ${Object.keys(set).filter((k) => k !== 'updatedAt').join(', ') || '(nenhum)'}`);
    if (!DRY_RUN && Object.keys(set).length > 1) {
      await gerDb.collection('users').updateOne({ _id: gerUserId }, { $set: set });
    }
    stats.usersMerged += 1;
  } else {
    mode = 'CREATE';
    // Preserva _id LUNI quando possível (não colide com Gerenciei)
    const existingId = await gerDb.collection('users').findOne({ _id: luniUser._id });
    gerUserId = existingId ? new ObjectId() : luniUser._id;
    const doc = {
      _id: gerUserId,
      name: luniUser.name,
      email,
      // LUNI passwordHash → Gerenciei password (sem re-hash)
      password: luniUser.passwordHash,
      googleCalendarConnected: false,
      googleRefreshToken: null,
      googleAccessToken: null,
      googleTokenExpiry: null,
      googleCalendarEmail: null,
      googleCalendarId: null,
      googleCalendarName: null,
      onboardingCompleted: false,
      clinic: luniUser.clinic || '',
      phone: luniUser.phone || '',
      notifEmail: luniUser.notifEmail !== false,
      notifSms: luniUser.notifSms === true,
      firstAccess: luniUser.firstAccess === true,
      stripeCustomerId: luniUser.stripeCustomerId || undefined,
      stripeSubscriptionId: luniUser.stripeSubscriptionId || undefined,
      subscriptionStatus: luniUser.subscriptionStatus || '',
      trialEndsAt: luniUser.trialEndsAt || null,
      currentPeriodEnd: luniUser.currentPeriodEnd || null,
      cancelAtPeriodEnd: luniUser.cancelAtPeriodEnd === true,
      simulationMonthlyQuota: luniUser.simulationMonthlyQuota ?? 0,
      simulationCreditsRemaining: luniUser.simulationCreditsRemaining ?? 0,
      simulationQuotaPeriodKey: luniUser.simulationQuotaPeriodKey || '',
      previewMonthlyQuota: luniUser.previewMonthlyQuota ?? 0,
      previewCreditsRemaining: luniUser.previewCreditsRemaining ?? 0,
      previewQuotaPeriodKey: luniUser.previewQuotaPeriodKey || '',
      accountType: luniUser.accountType === 'partner_test' ? 'partner_test' : 'official',
      partnerTestExpiresAt: luniUser.partnerTestExpiresAt || null,
      termsAcceptedAt: luniUser.termsAcceptedAt || null,
      privacyAcceptedAt: luniUser.privacyAcceptedAt || null,
      termsVersion: luniUser.termsVersion || '',
      patientDataResponsibilityAckAt: luniUser.patientDataResponsibilityAckAt || null,
      createdAt: luniUser.createdAt || new Date(),
      updatedAt: new Date(),
      __v: 0,
      _migratedFromLuniUserId: String(luniUser._id),
    };
    // Remove undefined sparse unique fields
    if (!doc.stripeCustomerId) delete doc.stripeCustomerId;
    if (!doc.stripeSubscriptionId) delete doc.stripeSubscriptionId;

    console.log(`  user: CREATE → ${gerUserId} (luni ${luniUser._id})`);
    if (!DRY_RUN) {
      await gerDb.collection('users').insertOne(doc);
    }
    stats.usersCreated += 1;
    gerUser = doc;
  }

  // ── patients → clients ──
  const patients = await luniDb.collection('patients').find({ userId: luniUser._id }).toArray();
  const existingClients = await gerDb
    .collection('clients')
    .find({ userId: gerUserId })
    .toArray();
  const clientByPhone = new Map();
  for (const c of existingClients) {
    const d = digits(c.phone);
    if (d) clientByPhone.set(d, c);
  }

  /** @type {Map<string, ObjectId>} */
  const patientToClient = new Map();

  for (const p of patients) {
    const d = digits(p.phone);
    const hit = d ? clientByPhone.get(d) : null;
    if (hit) {
      patientToClient.set(String(p._id), hit._id);
      const patch = {};
      if (!hit.photoConsentAt && p.photoConsentAt) {
        patch.photoConsentAt = p.photoConsentAt;
        patch.photoConsentVersion = p.photoConsentVersion || '';
        patch.photoConsentMethod = p.photoConsentMethod || 'attested_by_professional';
        patch.photoConsentedByUserId = gerUserId;
      }
      console.log(`  client: MERGE phone ${d || '(vazio)'} patient ${p._id} → ${hit._id} (${p.name})`);
      if (!DRY_RUN && Object.keys(patch).length) {
        await gerDb.collection('clients').updateOne({ _id: hit._id }, { $set: { ...patch, updatedAt: new Date() } });
      }
      stats.clientsMerged += 1;
    } else {
      const newDoc = patientToClientDoc(p, gerUserId);
      // Preferir manter _id do patient se livre na Gerenciei
      const idTaken = await gerDb.collection('clients').findOne({ _id: p._id });
      const newId = idTaken ? new ObjectId() : p._id;
      newDoc._id = newId;
      patientToClient.set(String(p._id), newId);
      if (d) clientByPhone.set(d, { _id: newId, phone: p.phone });
      console.log(`  client: CREATE ${newId} ← patient ${p._id} (${p.name})`);
      if (!DRY_RUN) {
        await gerDb.collection('clients').insertOne(newDoc);
      }
      stats.clientsCreated += 1;
    }
  }

  // ── simulations ──
  const sims = await luniDb.collection('simulations').find({ userId: luniUser._id }).toArray();
  for (const sim of sims) {
    const clientId = patientToClient.get(String(sim.patientId));
    if (!clientId) {
      console.warn(`  sim SKIP ${sim._id}: patient ${sim.patientId} sem client mapeado`);
      stats.simulationsSkipped += 1;
      continue;
    }
    const exists = await gerDb.collection('simulations').findOne({ _id: sim._id });
    if (exists) {
      console.log(`  sim SKIP (já existe) ${sim._id}`);
      stats.simulationsSkipped += 1;
      continue;
    }
    const doc = simulationToGerDoc(sim, gerUserId, clientId);
    console.log(`  sim INSERT ${doc._id} → client ${clientId}`);
    if (!DRY_RUN) {
      await gerDb.collection('simulations').insertOne(doc);
    }
    stats.simulationsInserted += 1;
  }

  // ── enhancepairs ──
  const pairs = await luniDb.collection('enhancepairs').find({ userId: luniUser._id }).toArray();
  for (const pair of pairs) {
    const byPairId = await gerDb.collection('enhancepairs').findOne({ pairId: pair.pairId });
    if (byPairId) {
      console.log(`  pair SKIP pairId=${pair.pairId}`);
      stats.pairsSkipped += 1;
      continue;
    }
    const byId = await gerDb.collection('enhancepairs').findOne({ _id: pair._id });
    const doc = enhancePairToGerDoc(pair, gerUserId);
    if (byId) doc._id = new ObjectId();
    console.log(`  pair INSERT ${doc.pairId}`);
    if (!DRY_RUN) {
      await gerDb.collection('enhancepairs').insertOne(doc);
    }
    stats.pairsInserted += 1;
  }

  // ── aiusageevents ──
  const events = await luniDb.collection('aiusageevents').find({ userId: luniUser._id }).toArray();
  for (const ev of events) {
    const exists = await gerDb.collection('aiusageevents').findOne({ _id: ev._id });
    if (exists) {
      stats.usageSkipped += 1;
      continue;
    }
    const clientId = ev.patientId ? patientToClient.get(String(ev.patientId)) : null;
    const doc = usageToGerDoc(ev, gerUserId, clientId || null);
    console.log(`  usage INSERT ${doc._id} (${doc.eventType}/${doc.outcome})`);
    if (!DRY_RUN) {
      await gerDb.collection('aiusageevents').insertOne(doc);
    }
    stats.usageInserted += 1;
  }

  console.log(`  done (${mode}): patients=${patients.length} sims=${sims.length} pairs=${pairs.length} usage=${events.length}`);
}

async function main() {
  console.log(DRY_RUN ? '=== DRY-RUN (nada será escrito) ===' : '=== APPLY (escreve na Gerenciei) ===');
  console.log('LUNI: leitura apenas — nenhum delete/update na origem');
  console.log('Fonte LUNI URI host:', LUNI_URI.replace(/\/\/[^@]+@/, '//***@').slice(0, 80));
  console.log('Destino Gerenciei URI host:', GER_URI.replace(/\/\/[^@]+@/, '//***@').slice(0, 80));

  const luniClient = new MongoClient(LUNI_URI);
  const gerClient = new MongoClient(GER_URI);
  await luniClient.connect();
  await gerClient.connect();

  const luniDb = luniClient.db('beleza_estrategica');
  const gerDb = gerClient.db('gerenciei');

  const filter = ONLY_EMAIL ? { email: ONLY_EMAIL } : {};
  const luniUsers = await luniDb.collection('users').find(filter).sort({ email: 1 }).toArray();
  console.log(`Usuários LUNI a processar: ${luniUsers.length}`);

  const stats = {
    usersMerged: 0,
    usersCreated: 0,
    clientsMerged: 0,
    clientsCreated: 0,
    simulationsInserted: 0,
    simulationsSkipped: 0,
    pairsInserted: 0,
    pairsSkipped: 0,
    usageInserted: 0,
    usageSkipped: 0,
  };

  for (const u of luniUsers) {
    await migrateUser(luniDb, gerDb, u, stats);
  }

  console.log('\n=== RESUMO ===');
  console.log(JSON.stringify(stats, null, 2));
  console.log(DRY_RUN ? '\nPara aplicar: node scripts/migrate-luni-to-gerenciei.js --apply' : '\nMigração aplicada.');
  console.log('LUNI permanece intacta (somente leitura).');

  await luniClient.close();
  await gerClient.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
