const {
  listCampaigns,
  getCampaign,
  getCampaignStats,
  createCampaign,
  suggestCampaignThemes,
  generateCampaignContent,
  updateCampaign,
  publishCampaign,
  deleteCampaign,
  removeCampaignLead,
  getPublicCampaign,
  submitPublicCampaignLead,
  trackPublicCampaignEvent,
} = require('../services/campaign.service');
const {
  uploadCampaignLeadPhoto,
  generateCampaignLeadSimulation,
} = require('../services/campaignDiagnosisSimulation');
const { parseLeadPhotoMultipart } = require('../middleware/parseLeadPhotoMultipart.middleware');

async function list(req, res, next) {
  try {
    const data = await listCampaigns(req.userId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function getOne(req, res, next) {
  try {
    const data = await getCampaign(req.userId, req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function stats(req, res, next) {
  try {
    const data = await getCampaignStats(req.userId, req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function create(req, res, next) {
  try {
    const data = await createCampaign(req.userId, req.body || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function themeSuggestions(req, res, next) {
  try {
    const data = await suggestCampaignThemes(req.userId, req.body || {});
    res.json({ success: true, data });
  } catch (error) {
    if ([400, 502, 503].includes(error.statusCode)) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function generate(req, res, next) {
  try {
    const data = await generateCampaignContent(req.userId, req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const data = await updateCampaign(req.userId, req.params.id, req.body || {});
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function publish(req, res, next) {
  try {
    const data = await publishCampaign(req.userId, req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    if ([400, 404].includes(error.statusCode)) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function remove(req, res, next) {
  try {
    const data = await deleteCampaign(req.userId, req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function removeLead(req, res, next) {
  try {
    const data = await removeCampaignLead(req.userId, req.params.id, req.params.leadId);
    res.json({ success: true, data, message: 'Lead removido da campanha e da base' });
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 400) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function generateLeadSimulation(req, res, next) {
  try {
    const data = await generateCampaignLeadSimulation(
      req.userId,
      req.params.id,
      req.params.leadId
    );
    res.json({ success: true, data });
  } catch (error) {
    if ([400, 403, 404, 502, 503].includes(error.statusCode)) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
        code: error.code || undefined,
      });
    }
    next(error);
  }
}

async function publicGet(req, res, next) {
  try {
    const data = await getPublicCampaign(req.params.slug);
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function publicLead(req, res, next) {
  try {
    const data = await submitPublicCampaignLead(req.params.slug, {
      phone: req.body?.phone,
      name: req.body?.name,
      quizAnswers: req.body?.quizAnswers,
      quizProfileId: req.body?.quizProfileId,
      magnetPayload: req.body?.magnetPayload,
    });
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 400) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    if (error.statusCode === 409) {
      return res.status(409).json({
        success: false,
        error: error.message,
        data: error.data || null,
      });
    }
    next(error);
  }
}

async function publicLeadPhoto(req, res, next) {
  try {
    const parsed = await parseLeadPhotoMultipart(req);
    const data = await uploadCampaignLeadPhoto(req.params.slug, req.params.leadId, {
      uploadToken: parsed.uploadToken,
      buffer: parsed.buffer,
      mime: parsed.mime,
      filename: parsed.filename,
    });
    res.json({ success: true, data });
  } catch (error) {
    if ([400, 403, 404, 409, 503].includes(error.statusCode)) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function publicEvent(req, res, next) {
  try {
    const data = await trackPublicCampaignEvent(req.params.slug, req.body?.type);
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ success: false, error: error.message });
    }
    next(error);
  }
}

module.exports = {
  list,
  getOne,
  stats,
  create,
  themeSuggestions,
  generate,
  update,
  publish,
  remove,
  removeLead,
  generateLeadSimulation,
  publicGet,
  publicLead,
  publicLeadPhoto,
  publicEvent,
};
