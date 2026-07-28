const mongoose = require('mongoose');
const Simulation = require('../../models/Simulation');
const Client = require('../../models/Client');
const ClientActivity = require('../../models/ClientActivity');
const { clientHasPhotoConsent } = require('./clientPhotoConsent');

const MAX_IMAGE_LEN = 120_000;

function trimImage(s) {
  if (!s || typeof s !== 'string') return '';
  return s.length > MAX_IMAGE_LEN ? '' : s;
}

function simulationToDto(doc) {
  return {
    id: String(doc._id),
    clientId: String(doc.clientId),
    /** Alias legado LUNI — mesmos valores de clientId. */
    patientId: String(doc.clientId),
    clientName: doc.clientName,
    patientName: doc.clientName,
    clientPhone: doc.clientPhone || undefined,
    patientPhone: doc.clientPhone || undefined,
    clientEmail: doc.clientEmail || undefined,
    patientEmail: doc.clientEmail || undefined,
    procedure: doc.procedure,
    procedureId: doc.procedureId || undefined,
    date: doc.date instanceof Date ? doc.date.toISOString() : new Date(doc.date).toISOString(),
    intensity: doc.intensity,
    points: doc.points != null ? doc.points : undefined,
    costPerPoint: doc.costPerPoint != null ? doc.costPerPoint : undefined,
    image: doc.image || undefined,
    enhancePairId: doc.enhancePairId || undefined,
    activePointIds: Array.isArray(doc.activePointIds) && doc.activePointIds.length ? doc.activePointIds : undefined,
    saleCompleted: doc.saleCompleted === true,
    clientConsentAt: doc.clientConsentAt ? doc.clientConsentAt.toISOString() : undefined,
    clientConsentVersion: doc.clientConsentVersion || undefined,
    patientConsentAt: doc.clientConsentAt ? doc.clientConsentAt.toISOString() : undefined,
    patientConsentVersion: doc.clientConsentVersion || undefined,
  };
}

async function findOrCreateClientByContact(userId, { name, phone, email }) {
  const ph = String(phone || '').trim();
  const nm = String(name || '').trim();
  if (ph) {
    const existing = await Client.findOne({ userId, phone: ph });
    if (existing) {
      const patch = {};
      if (nm && !existing.name) patch.name = nm;
      if (Object.keys(patch).length) {
        await Client.updateOne({ _id: existing._id }, { $set: patch });
      }
      return existing._id;
    }
  }
  if (!nm || !ph) {
    throw new Error('name e phone são obrigatórios para criar cliente');
  }
  const created = await Client.create({
    userId,
    name: nm,
    phone: ph,
    category: 'lead',
  });
  return created._id;
}

async function listSimulations(userId, { clientId, patientId, procedure, from, to }) {
  const filter = { userId };
  const cid = clientId || patientId;
  if (cid && mongoose.isValidObjectId(cid)) filter.clientId = cid;
  if (procedure && String(procedure).trim()) filter.procedure = String(procedure).trim();

  if (from || to) {
    filter.date = {};
    if (from) {
      const [y, m, d] = String(from).split('-').map(Number);
      if (y && m && d) filter.date.$gte = new Date(y, m - 1, d);
    }
    if (to) {
      const [y, m, d] = String(to).split('-').map(Number);
      if (y && m && d) filter.date.$lte = new Date(y, m - 1, d, 23, 59, 59, 999);
    }
  }

  const docs = await Simulation.find(filter).sort({ date: -1 }).lean();
  return docs.map(simulationToDto);
}

