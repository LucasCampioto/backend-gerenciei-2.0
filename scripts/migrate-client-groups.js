#!/usr/bin/env node
/**
 * Backup + migração de clientGroup: grupos A–D → categorias.
 *
 * Regra (base atual = clientes):
 *   - última venda não-demo com menos de 90 dias → cliente_ativa
 *   - sem venda ou venda há 90+ dias → cliente_inativa
 *
 * Usage:
 *   node scripts/migrate-client-groups.js
 *   node scripts/migrate-client-groups.js --apply
 *   node scripts/migrate-client-groups.js --restore=backups/clients-YYYYMMDD-HHmmss.json
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const Client = require('../src/models/Client');
const Sale = require('../src/models/Sale');

const ACTIVE_DAYS = 90;
const BACKUPS_DIR = path.join(__dirname, '..', 'backups');

function parseArgs(argv) {
  const args = { apply: false, restore: null };
  for (const arg of argv) {
    if (arg === '--apply') args.apply = true;
    if (arg.startsWith('--restore=')) {
      args.restore = arg.slice('--restore='.length);
    }
  }
  return args;
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function daysSince(date, now = new Date()) {
  if (!date) return null;
  const ms = now.getTime() - new Date(date).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

async function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI não definida no .env');
  }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');
}

async function exportClientsBackup() {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const clients = await Client.find({}).lean();
  const filePath = path.join(BACKUPS_DIR, `clients-${stamp()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(clients, null, 2), 'utf8');
  console.log(`Backup: ${filePath} (${clients.length} clientes)`);
  return { filePath, clients };
}

async function getLastSaleByClientId() {
  const rows = await Sale.aggregate([
    {
      $match: {
        clientId: { $exists: true, $ne: null },
        isDemo: { $ne: true },
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$clientId',
        lastSaleAt: { $first: '$createdAt' },
      },
    },
  ]);

  return new Map(rows.map((row) => [row._id.toString(), row.lastSaleAt]));
}

function classifyClient(client, lastSaleAt, now = new Date()) {
  const days = daysSince(lastSaleAt, now);
  const nextGroup =
    days !== null && days < ACTIVE_DAYS ? 'cliente_ativa' : 'cliente_inativa';

  return {
    clientId: client._id.toString(),
    name: client.name,
    fromGroup: client.clientGroup ?? null,
    toGroup: nextGroup,
    category: 'cliente',
    lastSaleAt: lastSaleAt
      ? (lastSaleAt instanceof Date ? lastSaleAt.toISOString() : lastSaleAt)
      : null,
    daysSinceSale: days,
    changed: client.clientGroup !== nextGroup || client.category !== 'cliente',
  };
}

async function previewClassification(clients) {
  const lastSaleMap = await getLastSaleByClientId();
  const now = new Date();
  const rows = clients.map((client) =>
    classifyClient(client, lastSaleMap.get(client._id.toString()) || null, now)
  );

  const summary = {
    total: rows.length,
    cliente_ativa: rows.filter((r) => r.toGroup === 'cliente_ativa').length,
    cliente_inativa: rows.filter((r) => r.toGroup === 'cliente_inativa').length,
    semVenda: rows.filter((r) => r.lastSaleAt == null).length,
    aAlterar: rows.filter((r) => r.changed).length,
  };

  console.log('\n--- classificação prevista ---');
  console.log(summary);
  return { rows, summary };
}

async function applyClassification(rows) {
  let modified = 0;
  for (const row of rows) {
    if (!row.changed) continue;
    const result = await Client.updateOne(
      { _id: row.clientId },
      {
        $set: {
          clientGroup: row.toGroup,
          category: row.category,
        },
      }
    );
    if (result.modifiedCount > 0) modified += 1;
  }
  console.log(`Aplicado: ${modified} documentos atualizados`);
  return modified;
}

async function restoreFromBackup(filePath) {
  const absolute = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);

  if (!fs.existsSync(absolute)) {
    throw new Error(`Arquivo de backup não encontrado: ${absolute}`);
  }

  const clients = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  if (!Array.isArray(clients)) {
    throw new Error('Backup inválido: esperado um array de clientes');
  }

  let restored = 0;
  for (const doc of clients) {
    if (!doc._id) continue;
    const { _id, ...rest } = doc;
    const result = await Client.replaceOne(
      { _id },
      { ...rest, _id },
      { upsert: true }
    );
    if (result.modifiedCount > 0 || result.upsertedCount > 0) restored += 1;
  }

  console.log(`Restore: ${restored} documentos a partir de ${absolute}`);
  return restored;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await connect();

  try {
    if (args.restore) {
      await restoreFromBackup(args.restore);
      return;
    }

    const { clients } = await exportClientsBackup();
    const { rows } = await previewClassification(clients);

    if (!args.apply) {
      console.log('\nModo leitura. Re-execute com --apply para gravar as categorias.');
      return;
    }

    await applyClassification(rows);
    console.log('\nMigração concluída.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
