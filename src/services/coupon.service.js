const crypto = require('crypto');
const mongoose = require('mongoose');
const Coupon = require('../models/Coupon');
const Campaign = require('../models/Campaign');
const Form = require('../models/Form');
const Sale = require('../models/Sale');
const { andFilters, tenantFilter, tenantCreateFields, tenantDocFilter } = require('../utils/tenantScope');

const QR_ACTIONS = ['page', 'whatsapp', 'url', 'form'];

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase().slice(0, 40);
}

function normalizePercent(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > 100) return null;
  return n;
}

function generatePublicSlug() {
  return crypto.randomBytes(9).toString('base64url').slice(0, 12);
}

async function uniqueSlug() {
  let slug = generatePublicSlug();
  for (let i = 0; i < 5; i += 1) {
    const existing = await Coupon.findOne({ publicSlug: slug }).select('_id').lean();
    if (!existing) return slug;
    slug = generatePublicSlug();
  }
  return slug;
}

function formatCoupon(doc, metrics = {}) {
  const obj = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(obj._id),
    code: obj.code,
    percent: obj.percent,
    active: obj.active !== false,
    title: obj.title || '',
    publicSlug: obj.publicSlug,
    publicEnabled: obj.publicEnabled !== false,
    qrEnabled: obj.qrEnabled === true,
    qrAction: QR_ACTIONS.includes(obj.qrAction) ? obj.qrAction : 'page',
    whatsAppPhone: obj.whatsAppPhone || '',
    whatsAppMessage: obj.whatsAppMessage || '',
    actionUrl: obj.actionUrl || '',
    actionFormId: obj.actionFormId ? String(obj.actionFormId) : null,
    visits: obj.visits || 0,
    scans: obj.scans || 0,
    campaignCount: metrics.campaignCount || 0,
    formCount: metrics.formCount || 0,
    salesCount: metrics.salesCount || 0,
    salesTotal: metrics.salesTotal || 0,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

function applySettings(coupon, body) {
  if (body.code !== undefined) coupon.code = normalizeCode(body.code);
  if (body.percent !== undefined) {
    const percent = normalizePercent(body.percent);
    if (percent == null) throw httpError('Informe um percentual entre 1 e 100', 400);
    coupon.percent = percent;
  }
  if (body.active !== undefined) coupon.active = body.active === true;
  if (body.title !== undefined) coupon.title = String(body.title || '').trim().slice(0, 80);
  if (body.publicEnabled !== undefined) coupon.publicEnabled = body.publicEnabled === true;
  if (body.qrEnabled !== undefined) coupon.qrEnabled = body.qrEnabled === true;
  if (body.qrAction !== undefined) {
    coupon.qrAction = QR_ACTIONS.includes(body.qrAction) ? body.qrAction : 'page';
  }
  if (body.whatsAppPhone !== undefined) coupon.whatsAppPhone = String(body.whatsAppPhone || '').trim();
  if (body.whatsAppMessage !== undefined) {
    coupon.whatsAppMessage = String(body.whatsAppMessage || '').trim().slice(0, 400);
  }
  if (body.actionUrl !== undefined) coupon.actionUrl = String(body.actionUrl || '').trim().slice(0, 500);
  if (body.actionFormId !== undefined) {
    const id = body.actionFormId;
    coupon.actionFormId = id && mongoose.Types.ObjectId.isValid(id) ? id : null;
  }
  if (coupon.qrEnabled && coupon.qrAction === 'whatsapp' && !String(coupon.whatsAppPhone || '').replace(/\D/g, '')) {
    throw httpError('Informe o WhatsApp da ação do QR', 400);
  }
  if (coupon.qrEnabled && coupon.qrAction === 'url' && !String(coupon.actionUrl || '').trim()) {
    throw httpError('Informe o link da ação do QR', 400);
  }
  if (coupon.qrEnabled && coupon.qrAction === 'form' && !coupon.actionFormId) {
    throw httpError('Escolha o formulário da ação do QR', 400);
  }
}

async function syncLinkedCopies(coupon) {
  const code = coupon.active ? coupon.code : '';
  const percent = coupon.active ? coupon.percent : null;
  await Campaign.updateMany(
    { couponId: coupon._id },
    { couponCode: code, couponPercent: percent }
  );
  await Form.updateMany(
    { couponId: coupon._id },
    { couponCode: code, couponPercent: percent, couponEnabled: coupon.active === true }
  );
}

async function usageMaps(couponIds) {
  const empty = { campaigns: {}, forms: {}, sales: {} };
  if (!couponIds.length) return empty;

  const [campaignRows, formRows, saleRows] = await Promise.all([
    Campaign.aggregate([
      { $match: { couponId: { $in: couponIds } } },
      { $group: { _id: '$couponId', count: { $sum: 1 } } },
    ]),
    Form.aggregate([
      { $match: { couponId: { $in: couponIds } } },
      { $group: { _id: '$couponId', count: { $sum: 1 } } },
    ]),
    Sale.aggregate([
      { $match: { couponId: { $in: couponIds } } },
      {
        $group: {
          _id: '$couponId',
          count: { $sum: 1 },
          total: { $sum: '$totalValue' },
        },
      },
    ]),
  ]);

  const campaigns = {};
  const forms = {};
  const sales = {};
  campaignRows.forEach((row) => {
    campaigns[String(row._id)] = row.count;
  });
  formRows.forEach((row) => {
    forms[String(row._id)] = row.count;
  });
  saleRows.forEach((row) => {
    sales[String(row._id)] = { count: row.count, total: row.total || 0 };
  });
  return { campaigns, forms, sales };
}

function metricsFor(id, maps) {
  const sale = maps.sales[id] || { count: 0, total: 0 };
  return {
    campaignCount: maps.campaigns[id] || 0,
    formCount: maps.forms[id] || 0,
    salesCount: sale.count,
    salesTotal: sale.total,
  };
}

async function ensureCouponForCode(req, { code, percent, title, userId, organizationId }) {
  const normalized = normalizeCode(code);
  const validPercent = normalizePercent(percent) || 10;
  if (!normalized) return null;

  const ownerId = userId || req.userId;
  let coupon = await Coupon.findOne({ userId: ownerId, code: normalized });
  if (!coupon) {
    coupon = new Coupon({
      ...tenantCreateFields(req),
      userId: ownerId,
      organizationId: organizationId || tenantCreateFields(req).organizationId || null,
      code: normalized,
      percent: validPercent,
      title: String(title || normalized).slice(0, 80),
      publicSlug: await uniqueSlug(),
      publicEnabled: true,
      qrEnabled: false,
      qrAction: 'page',
      active: true,
    });
    try {
      await coupon.save();
    } catch (error) {
      if (error.code === 11000) {
        coupon = await Coupon.findOne({ userId: ownerId, code: normalized });
      } else {
        throw error;
      }
    }
  }
  return coupon;
}

async function backfillLegacyCoupons(req) {
  const missingCoupon = { $or: [{ couponId: null }, { couponId: { $exists: false } }] };
  const [campaigns, forms] = await Promise.all([
    Campaign.find(andFilters(tenantFilter(req), {
      couponCode: { $exists: true, $nin: [null, ''] },
    }, missingCoupon)).select('_id couponCode couponPercent userId organizationId title'),
    Form.find(andFilters(tenantFilter(req), {
      couponEnabled: true,
      couponCode: { $exists: true, $nin: [null, ''] },
    }, missingCoupon)).select('_id couponCode couponPercent userId organizationId title'),
  ]);

  for (const campaign of campaigns) {
    const coupon = await ensureCouponForCode(req, {
      code: campaign.couponCode,
      percent: campaign.couponPercent,
      title: campaign.title,
      userId: campaign.userId,
      organizationId: campaign.organizationId,
    });
    if (!coupon) continue;
    campaign.couponId = coupon._id;
    campaign.couponCode = coupon.code;
    campaign.couponPercent = coupon.percent;
    await campaign.save();
  }

  for (const form of forms) {
    const coupon = await ensureCouponForCode(req, {
      code: form.couponCode,
      percent: form.couponPercent,
      title: form.title,
      userId: form.userId,
      organizationId: form.organizationId,
    });
    if (!coupon) continue;
    form.couponId = coupon._id;
    form.couponCode = coupon.code;
    form.couponPercent = coupon.percent;
    await form.save();
  }
}

async function listCoupons(req) {
  await backfillLegacyCoupons(req);
  const coupons = await Coupon.find(tenantFilter(req)).sort({ createdAt: -1 });
  const ids = coupons.map((c) => c._id);
  const maps = await usageMaps(ids);
  return coupons.map((coupon) => formatCoupon(coupon, metricsFor(String(coupon._id), maps)));
}

async function getCoupon(req, id) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw httpError('ID inválido', 400);
  const coupon = await Coupon.findOne(tenantDocFilter(req, id));
  if (!coupon) throw httpError('Cupom não encontrado', 404);

  const [campaigns, forms, sales, formTarget] = await Promise.all([
    Campaign.find({ couponId: coupon._id }).select('title status publicSlug').sort({ createdAt: -1 }).lean(),
    Form.find({ couponId: coupon._id }).select('title status publicSlug').sort({ createdAt: -1 }).lean(),
    Sale.find({ couponId: coupon._id })
      .select('clientName totalValue createdAt couponCode')
      .sort({ createdAt: -1 })
      .limit(30)
      .lean(),
    coupon.actionFormId
      ? Form.findById(coupon.actionFormId).select('title publicSlug').lean()
      : null,
  ]);

  const maps = await usageMaps([coupon._id]);
  return {
    ...formatCoupon(coupon, metricsFor(String(coupon._id), maps)),
    actionFormTitle: formTarget?.title || '',
    actionFormSlug: formTarget?.publicSlug || '',
    campaigns: campaigns.map((item) => ({
      id: String(item._id),
      title: item.title,
      status: item.status,
      publicSlug: item.publicSlug,
    })),
    forms: forms.map((item) => ({
      id: String(item._id),
      title: item.title,
      status: item.status,
      publicSlug: item.publicSlug,
    })),
    sales: sales.map((item) => ({
      id: String(item._id),
      clientName: item.clientName || '',
      totalValue: item.totalValue || 0,
      couponCode: item.couponCode || coupon.code,
      createdAt: item.createdAt,
    })),
  };
}

