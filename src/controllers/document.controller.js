const Document = require('../models/Document');
const mongoose = require('mongoose');
const { s3Client, BUCKET_NAME, isS3Available } = require('../config/s3');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');

function formatDocument(doc) {
  const obj = doc.toObject();
  return {
    id: obj._id,
    fileName: obj.fileName,
    fileType: obj.fileType,
    fileUrl: obj.fileUrl,
    userName: obj.userName,
    userEmail: obj.userEmail,
    observations: obj.observations,
    signatureUrl: obj.signatureUrl,
    signedAt: obj.signedAt,
    status: obj.status
  };
}

async function getAllDocuments(req, res, next) {
  try {
    const { search } = req.query;
    
    const query = { userId: req.userId };
    
    if (search) {
      query.$or = [
        { fileName: { $regex: search, $options: 'i' } },
        { userName: { $regex: search, $options: 'i' } },
        { userEmail: { $regex: search, $options: 'i' } }
      ];
    }
    
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
    let { fileName, fileType, fileUrl, signatureUrl, userName, userEmail, observations } = req.body;
    
    // Se houver arquivo no upload, processar
    let finalFileUrl = fileUrl;
    let finalSignatureUrl = signatureUrl;
    
    if (req.file) {
      // Se foi feito upload para S3, usar a location (URL pública) do arquivo
      // req.file.location contém a URL pública do arquivo no S3
      const s3Url = req.file.location;
      finalFileUrl = s3Url;
      
      // Se signatureUrl não foi fornecido, usar a mesma URL do arquivo
      if (!finalSignatureUrl) {
        finalSignatureUrl = s3Url;
      }
      
      // Se não foi fornecido, usar o nome do arquivo do upload
      if (!fileName) {
        fileName = req.file.originalname;
      }
      // Se não foi fornecido, usar o tipo do arquivo do upload
      if (!fileType) {
        fileType = req.file.mimetype;
      }
    }
    
    // Se não houver fileUrl e não houver arquivo, retornar erro
    if (!finalFileUrl) {
      return res.status(400).json({
        success: false,
        error: 'fileUrl ou arquivo é obrigatório'
      });
    }
    
    // Validar que signatureUrl foi fornecido
    if (!finalSignatureUrl) {
      return res.status(400).json({
        success: false,
        error: 'signatureUrl é obrigatório'
      });
    }
    
    const document = new Document({
      userId: req.userId,
      fileName,
      fileType,
      fileUrl: finalFileUrl,
      signatureUrl: finalSignatureUrl,
      userName,
      userEmail,
      observations: observations || undefined,
      status: 'Assinado'
    });
    
    await document.save();
    
    res.status(201).json({
      success: true,
      data: formatDocument(document),
      message: 'Documento salvo com sucesso'
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
      _id: id,
      userId: req.userId
    });
    
    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Documento não encontrado'
      });
    }
    
    // Se for URL do S3 ou URL externa, redirecionar
    if (document.signatureUrl && (document.signatureUrl.startsWith('http://') || document.signatureUrl.startsWith('https://'))) {
      // Redirecionar para URL do S3 ou URL externa
      res.redirect(document.signatureUrl);
    } else if (document.signatureUrl && document.signatureUrl.startsWith('/uploads/')) {
      // Mantém compatibilidade com uploads locais antigos (fallback)
      return res.status(404).json({
        success: false,
        error: 'Arquivo não disponível. Este arquivo foi armazenado localmente e não está mais acessível.'
      });
    } else {
      return res.status(404).json({
        success: false,
        error: 'URL do documento não encontrada'
      });
    }
  } catch (error) {
    next(error);
  }
}

// Função auxiliar para extrair a key do S3 a partir da URL
function extractS3KeyFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  
  try {
    // Se for URL do S3, extrair a key
    // Exemplo: https://gerenciei-documentos.s3.us-east-1.amazonaws.com/documents/1234567890-987654321.pdf
    const s3UrlPattern = /https?:\/\/[^\/]+\/(.+)$/;
    const match = url.match(s3UrlPattern);
    return match ? match[1] : null;
  } catch (error) {
    return null;
  }
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
    
    // Buscar documento
    const document = await Document.findOne({
      _id: id,
      userId: req.userId
    });
    
    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Documento não encontrado'
      });
    }
    
    // Tentar deletar arquivo do S3 se estiver lá
    if (isS3Available() && s3Client) {
      try {
        // Verificar se signatureUrl é uma URL do S3
        if (document.signatureUrl && document.signatureUrl.includes('amazonaws.com')) {
          const s3Key = extractS3KeyFromUrl(document.signatureUrl);
          
          if (s3Key) {
            const deleteCommand = new DeleteObjectCommand({
              Bucket: BUCKET_NAME,
              Key: s3Key
            });
            
            await s3Client.send(deleteCommand);
            console.log(`Arquivo deletado do S3: ${s3Key}`);
          }
        }
        
        // Também deletar fileUrl se for diferente do signatureUrl
        if (document.fileUrl && document.fileUrl.includes('amazonaws.com') && document.fileUrl !== document.signatureUrl) {
          const fileS3Key = extractS3KeyFromUrl(document.fileUrl);
          
          if (fileS3Key) {
            const deleteCommand = new DeleteObjectCommand({
              Bucket: BUCKET_NAME,
              Key: fileS3Key
            });
            
            await s3Client.send(deleteCommand);
            console.log(`Arquivo deletado do S3: ${fileS3Key}`);
          }
        }
      } catch (s3Error) {
        // Log do erro mas continua para deletar do banco mesmo assim
        console.error('Erro ao deletar arquivo do S3 (continuando com delete do banco):', s3Error.message);
      }
    } else {
      console.warn('⚠️ S3 não disponível. Arquivo não deletado do S3.');
    }
    
    // Deletar documento do banco de dados
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
  deleteDocument
};

