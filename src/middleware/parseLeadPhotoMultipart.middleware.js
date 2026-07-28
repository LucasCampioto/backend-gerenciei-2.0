const busboy = require('busboy');
const { MAX_PHOTO_BYTES } = require('../services/campaignDiagnosisSimulation');

/**
 * Parseia multipart simples: campo `image` (+ opcional `uploadToken` em form field).
 */
function parseLeadPhotoMultipart(req) {
  return new Promise((resolve, reject) => {
    let uploadToken = '';
    /** @type {Buffer | null} */
    let fileBuffer = null;
    let filename = 'selfie.jpg';
    let mime = 'image/jpeg';

    const bb = busboy({
      headers: req.headers,
      limits: { fileSize: MAX_PHOTO_BYTES },
    });

    bb.on('file', (name, file, info) => {
      if (name !== 'image') {
        file.resume();
        return;
      }
      filename = info.filename || filename;
      mime = info.mimeType || mime;
      const chunks = [];
      file.on('data', (d) => chunks.push(d));
      file.on('limit', () => {
        reject(Object.assign(new Error('Foto muito grande (máx. 8 MB).'), { statusCode: 400 }));
      });
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    bb.on('field', (name, val) => {
      if (name === 'uploadToken') uploadToken = String(val || '');
    });

    bb.on('error', reject);
    bb.on('finish', () => {
      resolve({
        uploadToken: uploadToken || String(req.query?.uploadToken || req.headers['x-upload-token'] || ''),
        buffer: fileBuffer,
        mime,
        filename,
      });
    });

    req.pipe(bb);
  });
}

module.exports = { parseLeadPhotoMultipart };
