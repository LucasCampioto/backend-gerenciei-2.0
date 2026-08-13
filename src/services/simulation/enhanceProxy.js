const axios = require('axios');
const FormData = require('form-data');

const ENHANCE_TIMEOUT_MS = Number(process.env.ENHANCE_AGENT_TIMEOUT_MS || 180000);

/**
 * Encaminha o mesmo multipart ao agente (mesmo host que AGNO_BASE_URL).
 * @param {string} agentBaseUrl
 * @param {{ buffer: Buffer, filename: string, mime: string, tipos: string[], regioes: string, intensidade: string, intensidadePct?: number, practiceProfile?: string, detalhes?: string }} parts
 */
async function forwardEnhanceToAgent(agentBaseUrl, parts) {
  const base = String(agentBaseUrl || '').replace(/\/$/, '');
  const fd = new FormData();
  fd.append('image', parts.buffer, {
    filename: parts.filename || 'upload.jpg',
    contentType: parts.mime || 'image/jpeg',
  });
  for (const t of parts.tipos) {
    if (t) fd.append('tipo_procedimento', t);
  }
  fd.append('regioes', parts.regioes || '');
  fd.append('intensidade', parts.intensidade || 'moderado');
  const ip =
    parts.intensidadePct != null && Number.isFinite(parts.intensidadePct)
      ? Math.max(0, Math.min(100, Math.round(parts.intensidadePct)))
      : null;
  if (ip !== null) {
    fd.append('intensidade_pct', String(ip));
  }
  const pp = parts.practiceProfile && String(parts.practiceProfile).trim();
  if (pp) fd.append('practice_profile', pp);
  const det = parts.detalhes != null ? String(parts.detalhes) : '';
  if (det.trim()) fd.append('detalhes', det.trim());

  const url = `${base}/v1/enhance?format=json`;
  const headers = {
    ...fd.getHeaders(),
    'X-Service-Key': process.env.AGNO_SERVICE_KEY || '',
  };
  const response = await axios.post(url, fd, {
    headers,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: ENHANCE_TIMEOUT_MS,
    validateStatus: () => true,
  });
  return { data: response.data, status: response.status };
}

module.exports = { forwardEnhanceToAgent };