async function createCoupon(req, body) {
  const code = normalizeCode(body.code);
  const percent = normalizePercent(body.percent);
  if (!code) throw httpError('Informe o código do cupom', 400);
  if (percent == null) throw httpError('Informe um percentual entre 1 e 100', 400);

  const coupon = new Coupon({
    ...tenantCreateFields(req),
    code,
    percent,
    publicSlug: await uniqueSlug(),
  });
  applySettings(coupon, { ...body, code, percent });

  try {
    await coupon.save();
  } catch (error) {
    if (error.code === 11000) throw httpError('Já existe um cupom com esse código', 409);
    throw error;
  }
  return formatCoupon(coupon);
}

async function updateCoupon(req, id, body) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw httpError('ID inválido', 400);
  const coupon = await Coupon.findOne(tenantDocFilter(req, id));
  if (!coupon) throw httpError('Cupom não encontrado', 404);
  applySettings(coupon, body);
  try {
    await coupon.save();
  } catch (error) {
    if (error.code === 11000) throw httpError('Já existe um cupom com esse código', 409);
    throw error;
  }
  await syncLinkedCopies(coupon);
  return getCoupon(req, coupon._id);
}

async function resolveCouponSelection(userId, couponId) {
  if (couponId === null || couponId === '' || couponId === undefined) {
    return { couponId: null, couponCode: '', couponPercent: null };
  }
  if (!mongoose.Types.ObjectId.isValid(couponId)) {
    throw httpError('Cupom inválido', 400);
  }
  const coupon = await Coupon.findOne({ _id: couponId, userId });
  if (!coupon) throw httpError('Cupom não encontrado', 400);
  if (coupon.active === false) throw httpError('Esse cupom está inativo', 400);
  return {
    couponId: coupon._id,
    couponCode: coupon.code,
    couponPercent: coupon.percent,
  };
}

