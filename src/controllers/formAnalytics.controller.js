const Form = require('../models/Form');
const FormResponse = require('../models/FormResponse');
const Client = require('../models/Client');
const Sale = require('../models/Sale');
const Procedure = require('../models/Procedure');
const mongoose = require('mongoose');
const { formatChoiceDisplayValue, normalizeChoiceForAnalytics } = require('../utils/choiceAnswer');
const { findClientByPhone, stripPhoneDigits } = require('../utils/phoneMatch');
const { findClientByNormalizedName } = require('../utils/nameMatch');
const { logActivity } = require('../services/clientActivity.service');
const { tenantFilter, tenantDocFilter, tenantCreateFields, scopeUserId, andFilters } = require('../utils/tenantScope');

function percentileSorted(sortedAsc, percentile) {
  if (!sortedAsc.length) return 0;
  const index = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.floor((percentile / 100) * (sortedAsc.length - 1)))
  );
  return sortedAsc[index];
}

function parseDateRange(startDate, endDate) {
  const filter = {};
  if (startDate) {
    const start = new Date(startDate);
    if (!Number.isNaN(start.getTime())) filter.$gte = start;
  }
  if (endDate) {
    const end = new Date(endDate);
    if (!Number.isNaN(end.getTime())) {
      end.setHours(23, 59, 59, 999);
      filter.$lte = end;
    }
  }
  return Object.keys(filter).length ? filter : null;
}

function isGenericLeadName(name) {
  const trimmed = String(name || '').trim();
  return !trimmed || trimmed === 'Lead formulário' || trimmed === '—';
}

function pickRespondentDisplayName(client, respondentName) {
  const fromResponse = String(respondentName || '').trim();
  const fromClient = String(client?.name || '').trim();
  if (!isGenericLeadName(fromResponse)) return fromResponse;
  if (!isGenericLeadName(fromClient)) return fromClient;
  return fromResponse || fromClient || '—';
}

function countAudience(clientIds, clientMap) {
  let clientCount = 0;
  let leadCount = 0;
  for (const id of clientIds) {
    if (clientMap.get(id)?.category === 'cliente') clientCount += 1;
    else leadCount += 1;
  }
  return { clientCount, leadCount };
}

async function loadClientProcedureHistory(req, clientIds) {
  const objectIds = clientIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (!objectIds.length) return new Map();

  const sales = await Sale.find(andFilters(tenantFilter(req), {
    clientId: { $in: objectIds },
    isDemo: { $ne: true },
  }))
    .select('clientId createdAt items.procedureName')
    .sort({ createdAt: -1 })
    .lean();

  const history = new Map();
  for (const sale of sales) {
    const id = String(sale.clientId);
    if (!history.has(id)) {
      history.set(id, { procedures: [], lastVisitAt: sale.createdAt || null });
    }
    const entry = history.get(id);
    const date = sale.createdAt instanceof Date
      ? sale.createdAt.toISOString()
      : (sale.createdAt || null);
    for (const item of sale.items || []) {
      const name = String(item.procedureName || '').trim();
      if (name) entry.procedures.push({ name, date });
    }
  }
  return history;
}

function normalizeProcedureKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

async function loadProcedurePriceIndex(req) {
  const procedures = await Procedure.find(tenantFilter(req)).select('name value').lean();
  const byName = new Map();
  const values = [];
  for (const proc of procedures) {
    const value = Number(proc.value);
    if (!Number.isFinite(value)) continue;
    const key = normalizeProcedureKey(proc.name);
    if (key) byName.set(key, value);
    if (value > 0) values.push(value);
  }
  values.sort((a, b) => a - b);
  return {
    byName,
    lowMax: percentileSorted(values, 33),
    highMin: percentileSorted(values, 66),
  };
}

function procedureTicketBand(value, lowMax, highMin) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (amount <= lowMax) return 'low';
  if (amount > highMin) return 'high';
  return 'mid';
}

function buildTicketGroups(clientIds, clientMap, historyMap, priceIndex) {
  const groups = { low: new Map(), high: new Map() };

  for (const id of clientIds) {
    const client = clientMap.get(id);
    if (client?.category !== 'cliente') continue;
    const procedures = historyMap.get(id)?.procedures || [];
    for (const proc of procedures) {
      const value = priceIndex.byName.get(normalizeProcedureKey(proc.name));
      const band = procedureTicketBand(value, priceIndex.lowMax, priceIndex.highMin);
      if (band !== 'low' && band !== 'high') continue;
      if (!groups[band].has(id)) {
        groups[band].set(id, {
          clientId: id,
          clientName: client.name || 'Cliente',
          clientPhone: client.phone || '',
          procedures: [],
        });
      }
      const entry = groups[band].get(id);
      const date = proc.date || null;
      const duplicate = entry.procedures.some((item) => item.name === proc.name && item.date === date);
      if (!duplicate) {
        entry.procedures.push({
          name: proc.name,
          date,
          value,
        });
      }
    }
  }

  const toList = (map) => [...map.values()].sort((a, b) =>
    a.clientName.localeCompare(b.clientName, 'pt-BR')
  );

  return {
    lowMax: priceIndex.lowMax,
    highMin: priceIndex.highMin,
    lowTicketClients: toList(groups.low),
    highTicketClients: toList(groups.high),
  };
}

