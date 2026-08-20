const { Router } = require('express');
const { parseEnhanceMultipart } = require('../middleware/parseEnhanceMultipart.middleware');
const { forwardEnhanceToAgent } = require('../services/simulation/enhanceProxy');
const { extractAfterImageBuffer } = require('../services/simulation/enhancePayload');

/**
 * Mapa tipo_procedimento → regioes (iguais aos do portal / landing).
 * @typedef {{ regioes: string, requiresSiliconeAck?: boolean }} DemoProcDef
 */
const DEMO_CLINIC = {
  Botox: { regioes: 'testa, glabela e região periorbital' },
  'Preenchimento Labial': { regioes: 'lábios e contorno dos lábios' },
  'Contorno de Mandíbula': { regioes: 'mandíbula, ângulos da mandíbula e perfil inferior' },
  'Preenchimento Malar': { regioes: 'maçãs do rosto e terço médio' },
  Rinomodelação: { regioes: 'nariz e dorso nasal' },
  'Bigode chinês (sulco nasogeniano)': {
    regioes: 'sulco nasogeniano e linhas ao redor do nariz e boca',
  },
  'Preenchimento de mento (queixo)': { regioes: 'mento e contorno anterior do queixo' },
  'Preenchimento de olheira': {
    regioes: 'região infra-orbitária, sulco palpebral inferior e olheiras',
  },
};

/** @type {Record<string, DemoProcDef>} */
const DEMO_SURGEON = {
  'Lipo HD': { regioes: 'abdômen, flancos e definição de contornos corporais' },
  Papada: { regioes: 'região submentoniana, pescoço e transição cervical' },
  'Lifting de braço': { regioes: 'braços, terços médio e proximal e axilas' },
  'Mamoplastia (prótese de silicone)': {
    regioes: 'mamas',
    requiresSiliconeAck: true,
  },
  Rinoplastia: { regioes: 'nariz, ponta nasal e dorso' },
  'Otoplastia (orelha)': { regioes: 'pavilhões auriculares e orelhas' },
};

const ALLOWED_INTENSITY = new Set(['sutil', 'moderado', 'dramatico']);
const DEMO_INTENSITY_PCT_FALLBACK = { sutil: 17, moderado: 50, dramatico: 83 };
const DEMO_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** @type {Map<string, number>} IP → timestamp do último sucesso */
const demoSuccessByIp = new Map();

function normalizeProfile(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  return s === 'surgeon' ? 'surgeon' : 'clinic';
}

function normalizeIntensity(raw) {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'dramático') return 'dramatico';
  if (ALLOWED_INTENSITY.has(s)) return s;
  return 'moderado';
}

function demoClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) {
    return xf.split(',')[0].trim();
  }
  if (Array.isArray(xf) && xf.length > 0) {
    const first = String(xf[0] ?? '').trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

function isAgentConnectionError(err) {
  const codes = new Set([
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ECONNRESET',
    'EAI_AGAIN',
    'EPROTO',
  ]);
  const fromError = (e) => {
    if (!e) return false;
    const c = e.code;
    if (typeof c === 'string' && codes.has(c)) return true;
    if (Array.isArray(e.errors)) {
      return e.errors.some((inner) => codes.has(String(inner?.code || '')));
    }
    return false;
  };
  if (fromError(err)) return true;
  if (fromError(err?.cause)) return true;
  return false;
}

function assertDemoRateLimit(req, res) {
  const ip = demoClientIp(req);
  const prev = demoSuccessByIp.get(ip);
  const now = Date.now();
  if (prev != null && now - prev < DEMO_RATE_WINDOW_MS) {
    res.status(429).json({
      message: 'Você já usou a demonstração gratuita. Crie uma conta para continuar.',
      code: 'DEMO_RATE_LIMIT',
    });
    return null;
  }
  return ip;
}

const router = Router();

router.post('/enhance', async (req, res, next) => {
  try {
    const agentBase = process.env.ENHANCE_AGENT_BASE_URL?.trim();
    if (!agentBase) {
      res.status(503).json({ message: 'Demonstração indisponível no momento.' });
      return;
    }

    const rateIp = assertDemoRateLimit(req, res);
    if (rateIp == null) return;

    const parsed = await parseEnhanceMultipart(req);
    if (!parsed.fileBuffer?.length) {
      res.status(400).json({ message: 'Campo image obrigatório' });
      return;
    }

    const profile = normalizeProfile(parsed.practiceProfile || 'clinic');
    const catalog = profile === 'surgeon' ? DEMO_SURGEON : DEMO_CLINIC;

    const tipoRaw = parsed.tipos[0]?.trim();
    if (!tipoRaw) {
      res.status(400).json({ message: 'Informe ao menos um tipo_procedimento' });
      return;
    }

    const def = catalog[tipoRaw];
    if (!def) {
      res.status(400).json({ message: 'Procedimento não permitido na demonstração' });
      return;
    }

    if (def.requiresSiliconeAck) {
      const ack = String(parsed.siliconeAck ?? '').trim();
      const ok =
        ack === '1' ||
        ack.toLowerCase() === 'true' ||
        ack.toLowerCase() === 'yes' ||
        ack === 'on';
      if (!ok) {
        res.status(400).json({
          message: 'Confirme o reconhecimento de prótese de silicone para simular mamoplastia.',
          code: 'SILICONE_ACK_REQUIRED',
        });
        return;
      }
    }

    const rightsAck = String(parsed.imageRightsAck ?? '').trim();
    const rightsOk =
      rightsAck === '1' ||
      rightsAck.toLowerCase() === 'true' ||
      rightsAck.toLowerCase() === 'yes' ||
      rightsAck === 'on';
    if (!rightsOk) {
      res.status(400).json({
        message: 'Confirme que você tem direito de usar esta imagem.',
        code: 'IMAGE_RIGHTS_ACK_REQUIRED',
      });
      return;
    }

    const intensidade = normalizeIntensity(parsed.intensidade);
    const pctFromClient =
      parsed.intensidadePct != null && Number.isFinite(parsed.intensidadePct)
        ? Math.max(0, Math.min(100, Math.round(parsed.intensidadePct)))
        : undefined;
    const intensidadePct = pctFromClient ?? DEMO_INTENSITY_PCT_FALLBACK[intensidade];

    let agentData;
    let status;
    try {
      const out = await forwardEnhanceToAgent(agentBase, {
        buffer: parsed.fileBuffer,
        filename: parsed.filename,
        mime: parsed.mime,
        tipos: [tipoRaw],
        regioes: def.regioes,
        intensidade,
        intensidadePct,
        practiceProfile: profile === 'surgeon' ? 'surgeon' : undefined,
        detalhes: undefined,
      });
      agentData = out.data;
      status = out.status;
    } catch (proxyErr) {
      if (isAgentConnectionError(proxyErr)) {
        console.warn('[demo/enhance] agente inalcançável:', proxyErr?.message || proxyErr?.code);
        res.status(503).json({
          message:
            'O serviço de IA não está acessível. Suba o agente na URL de ENHANCE_AGENT_BASE_URL e tente novamente.',
          code: 'AGENT_UNAVAILABLE',
        });
        return;
      }
      throw proxyErr;
    }

    if (status >= 400) {
      if (typeof agentData === 'object' && agentData !== null) {
        res.status(status).json(agentData);
      } else {
        res.status(status).json({ message: String(agentData ?? 'Erro do agente') });
      }
      return;
    }

    const extracted = extractAfterImageBuffer(agentData);
    if (extracted.error) {
      res.status(502).json({ message: 'Resposta do agente sem imagem em base64' });
      return;
    }

    demoSuccessByIp.set(rateIp, Date.now());

    res.json({
      afterBase64: extracted.buffer.toString('base64'),
      afterMime: extracted.mime,
    });
  } catch (e) {
    if (isAgentConnectionError(e)) {
      console.warn('[demo/enhance] agente inalcançável:', e?.message || e?.code);
      res.status(503).json({
        message:
          'O serviço de IA não está acessível. Suba o agente na URL de ENHANCE_AGENT_BASE_URL e tente novamente.',
        code: 'AGENT_UNAVAILABLE',
      });
      return;
    }
    next(e);
  }
});

module.exports = router;