async function applyCouponPageSettings(req, couponId, page) {
  if (!page || !couponId) return;
  await updateCoupon(req, couponId, page);
}

async function couponQrDestination(coupon) {
  if (!coupon || coupon.qrEnabled !== true) return null;
  if (coupon.qrAction === 'whatsapp') {
    return whatsAppHref(coupon.whatsAppPhone, coupon.whatsAppMessage, coupon.code);
  }
  if (coupon.qrAction === 'url' && String(coupon.actionUrl || '').trim()) {
    return String(coupon.actionUrl).trim();
  }
  if (coupon.qrAction === 'form' && coupon.actionFormId) {
    const form = await Form.findById(coupon.actionFormId).select('publicSlug status').lean();
    if (form && form.status === 'active' && form.publicSlug) return `/f/${form.publicSlug}`;
    return null;
  }
  if (coupon.publicSlug && coupon.publicEnabled !== false) {
    return `/cupom/${coupon.publicSlug}?via=qr`;
  }
  return null;
}

function whatsAppHref(phone, message, code) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  const withCountry = digits.startsWith('55') ? digits : `55${digits}`;
  const text = encodeURIComponent(
    String(message || '').trim() || `Quero usar o cupom ${code}`
  );
  return `https://wa.me/${withCountry}?text=${text}`;
}

async function getPublicCoupon(slug, viaQr) {
  const coupon = await Coupon.findOne({ publicSlug: slug, active: true, publicEnabled: true });
  if (!coupon) throw httpError('Cupom não encontrado', 404);

  const inc = viaQr ? { visits: 1, scans: 1 } : { visits: 1 };
  await Coupon.updateOne({ _id: coupon._id }, { $inc: inc });

  let actionHref = null;
  let actionLabel = '';
  if (coupon.qrAction === 'whatsapp') {
    actionHref = whatsAppHref(coupon.whatsAppPhone, coupon.whatsAppMessage, coupon.code);
    actionLabel = 'Falar no WhatsApp';
  } else if (coupon.qrAction === 'url' && coupon.actionUrl) {
    actionHref = coupon.actionUrl;
    actionLabel = 'Abrir link';
  } else if (coupon.qrAction === 'form' && coupon.actionFormId) {
    const form = await Form.findById(coupon.actionFormId).select('publicSlug title status').lean();
    if (form && form.status === 'active' && form.publicSlug) {
      actionHref = `/f/${form.publicSlug}`;
      actionLabel = form.title ? `Abrir ${form.title}` : 'Abrir formulário';
    }
  }

  return {
    title: coupon.title || coupon.code,
    code: coupon.code,
    percent: coupon.percent,
    action: coupon.qrAction || 'page',
    actionHref,
    actionLabel,
    qrEnabled: coupon.qrEnabled === true,
    qrTarget: await couponQrDestination(coupon),
  };
}

module.exports = {
  formatCoupon,
  listCoupons,
  getCoupon,
  createCoupon,
  updateCoupon,
  resolveCouponSelection,
  applyCouponPageSettings,
  getPublicCoupon,
  couponQrDestination,
  normalizeCode,
  normalizePercent,
};
