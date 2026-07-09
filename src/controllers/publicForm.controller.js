const Form = require('../models/Form');
const FormResponse = require('../models/FormResponse');
const Client = require('../models/Client');
const { findClientByPhone, isValidBrazilianPhone } = require('../utils/phoneMatch');
const { logActivity } = require('../services/clientActivity.service');
const { isOtherAnswer, isChoiceAnswerEmpty } = require('../utils/choiceAnswer');

function formatPublicForm(form) {
  const obj = form.toObject ? form.toObject() : form;
  return {
    title: obj.title,
    description: obj.description || '',
    questions: obj.questions || [],
  };
}

function validateAnswersAgainstForm(form, answers) {
  const questionMap = new Map(form.questions.map((q) => [q.id, q]));
  const submittedIds = new Set();

  for (const answer of answers) {
    const question = questionMap.get(answer.questionId);
    if (!question) {
      return `Pergunta inválida: ${answer.questionId}`;
    }
    submittedIds.add(answer.questionId);

    if (question.required) {
      const empty = isChoiceAnswerEmpty(answer.value);
      if (empty) {
        return `A pergunta "${question.label}" é obrigatória`;
      }
    }

    if (question.type === 'nps') {
      const num = Number(answer.value);
      if (Number.isNaN(num) || num < 0 || num > 10) {
        return `Resposta NPS inválida para "${question.label}"`;
      }
    }

    if (question.type === 'scale') {
      const num = Number(answer.value);
      if (Number.isNaN(num) || num < question.scaleMin || num > question.scaleMax) {
        return `Resposta de escala inválida para "${question.label}"`;
      }
    }

    if (question.type === 'single_choice') {
      if (isOtherAnswer(answer.value)) {
        if (!question.allowOther) {
          return `Opção inválida para "${question.label}"`;
        }
        if (question.required && !answer.value.text?.trim()) {
          return `Informe o texto da opção "${question.otherLabel || 'Outro'}"`;
        }
      } else if (!question.options.includes(String(answer.value))) {
        return `Opção inválida para "${question.label}"`;
      }
    }

    if (question.type === 'multiple_choice') {
      if (!Array.isArray(answer.value)) {
        return `Resposta inválida para "${question.label}"`;
      }
      for (const opt of answer.value) {
        if (isOtherAnswer(opt)) {
          if (!question.allowOther) {
            return `Opção inválida para "${question.label}"`;
          }
          if (question.required && !opt.text?.trim()) {
            return `Informe o texto da opção "${question.otherLabel || 'Outro'}"`;
          }
          continue;
        }
        if (!question.options.includes(String(opt))) {
          return `Opção inválida para "${question.label}"`;
        }
      }
    }
  }

  for (const question of form.questions) {
    if (question.required && !submittedIds.has(question.id)) {
      return `A pergunta "${question.label}" é obrigatória`;
    }
  }

  return null;
}

async function getPublicForm(req, res, next) {
  try {
    const { slug } = req.params;
    const form = await Form.findOne({ publicSlug: slug, status: 'active' });

    if (!form) {
      return res.status(404).json({
        success: false,
        error: 'Formulário não encontrado ou encerrado',
      });
    }

    res.json({
      success: true,
      data: formatPublicForm(form),
    });
  } catch (error) {
    next(error);
  }
}

async function submitPublicResponse(req, res, next) {
  try {
    const { slug } = req.params;
    const { phone, name, answers } = req.body;

    const form = await Form.findOne({ publicSlug: slug, status: 'active' });
    if (!form) {
      return res.status(404).json({
        success: false,
        error: 'Formulário não encontrado ou encerrado',
      });
    }

    if (!isValidBrazilianPhone(phone)) {
      return res.status(400).json({
        success: false,
        error: 'Telefone inválido. Informe DDD + número.',
      });
    }

    const validationError = validateAnswersAgainstForm(form, answers);
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    const client = await findClientByPhone(Client, form.userId, phone);
    if (!client) {
      return res.status(404).json({
        success: false,
        error: 'Telefone não encontrado. Entre em contato com a clínica.',
      });
    }

    const response = new FormResponse({
      userId: form.userId,
      formId: form._id,
      clientId: client._id,
      respondentPhone: client.phone,
      respondentName: (name || client.name || '').trim(),
      answers,
      submittedAt: new Date(),
    });

    await response.save();

    await logActivity({
      userId: form.userId,
      clientId: client._id,
      clientName: client.name,
      type: 'form_response',
      content: `Respondeu formulário: ${form.title}`,
    });

    res.status(201).json({
      success: true,
      message: 'Resposta enviada com sucesso. Obrigado!',
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getPublicForm,
  submitPublicResponse,
};