function formatResponseRow(response, clientMap, questionMap, historyMap = new Map()) {
  const obj = response.toObject ? response.toObject() : response;
  const clientId = obj.clientId ? obj.clientId.toString() : '';
  const client = clientId ? clientMap.get(clientId) : null;
  const respondentName = String(obj.respondentName || '').trim();
  const isClient = client?.category === 'cliente';
  const history = isClient ? historyMap.get(clientId) : null;
  const lastVisit = history?.lastVisitAt || null;

  const formattedAnswers = (obj.answers || []).map((answer) => {
    const question = questionMap.get(answer.questionId);
    const displayValue = formatChoiceDisplayValue(answer.value);
    return {
      questionId: answer.questionId,
      questionLabel: question?.label || answer.questionId,
      questionType: question?.type || 'unknown',
      value: answer.value,
      displayValue,
    };
  });

  return {
    id: obj._id.toString(),
    clientId: client?._id?.toString() || clientId,
    clientExists: Boolean(client),
    clientName: pickRespondentDisplayName(client, respondentName),
    respondentName: respondentName || null,
    clientPhone: client?.phone || obj.respondentPhone || '',
    clientCategory: client?.category || null,
    submittedAt: obj.submittedAt instanceof Date
      ? obj.submittedAt.toISOString()
      : obj.submittedAt,
    procedures: isClient ? (history?.procedures || []) : [],
    lastVisitAt: isClient && lastVisit
      ? (lastVisit instanceof Date ? lastVisit.toISOString() : lastVisit)
      : null,
    answers: formattedAnswers,
  };
}

function aggregateNps(responses, questionId) {
  const scores = responses
    .flatMap((r) => r.answers.filter((a) => a.questionId === questionId))
    .map((a) => Number(a.value))
    .filter((n) => !Number.isNaN(n) && n >= 0 && n <= 10);

  if (!scores.length) {
    return null;
  }

  const distribution = Array.from({ length: 11 }, (_, score) => ({
    score,
    count: scores.filter((s) => s === score).length,
  }));

  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  const passives = scores.length - promoters - detractors;
  const average = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  const npsScore = Math.round(((promoters - detractors) / scores.length) * 100);

  return {
    questionId,
    totalResponses: scores.length,
    average: Math.round(average * 10) / 10,
    npsScore,
    promoters,
    passives,
    detractors,
    distribution,
  };
}

function aggregateChoice(responses, question) {
  const counts = {};
  for (const opt of question.options) counts[opt] = 0;
  if (question.allowOther) {
    counts[question.otherLabel || 'Outro'] = 0;
  }

  let total = 0;
  for (const response of responses) {
    for (const answer of response.answers) {
      if (answer.questionId !== question.id) continue;
      if (Array.isArray(answer.value)) {
        for (const val of answer.value) {
          const key = normalizeChoiceForAnalytics(val, question.otherLabel || 'Outro');
          counts[key] = (counts[key] || 0) + 1;
          total += 1;
        }
      } else {
        const key = normalizeChoiceForAnalytics(answer.value, question.otherLabel || 'Outro');
        counts[key] = (counts[key] || 0) + 1;
        total += 1;
      }
    }
  }

  const breakdown = Object.entries(counts).map(([option, count]) => ({
    option,
    count,
    percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
  })).sort((a, b) => b.count - a.count);

  return {
    questionId: question.id,
    totalResponses: total,
    breakdown,
  };
}

function aggregateScale(responses, questionId, scaleMin, scaleMax) {
  const values = responses
    .flatMap((r) => r.answers.filter((a) => a.questionId === questionId))
    .map((a) => Number(a.value))
    .filter((n) => !Number.isNaN(n));

  if (!values.length) return null;

  const distribution = [];
  for (let i = scaleMin; i <= scaleMax; i += 1) {
    distribution.push({
      score: i,
      count: values.filter((v) => v === i).length,
    });
  }

  const average = values.reduce((sum, v) => sum + v, 0) / values.length;

  return {
    questionId,
    totalResponses: values.length,
    average: Math.round(average * 10) / 10,
    distribution,
  };
}

