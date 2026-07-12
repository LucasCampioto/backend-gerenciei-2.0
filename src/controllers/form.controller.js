const crypto = require('crypto');
const Form = require('../models/Form');
const FormResponse = require('../models/FormResponse');
const mongoose = require('mongoose');

function generatePublicSlug() {
  return crypto.randomBytes(9).toString('base64url').slice(0, 12);
}

function formatForm(form, responseCount = 0) {
  const obj = form.toObject ? form.toObject() : form;
  return {
    id: obj._id.toString(),
    title: obj.title,
    description: obj.description || '',
    publicSlug: obj.publicSlug,
    status: obj.status,
    templateKey: obj.templateKey || 'custom',
    allowMultipleResponses: obj.allowMultipleResponses === true,
    questions: obj.questions || [],
    responseCount,
    createdAt: obj.createdAt instanceof Date ? obj.createdAt.toISOString() : obj.createdAt,
    updatedAt: obj.updatedAt instanceof Date ? obj.updatedAt.toISOString() : obj.updatedAt,
  };
}

async function getResponseCountsByFormIds(formIds) {
  if (!formIds.length) return {};

  const counts = await FormResponse.aggregate([
    { $match: { formId: { $in: formIds } } },
    { $group: { _id: '$formId', count: { $sum: 1 } } },
  ]);

  return counts.reduce((acc, row) => {
    acc[row._id.toString()] = row.count;
    return acc;
  }, {});
}

async function getAllForms(req, res, next) {
  try {
    const forms = await Form.find({ userId: req.userId }).sort({ createdAt: -1 });
    const formIds = forms.map((f) => f._id);
    const countMap = await getResponseCountsByFormIds(formIds);

    res.json({
      success: true,
      data: forms.map((form) => formatForm(form, countMap[form._id.toString()] || 0)),
    });
  } catch (error) {
    next(error);
  }
}

async function getFormById(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    const form = await Form.findOne({ _id: id, userId: req.userId });
    if (!form) {
      return res.status(404).json({ success: false, error: 'Formulário não encontrado' });
    }

    const responseCount = await FormResponse.countDocuments({ formId: form._id });

    res.json({
      success: true,
      data: formatForm(form, responseCount),
    });
  } catch (error) {
    next(error);
  }
}

async function createForm(req, res, next) {
  try {
    const { title, description, status, templateKey, questions, allowMultipleResponses } = req.body;

    let publicSlug = generatePublicSlug();
    let attempts = 0;
    while (attempts < 5) {
      const existing = await Form.findOne({ publicSlug });
      if (!existing) break;
      publicSlug = generatePublicSlug();
      attempts += 1;
    }

    const form = new Form({
      userId: req.userId,
      title,
      description: description || '',
      status: status || 'active',
      templateKey: templateKey || 'custom',
      allowMultipleResponses: allowMultipleResponses === true,
      questions,
      publicSlug,
    });

    await form.save();

    res.status(201).json({
      success: true,
      data: formatForm(form, 0),
      message: 'Formulário criado com sucesso',
    });
  } catch (error) {
    next(error);
  }
}

async function updateForm(req, res, next) {
  try {
    const { id } = req.params;
    const { title, description, status, templateKey, questions, allowMultipleResponses } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    const form = await Form.findOneAndUpdate(
      { _id: id, userId: req.userId },
      {
        title,
        description: description || '',
        status: status || 'active',
        templateKey: templateKey || 'custom',
        allowMultipleResponses: allowMultipleResponses === true,
        questions,
      },
      { new: true, runValidators: true }
    );

    if (!form) {
      return res.status(404).json({ success: false, error: 'Formulário não encontrado' });
    }

    const responseCount = await FormResponse.countDocuments({ formId: form._id });

    res.json({
      success: true,
      data: formatForm(form, responseCount),
      message: 'Formulário atualizado com sucesso',
    });
  } catch (error) {
    next(error);
  }
}

async function deleteForm(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    const form = await Form.findOneAndDelete({ _id: id, userId: req.userId });
    if (!form) {
      return res.status(404).json({ success: false, error: 'Formulário não encontrado' });
    }

    await FormResponse.deleteMany({ formId: form._id });

    res.json({
      success: true,
      message: 'Formulário removido com sucesso',
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllForms,
  getFormById,
  createForm,
  updateForm,
  deleteForm,
  formatForm,
};
