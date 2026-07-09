const Form = require('../models/Form');
const FormResponse = require('../models/FormResponse');
const Client = require('../models/Client');
const mongoose = require('mongoose');
const { formatChoiceDisplayValue, normalizeChoiceForAnalytics } = require('../utils/choiceAnswer');

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

function formatResponseRow(response, clientMap, questionMap) {
  const obj = response.toObject ? response.toObject() : response;
  const client = clientMap.get(obj.clientId.toString());

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
    clientId: obj.clientId.toString(),
    clientName: client?.name || obj.respondentName || '—',
    clientPhone: client?.phone || obj.respondentPhone,
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

    const clientIds = [...new Set(responses.map((r) => r.clientId.toString()))];
    const clients = await Client.find({ _id: { $in: clientIds } }).select('name phone category');
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

    const clientIds = [...new Set(responses.map((r) => r.clientId.toString()))];
    const clients = await Client.find({ _id: { $in: clientIds } }).select('name phone category');
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
};