async function createSimulation(userId, body) {
  /** Crédito já é consumido em POST /v1/enhance ao gerar a IA. Salvar no histórico não debita de novo. */

  let clientObjectId = null;
  const bodyClientId = body.clientId || body.patientId;
  const nested = body.client || body.patient;

  if (bodyClientId && mongoose.isValidObjectId(bodyClientId)) {
    const c = await Client.findOne({ _id: bodyClientId, userId });
    if (!c) return { error: 'Cliente não encontrado', status: 404 };
    clientObjectId = c._id;
  } else if (nested && (nested.name || nested.email || nested.phone)) {
    try {
      clientObjectId = await findOrCreateClientByContact(userId, {
        name: nested.name,
        email: nested.email,
        phone: nested.phone,
      });
    } catch (e) {
      return { error: e.message || 'Dados do cliente inválidos', status: 400 };
    }
  } else if (
    String(body.clientName || body.patientName || '').trim() ||
    String(body.clientEmail || body.patientEmail || '').trim() ||
    String(body.clientPhone || body.patientPhone || '').trim()
  ) {
    try {
      clientObjectId = await findOrCreateClientByContact(userId, {
        name: body.clientName || body.patientName,
        email: body.clientEmail || body.patientEmail,
        phone: body.clientPhone || body.patientPhone,
      });
    } catch (e) {
      return { error: e.message || 'Dados do cliente inválidos', status: 400 };
    }
  } else {
    return { error: 'Informe clientId ou dados do cliente (client)', status: 400 };
  }

  const client = await Client.findById(clientObjectId).lean();
  if (!client || String(client.userId) !== String(userId)) {
    return { error: 'Cliente inválido', status: 400 };
  }

  if (!clientHasPhotoConsent(client)) {
    return { error: 'Consentimento do cliente necessário antes de salvar a simulação.', status: 400 };
  }

  const date = body.date ? new Date(body.date) : new Date();
  const snapName =
    String(body.clientName ?? body.patientName ?? '').trim() || String(client.name ?? '').trim();
  const snapPhone =
    String(body.clientPhone ?? body.patientPhone ?? '').trim() || String(client.phone ?? '').trim();
  const snapEmail = String(body.clientEmail ?? body.patientEmail ?? '').trim();

  const doc = await Simulation.create({
    userId,
    clientId: clientObjectId,
    clientName: snapName,
    clientPhone: snapPhone,
    clientEmail: snapEmail,
    procedure: String(body.procedure || '').trim(),
    procedureId: String(body.procedureId || '').trim(),
    date,
    intensity: Number(body.intensity) || 0,
    points: body.points != null ? Number(body.points) : null,
    costPerPoint: body.costPerPoint != null ? Number(body.costPerPoint) : null,
    image: trimImage(body.image),
    enhancePairId: String(body.enhancePairId || '').trim(),
    activePointIds: Array.isArray(body.activePointIds)
      ? body.activePointIds.map(Number).filter((n) => !Number.isNaN(n))
      : [],
    clientConsentAt: client.photoConsentAt || null,
    clientConsentVersion: client.photoConsentVersion || '',
  });

  const procedureLabel = String(body.procedure || '').trim() || 'procedimento';
  await ClientActivity.create({
    userId,
    clientId: clientObjectId,
    clientName: snapName,
    type: 'simulation',
    content: `Simulação salva: ${procedureLabel}`,
  }).catch((err) => {
    console.warn('[simulations] activity log failed:', err.message);
  });

  return { simulation: simulationToDto(doc.toObject()) };
}

async function deleteSimulation(userId, simulationId) {
  if (!mongoose.isValidObjectId(simulationId)) return { error: 'Simulação inválida', status: 400 };
  const doc = await Simulation.findOneAndDelete({ _id: simulationId, userId });
  if (!doc) return { error: 'Simulação não encontrada', status: 404 };
  return { ok: true };
}

/** Atualiza campos permitidos de uma simulação (allowlist: saleCompleted). */
async function patchSimulation(userId, simulationId, patch) {
  if (!mongoose.isValidObjectId(simulationId)) return { error: 'Simulação inválida', status: 400 };
  const allowed = ['saleCompleted'];
  const update = {};
  for (const k of allowed) {
    if (patch[k] !== undefined) update[k] = patch[k];
  }
  if (Object.keys(update).length === 0) return { error: 'Nenhum campo válido para atualizar', status: 400 };
  const doc = await Simulation.findOneAndUpdate(
    { _id: simulationId, userId },
    { $set: update },
    { new: true },
  );
  if (!doc) return { error: 'Simulação não encontrada', status: 404 };

  if (update.saleCompleted === true) {
    await ClientActivity.create({
      userId,
      clientId: doc.clientId,
      clientName: doc.clientName || '',
      type: 'simulation',
      content: `Simulação marcada como venda: ${doc.procedure || 'procedimento'}`,
    }).catch((err) => {
      console.warn('[simulations] saleCompleted activity failed:', err.message);
    });
  }

  return { simulation: simulationToDto(doc.toObject()) };
}

module.exports = {
  simulationToDto,
  listSimulations,
  createSimulation,
  deleteSimulation,
  patchSimulation,
};