function aggregateText(responses, questionId) {
  const items = [];
  for (const response of responses) {
    for (const answer of response.answers) {
      if (answer.questionId !== questionId) continue;
      const text = String(answer.value || '').trim();
      if (!text) continue;
      items.push({
        responseId: response._id.toString(),
        clientId: response.clientId.toString(),
        clientName: response.respondentName,
        submittedAt: response.submittedAt,
        text,
      });
    }
  }
  return {
    questionId,
    totalResponses: items.length,
    items,
  };
}

async function getFormResponses(req, res, next) {
  try {
    const { id } = req.params;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    const form = await Form.findOne({ _id: id, ...tenantFilter(req) });
    if (!form) {
      return res.status(404).json({ success: false, error: 'Formulário não encontrado' });
    }

    const dateFilter = parseDateRange(req.query.startDate, req.query.endDate);
    const query = { formId: form._id };
    if (dateFilter) query.submittedAt = dateFilter;

    const [responses, total] = await Promise.all([
      FormResponse.find(query).sort({ submittedAt: -1 }).skip(skip).limit(limit),
      FormResponse.countDocuments(query),
    ]);

    const clientIds = [...new Set(responses.map((r) => r.clientId.toString()).filter(Boolean))];
    const clients = await Client.find({
      _id: { $in: clientIds }, ...tenantFilter(req),
    }).select('name phone category');
    const clientMap = new Map(clients.map((c) => [c._id.toString(), c]));
    const questionMap = new Map(form.questions.map((q) => [q.id, q]));
    const clientCategoryIds = clients
      .filter((c) => c.category === 'cliente')
      .map((c) => c._id.toString());
    const historyMap = await loadClientProcedureHistory(req, clientCategoryIds);

    res.json({
      success: true,
      data: {
        responses: responses.map((r) => formatResponseRow(r, clientMap, questionMap, historyMap)),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

async function convertResponseToClient(req, res, next) {
  try {
    const { id, responseId } = req.params;
    const {
      name,
      leadSource,
      leadSourceOther,
    } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(responseId)) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    const form = await Form.findOne({ _id: id, ...tenantFilter(req) });
    if (!form) {
      return res.status(404).json({ success: false, error: 'Formulário não encontrado' });
    }

    const response = await FormResponse.findOne({
      _id: responseId,
      formId: form._id,
      ...tenantCreateFields(req),
    });

    if (!response) {
      return res.status(404).json({ success: false, error: 'Resposta não encontrada' });
    }

    const requestedName = typeof name === 'string' ? name.trim() : '';
    if (!requestedName) {
      return res.status(400).json({ success: false, error: 'Informe o nome do cliente' });
    }

    const allowedSources = ['redes_sociais', 'google', 'indicacao', 'outros'];
    const nextLeadSource =
      leadSource && allowedSources.includes(leadSource) ? leadSource : null;
    const nextLeadSourceOther =
      nextLeadSource === 'outros'
        ? String(leadSourceOther || '').trim()
        : '';

    if (nextLeadSource === 'outros' && !nextLeadSourceOther) {
      return res.status(400).json({
        success: false,
        error: 'Informe de onde veio quando selecionar Outros',
      });
    }

    let client = null;
    if (response.clientId && mongoose.Types.ObjectId.isValid(response.clientId)) {
      client = await Client.findOne({ _id: response.clientId, ...tenantFilter(req) });
    }

    if (!client && response.respondentPhone) {
      client = await findClientByPhone(Client, scopeUserId(req), response.respondentPhone);
    }

    const formTitle = (form.title || 'Formulário').trim() || 'Formulário';
    let created = false;
    let converted = false;

    if (!client) {
      const phone = stripPhoneDigits(response.respondentPhone || '');
      if (!phone) {
        return res.status(400).json({
          success: false,
          error: 'Não há telefone nesta resposta para recriar o cadastro',
        });
      }

      const nameDuplicate = await findClientByNormalizedName(
        Client,
        scopeUserId(req),
        requestedName
      );
      if (nameDuplicate) {
        return res.status(409).json({
          success: false,
          error: `Já existe um cadastro com este nome (${nameDuplicate.name}).`,
          code: 'DUPLICATE_CLIENT_NAME',
        });
      }

      client = new Client({
        ...tenantCreateFields(req),
        name: requestedName,
        phone,
        category: 'cliente',
        isNewClient: true,
        convertedAt: new Date(),
        clientGroup: 'grupo_a',
        leadSource: nextLeadSource ?? 'outros',
        leadSourceOther:
          nextLeadSource === 'outros'
            ? nextLeadSourceOther
            : nextLeadSource
              ? ''
              : `Formulário: ${formTitle}`.slice(0, 120),
      });
      if (!nextLeadSource) {
        client.leadSource = 'outros';
        client.leadSourceOther = `Formulário: ${formTitle}`.slice(0, 120);
      }
      await client.save();
      created = true;
      converted = true;

      await logActivity({
        ...tenantCreateFields(req),
        clientId: client._id,
        clientName: client.name,
        type: 'note',
        content: 'Convertido de lead para cliente (a partir da resposta do formulário)',
      });
    } else {
      client.name = requestedName;
      if (nextLeadSource !== undefined) {
        client.leadSource = nextLeadSource;
        client.leadSourceOther = nextLeadSourceOther;
      }
      if (client.category !== 'cliente') {
        client.category = 'cliente';
        client.convertedAt = new Date();
        const stageNow = client.pipelineStage ?? 'new';
        if (
          !stageNow ||
          stageNow === 'new' ||
          stageNow === 'qualified' ||
          stageNow === 'proposal' ||
          stageNow === 'negotiation'
        ) {
          client.pipelineStage = 'won';
        }
        converted = true;
        await logActivity({
          ...tenantCreateFields(req),
          clientId: client._id,
          clientName: client.name,
          type: 'note',
          content: 'Convertido de lead para cliente',
        });
      }
      await client.save();
    }

    if (!response.clientId || response.clientId.toString() !== client._id.toString()) {
      response.clientId = client._id;
      await response.save();
    }

    if (response.respondentName !== requestedName) {
      response.respondentName = requestedName;
      await response.save();
    }

    res.json({
      success: true,
      message: converted
        ? created
          ? 'Cadastro recriado e convertido em cliente'
          : 'Lead convertido em cliente'
        : 'Cliente atualizado',
      data: {
        id: client._id.toString(),
        name: client.name,
        phone: client.phone,
        category: client.category,
        created,
        converted,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getFormAnalytics(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    const form = await Form.findOne({ _id: id, ...tenantFilter(req) });
    if (!form) {
      return res.status(404).json({ success: false, error: 'Formulário não encontrado' });
    }

    const dateFilter = parseDateRange(req.query.startDate, req.query.endDate);
    const query = { formId: form._id };
    if (dateFilter) query.submittedAt = dateFilter;

    const responses = await FormResponse.find(query).sort({ submittedAt: -1 });

    const clientIds = [...new Set(responses.map((r) => r.clientId.toString()).filter(Boolean))];
    const clients = await Client.find({
      _id: { $in: clientIds }, ...tenantFilter(req),
    }).select('name phone category');
    const clientMap = new Map(clients.map((c) => [c._id.toString(), c]));
    const questionMap = new Map(form.questions.map((q) => [q.id, q]));
    const clientCategoryIds = clients
      .filter((c) => c.category === 'cliente')
      .map((c) => c._id.toString());
    const historyMap = await loadClientProcedureHistory(req, clientCategoryIds);
    const audience = countAudience(clientIds, clientMap);
    const priceIndex = await loadProcedurePriceIndex(req);
    const ticketGroups = buildTicketGroups(clientIds, clientMap, historyMap, priceIndex);

    const questionAnalytics = form.questions.map((question) => {
      const base = {
        questionId: question.id,
        label: question.label,
        type: question.type,
      };

      if (question.type === 'nps') {
        return { ...base, nps: aggregateNps(responses, question.id) };
      }
      if (question.type === 'single_choice' || question.type === 'multiple_choice') {
        return { ...base, choice: aggregateChoice(responses, question) };
      }
      if (question.type === 'scale') {
        return { ...base, scale: aggregateScale(responses, question.id, question.scaleMin, question.scaleMax) };
      }
      if (question.type === 'short_text' || question.type === 'long_text') {
        const textData = aggregateText(responses, question.id);
        const items = textData.items.map((item) => {
          const client = clientMap.get(item.clientId);
          return {
            ...item,
            clientName: client?.name || item.clientName,
            clientPhone: client?.phone || null,
            submittedAt: item.submittedAt instanceof Date
              ? item.submittedAt.toISOString()
              : item.submittedAt,
          };
        });
        return { ...base, text: { ...textData, items } };
      }
      return base;
    });

    const npsQuestions = questionAnalytics
      .filter((q) => q.nps)
      .map((q) => q.nps);

    res.json({
      success: true,
      data: {
        form: {
          id: form._id.toString(),
          title: form.title,
          description: form.description || '',
        },
        summary: {
          totalResponses: responses.length,
          uniqueClients: clientIds.length,
          clientCount: audience.clientCount,
          leadCount: audience.leadCount,
          lowTicketMax: ticketGroups.lowMax,
          highTicketMin: ticketGroups.highMin,
          lowTicketClients: ticketGroups.lowTicketClients,
          highTicketClients: ticketGroups.highTicketClients,
          npsScore: npsQuestions.length === 1 ? npsQuestions[0].npsScore : null,
          npsAverage: npsQuestions.length === 1 ? npsQuestions[0].average : null,
        },
        questionAnalytics,
        recentResponses: responses.slice(0, 10).map((r) => formatResponseRow(r, clientMap, questionMap, historyMap)),
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getFormResponses,
  getFormAnalytics,
  convertResponseToClient,
};
