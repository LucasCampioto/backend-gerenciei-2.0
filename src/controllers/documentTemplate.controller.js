const DocumentTemplate = require('../models/DocumentTemplate');
const mongoose = require('mongoose');
const { s3Client, BUCKET_NAME, isS3Available } = require('../config/s3');
const { DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { tenantFilter, tenantCreateFields } = require('../utils/tenantScope');
const { isPersistableDocumentUrl, extractS3ObjectKey, isTemplateObjectKey } = require('../utils/documentUrls');

function formatTemplate(doc) {
  const obj = doc.toObject ? doc.toObject() : doc;
  return {
    id: obj._id.toString(),
    name: obj.name,
    fileName: obj.fileName,
    fileType: obj.fileType,
    fileUrl: obj.fileUrl,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

async function getAllTemplates(req, res, next) {
  try {
    const templates = await DocumentTemplate.find(tenantFilter(req)).sort({ createdAt: -1 });
    res.json({
      success: true,
      data: templates.map(formatTemplate),
    });
  } catch (error) {
    next(error);
  }
}

async function deleteTemplateObject(url) {
  const key = extractS3ObjectKey(url);
  if (!isTemplateObjectKey(key) || !isS3Available() || !s3Client) return;
  await s3Client.send(new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  }));
}

async function applyUploadedFile(template, req) {
  if (!req.file || !req.file.location) {
    return 'Arquivo do modelo é obrigatório';
  }
  if (!isPersistableDocumentUrl(req.file.location)) {
    return 'Falha ao persistir o arquivo do modelo';
  }
  const key = extractS3ObjectKey(req.file.location);
  if (key && !isTemplateObjectKey(key)) {
    return 'Arquivo do modelo deve ir para o prefixo templates/';
  }
  template.fileName = req.body.fileName || req.file.originalname;
  template.fileType = req.body.fileType || req.file.mimetype;
  template.fileUrl = req.file.location;
  return null;
}

async function createTemplate(req, res, next) {
  try {
    const name = (req.body.name || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, error: 'Nome do modelo é obrigatório' });
    }

    const template = new DocumentTemplate({
      ...tenantCreateFields(req),
      name,
    });
    const fileError = await applyUploadedFile(template, req);
    if (fileError) {
      return res.status(400).json({ success: false, error: fileError });
    }

    await template.save();

    res.status(201).json({
      success: true,
      data: formatTemplate(template),
      message: 'Modelo salvo com sucesso',
    });
  } catch (error) {
    next(error);
  }
}

async function updateTemplate(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    const template = await DocumentTemplate.findOne({ _id: id, ...tenantFilter(req) });
    if (!template) {
      return res.status(404).json({ success: false, error: 'Modelo não encontrado' });
    }

    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const hasFile = Boolean(req.file);
    if (!name && !hasFile) {
      return res.status(400).json({ success: false, error: 'Informe o nome ou um novo arquivo' });
    }

    if (name) template.name = name;

    if (hasFile) {
      const previousUrl = template.fileUrl;
      const fileError = await applyUploadedFile(template, req);
      if (fileError) {
        return res.status(400).json({ success: false, error: fileError });
      }
      if (previousUrl && previousUrl !== template.fileUrl) {
        try {
          await deleteTemplateObject(previousUrl);
        } catch (s3Error) {
          console.error('Erro ao substituir modelo no S3 (continuando):', s3Error.message);
        }
      }
    }

    await template.save();

    res.json({
      success: true,
      data: formatTemplate(template),
      message: 'Modelo atualizado com sucesso',
    });
  } catch (error) {
    next(error);
  }
}

async function downloadTemplate(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    const template = await DocumentTemplate.findOne({ _id: id, ...tenantFilter(req) });
    if (!template) {
      return res.status(404).json({ success: false, error: 'Modelo não encontrado' });
    }

    const key = extractS3ObjectKey(template.fileUrl);
    if (key && isS3Available() && s3Client) {
      const obj = await s3Client.send(new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      }));
      const bytes = await obj.Body.transformToByteArray();
      const safeName = String(template.fileName || 'modelo').replace(/[\r\n"]/g, '_');
      res.setHeader('Content-Type', template.fileType);
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(safeName)}"`
      );
      return res.send(Buffer.from(bytes));
    }

    if (isPersistableDocumentUrl(template.fileUrl)) {
      return res.redirect(template.fileUrl);
    }

    return res.status(404).json({ success: false, error: 'Arquivo do modelo não encontrado' });
  } catch (error) {
    next(error);
  }
}

async function deleteTemplate(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    const template = await DocumentTemplate.findOne({ _id: id, ...tenantFilter(req) });
    if (!template) {
      return res.status(404).json({ success: false, error: 'Modelo não encontrado' });
    }

    try {
      await deleteTemplateObject(template.fileUrl);
    } catch (s3Error) {
      console.error('Erro ao deletar modelo no S3 (continuando com delete do banco):', s3Error.message);
    }

    await DocumentTemplate.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Modelo removido com sucesso',
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllTemplates,
  createTemplate,
  updateTemplate,
  downloadTemplate,
  deleteTemplate,
};
