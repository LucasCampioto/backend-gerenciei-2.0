const Document = require('../models/Document');
const DocumentTemplate = require('../models/DocumentTemplate');
const Client = require('../models/Client');
const mongoose = require('mongoose');
const { s3Client, BUCKET_NAME, isS3Available } = require('../config/s3');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { tenantFilter, tenantCreateFields, andFilters } = require('../utils/tenantScope');
const {
  isPersistableDocumentUrl,
  resolveStoredDocumentUrls,
  resolveDownloadUrl,
  extractS3ObjectKey,
  isTemplateObjectKey,
} = require('../utils/documentUrls');
const {
  normalizeOrigin,
  parseSignedAt,
  physicalScanError,
  digitalSignatureError,
  resolveSignerFields,
  buildDocumentListParts,
} = require('../utils/documentPayload');

function toOptionalObjectId(value) {
  if (!value || value === '') return undefined;
  if (!mongoose.Types.ObjectId.isValid(value)) return undefined;
  return value;
}

function formatDocument(doc) {
  const obj = doc.toObject ? doc.toObject() : doc;
  const persistableUrl = resolveDownloadUrl(obj);
  return {
    id: obj._id,
    fileName: obj.fileName,
    fileType: obj.fileType,
    fileUrl: isPersistableDocumentUrl(obj.fileUrl) ? obj.fileUrl : (persistableUrl || obj.fileUrl),
    userName: obj.userName,
    userEmail: obj.userEmail || null,
    title: obj.title || null,
    origin: obj.origin || 'digital_signature',
    templateId: obj.templateId ? obj.templateId.toString() : null,
    observations: obj.observations,
    signatureUrl: persistableUrl || obj.signatureUrl,
    signedAt: obj.signedAt,
    status: obj.status,
    clientId: obj.clientId ? obj.clientId.toString() : null,
    saleId: obj.saleId ? obj.saleId.toString() : null,
    procedureId: obj.procedureId ? obj.procedureId.toString() : null,
  };
}

async function getAllDocuments(req, res, next) {
  try {
    const { search, origin, startDate, endDate } = req.query;
    const { error, parts } = buildDocumentListParts({ origin, search, startDate, endDate });
    if (error) {
      return res.status(400).json({ success: false, error });
    }

    const query = andFilters(tenantFilter(req), ...parts);
    const documents = await Document.find(query).sort({ signedAt: -1 });
    
    res.json({
      success: true,
      data: documents.map(formatDocument)
    });
  } catch (error) {
    next(error);
  }
}

