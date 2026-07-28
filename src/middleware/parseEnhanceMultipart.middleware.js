const busboy = require('busboy');

const MAX_FILE_BYTES = 15 * 1024 * 1024;

/**
 * Parseia multipart do mesmo formato do front (image + tipo_procedimento repetido + regioes + intensidade + intensidade_pct opcional + practice_profile opcional).
 * @param {import('express').Request} req
 */
function parseEnhanceMultipart(req) {
  return new Promise((resolve, reject) => {
    const tipos = [];
    let regioes = '';
    let intensidade = '';
    let practiceProfile = '';
    let detalhes = '';
    /** @type {string} */
    let siliconeAck = '';
    /** @type {string} */
    let clientId = '';
    /** @type {string} */
    let clientConsentAck = '';
    /** @type {string} */
    let imageRightsAck = '';
    /** @type {number | undefined} */
    let intensidadePct;
    /** @type {Buffer | null} */
    let fileBuffer = null;
    let filename = 'upload.jpg';
    let mime = 'image/jpeg';

    const bb = busboy({
      headers: req.headers,
      limits: { fileSize: MAX_FILE_BYTES },
    });

    bb.on('file', (name, file, info) => {
      if (name !== 'image') {
        file.resume();
        return;
      }
      filename = info.filename || 'upload.jpg';
      mime = info.mimeType || 'image/jpeg';
      const chunks = [];
      file.on('data', (d) => chunks.push(d));
      file.on('limit', () => {
        file.resume();
        reject(new Error('Arquivo muito grande'));
      });
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    bb.on('field', (name, val) => {
      if (name === 'tipo_procedimento' && val && String(val).trim()) {
        tipos.push(String(val).trim());
      } else if (name === 'regioes') {
        regioes = String(val ?? '');
      } else if (name === 'intensidade') {
        intensidade = String(val ?? '');
      } else if (name === 'intensidade_pct' || name === 'intensidade_percent') {
        const raw = String(val ?? '').trim();
        if (raw) {
          const n = Number.parseInt(raw, 10);
          if (!Number.isNaN(n)) intensidadePct = Math.max(0, Math.min(100, n));
        }
      } else if (name === 'practice_profile') {
        practiceProfile = String(val ?? '').trim();
      } else if (name === 'detalhes') {
        detalhes = String(val ?? '');
      } else if (name === 'silicone_ack') {
        siliconeAck = String(val ?? '').trim();
      } else if (name === 'client_id' || name === 'patient_id') {
        clientId = String(val ?? '').trim();
      } else if (name === 'client_consent_ack' || name === 'patient_consent_ack') {
        clientConsentAck = String(val ?? '').trim();
      } else if (name === 'image_rights_ack') {
        imageRightsAck = String(val ?? '').trim();
      }
    });

    bb.on('finish', () => {
      resolve({
        fileBuffer,
        filename,
        mime,
        tipos,
        regioes,
        intensidade,
        intensidadePct,
        practiceProfile,
        detalhes,
        siliconeAck,
        clientId,
        clientConsentAck,
        imageRightsAck,
      });
    });

    bb.on('error', reject);
    req.pipe(bb);
  });
}

module.exports = { parseEnhanceMultipart };
