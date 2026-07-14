const Form = require('../models/Form');
const FormResponse = require('../models/FormResponse');
const Client = require('../models/Client');
const mongoose = require('mongoose');
const { formatChoiceDisplayValue, normalizeChoiceForAnalytics } = require('../utils/choiceAnswer');
const { findClientByPhone, stripPhoneDigits } = require('../utils/phoneMatch');
const { logActivity } = require('../services/clientActivity.service');

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

function formatResponseRow(response, clientMap, questionMap) {
  const obj = response.toObject ? response.toObject() : response;
  const clientId = obj.clientId ? obj.clientId.toString() : '';
  const client = clientId ? clientMap.get(clientId) : null;
  const respondentName = String(obj.respondentName || '').trim();

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

    const form = await Form.findOne({ _id: id, userId: req.userId });
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
      _id: { $in: clientIds },
      userId: req.userId,
    }).select('name phone category');
    const clientMap = new Map(clients.map((c) => [c._id.toString(), c]));
    const questionMap = new Map(form.questions.map((q) => [q.id, q]));

    res.json({
      success: true,
      data: {
        responses: responses.map((r) => formatResponseRow(r, clientMap, questionMap)),
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

    const form = await Form.findOne({ _id: id, userId: req.userId });
    if (!form) {
      return res.status(404).json({ success: false, error: 'Formulário não encontrado' });
    }

    const response = await FormResponse.findOne({
      _id: responseId,
      formId: form._id,
      userId: req.userId,
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
      client = await Client.findOne({ _id: response.clientId, userId: req.userId });
    }

    if (!client && response.respondentPhone) {
      client = await findClientByPhone(Client, req.userId, response.respondentPhone);
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

      client = new Client({
        userId: req.userId,
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
        userId: req.userId,
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
        converted = true;
        await logActivity({
          userId: req.userId,
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

    const form = await Form.findOne({ _id: id, userId: req.userId });
    if (!form) {
      return res.status(404).json({ success: false, error: 'Formulário não encontrado' });
    }

    const dateFilter = parseDateRange(req.query.startDate, req.query.endDate);
    const query = { formId: form._id };
    if (dateFilter) query.submittedAt = dateFilter;

    const responses = await FormResponse.find(query).sort({ submittedAt: -1 });

    const clientIds = [...new Set(responses.map((r) => r.clientId.toString()).filter(Boolean))];
    const clients = await Client.find({
      _id: { $in: clientIds },
      userId: req.userId,
    }).select('name phone category');
    const clientMap = new Map(clients.map((c) => [c._id.toString(), c]));
    const questionMap = new Map(form.questions.map((q) => [q.id, q]));

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
          npsScore: npsQuestions.length === 1 ? npsQuestions[0].npsScore : null,
          npsAverage: npsQuestions.length === 1 ? npsQuestions[0].average : null,
        },
        questionAnalytics,
        recentResponses: responses.slice(0, 10).map((r) => formatResponseRow(r, clientMap, questionMap)),
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