async function createDocument(req, res, next) {
  try {
    let {
      fileName,
      fileType,
      fileUrl,
      signatureUrl,
      userName,
      userEmail,
      observations,
      title,
      origin: originRaw,
      templateId: templateIdRaw,
      signedAt: signedAtRaw,
      clientId,
      saleId,
      procedureId,
    } = req.body;

    const origin = normalizeOrigin(originRaw);
    if (!origin) {
      return res.status(400).json({ success: false, error: 'origin inválido' });
    }

    const signedAt = parseSignedAt(signedAtRaw);
    if (signedAtRaw && signedAt === null) {
      return res.status(400).json({ success: false, error: 'Data da assinatura inválida' });
    }

    const clientObjectId = toOptionalObjectId(clientId);
    const scanError = physicalScanError({
      origin,
      clientId: clientObjectId,
      signedAt,
    });
    if (scanError) {
      return res.status(400).json({ success: false, error: scanError });
    }

    let client = null;
    if (clientObjectId) {
      client = await Client.findOne({ _id: clientObjectId, ...tenantFilter(req) });
      if (!client) {
        return res.status(400).json({ success: false, error: 'Paciente não encontrado' });
      }
    }

    const signer = resolveSignerFields({
      origin,
      client,
      userName,
      userEmail,
    });
    const signerError = digitalSignatureError({
      origin,
      userName: signer.userName,
      userEmail: signer.userEmail,
      clientId: clientObjectId,
    });
    if (signerError) {
      return res.status(400).json({ success: false, error: signerError });
    }

    const templateId = toOptionalObjectId(templateIdRaw);
    if (templateId) {
      const template = await DocumentTemplate.findOne({ _id: templateId, ...tenantFilter(req) });
      if (!template) {
        return res.status(400).json({ success: false, error: 'Modelo não encontrado' });
      }
    }

    const { fileUrl: finalFileUrl, signatureUrl: finalSignatureUrl } = resolveStoredDocumentUrls({
      uploadedLocation: req.file && req.file.location,
      fileUrl,
      signatureUrl,
    });

    if (req.file) {
      if (!fileName) {
        fileName = req.file.originalname;
      }
      if (!fileType) {
        fileType = req.file.mimetype;
      }
    }

    if (!finalFileUrl) {
      return res.status(400).json({
        success: false,
        error: 'fileUrl ou arquivo é obrigatório'
      });
    }

    if (!finalSignatureUrl) {
      return res.status(400).json({
        success: false,
        error: 'signatureUrl é obrigatório'
      });
    }

    const document = new Document({
      ...tenantCreateFields(req),
      fileName,
      fileType,
      fileUrl: finalFileUrl,
      signatureUrl: finalSignatureUrl,
      userName: signer.userName,
      userEmail: signer.userEmail,
      title: title && String(title).trim() ? String(title).trim() : undefined,
      origin,
      templateId,
      observations: observations || undefined,
      signedAt: signedAt || undefined,
      clientId: clientObjectId,
      saleId: toOptionalObjectId(saleId),
      procedureId: toOptionalObjectId(procedureId),
      status: 'Assinado'
    });
    
    await document.save();
    
    res.status(201).json({
      success: true,
      data: formatDocument(document),
      message: origin === 'physical_scan' ? 'Ficha física salva com sucesso' : 'Documento salvo com sucesso'
    });
  } catch (error) {
    next(error);
  }
}

async function downloadDocument(req, res, next) {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'ID inválido'
      });
    }
    
    const document = await Document.findOne({
      _id: id, ...tenantFilter(req)
    });
    
    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Documento não encontrado'
      });
    }
    
    const downloadUrl = resolveDownloadUrl(document);
    if (downloadUrl) {
      res.redirect(downloadUrl);
      return;
    }

    const storedUrl = document.signatureUrl || document.fileUrl || '';
    if (storedUrl.startsWith('/uploads/')) {
      return res.status(404).json({
        success: false,
        error: 'Arquivo não disponível. Este arquivo foi armazenado localmente e não está mais acessível.'
      });
    }

    return res.status(404).json({
      success: false,
      error: 'URL do documento não encontrada'
    });
  } catch (error) {
    next(error);
  }
}

async function deleteS3IfPresent(url) {
  if (!isS3Available() || !s3Client) return;
  if (!url || !url.includes('amazonaws.com')) return;
  const s3Key = extractS3ObjectKey(url);
  if (!s3Key || isTemplateObjectKey(s3Key)) return;
  await s3Client.send(new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
  }));
}

async function deleteDocument(req, res, next) {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'ID inválido'
      });
    }
    
    const document = await Document.findOne({
      _id: id, ...tenantFilter(req)
    });
    
    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Documento não encontrado'
      });
    }
    
    try {
      await deleteS3IfPresent(document.signatureUrl);
      if (document.fileUrl && document.fileUrl !== document.signatureUrl) {
        await deleteS3IfPresent(document.fileUrl);
      }
    } catch (s3Error) {
      console.error('Erro ao deletar arquivo do S3 (continuando com delete do banco):', s3Error.message);
    }
    
    await Document.findByIdAndDelete(id);
    
    res.json({
      success: true,
      message: 'Documento removido com sucesso'
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllDocuments,
  createDocument,
  downloadDocument,
  deleteDocument,
  formatDocument,
};
