const ContentPlan = require('../models/ContentPlan');
const Procedure = require('../models/Procedure');
const { isAgnoEnabled, generateContentCalendar } = require('./agno.client');

function currentMonthKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthLabelFromKey(month) {
  const [y, m] = String(month).split('-');
  const names = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];
  const idx = Number(m) - 1;
  return `${names[idx] || m} ${y}`;
}

function heuristicPosts(procedures, monthLabel) {
  const procs = procedures.length
    ? procedures
    : [{ name: 'procedimentos estéticos' }];
  const formats = ['carrossel', 'reel', 'story', 'carrossel', 'reel'];
  const posts = [];
  for (let i = 0; i < 12; i += 1) {
    const proc = procs[i % procs.length];
    const name = proc.name || 'estética';
    posts.push({
      day: 1 + i * 2,
      format: formats[i % formats.length],
      hook: `Você sabia isso sobre ${name}?`,
      caption: `Hoje falamos de ${name}: o que mais perguntam na clínica e como decidir com tranquilidade. Salva pra lembrar.`,
      hashtags: ['estetica', 'beleza', 'cuidados', 'clinica'],
      visualSuggestion: `Foto ou ilustração relacionada a ${name}`,
      bestTime: '19:00',
      status: 'pending',
    });
  }
  return { monthLabel, posts };
}

function formatPlan(doc) {
  const obj = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(obj._id),
    month: obj.month,
    monthLabel: obj.monthLabel,
    posts: obj.posts || [],
    source: obj.source,
  };
}

async function getOrCreateContentPlan(userId, { month, regenerate = false } = {}) {
  const key = month || currentMonthKey();
  let plan = await ContentPlan.findOne({ userId, month: key });

  if (plan && !regenerate) {
    return formatPlan(plan);
  }

  const procedures = await Procedure.find({ userId })
    .select('name value')
    .limit(20)
    .lean();

  const label = monthLabelFromKey(key);
  let generated = null;
  let source = 'heuristic';

  if (isAgnoEnabled()) {
    try {
      const res = await generateContentCalendar({
        userId: String(userId),
        contentBrief: {
          month: key,
          monthLabel: label,
          procedures: procedures.map((p) => ({ name: p.name, value: p.value })),
        },
      });
      if (res?.data?.posts?.length) {
        generated = res.data;
        source = 'agno';
      }
    } catch (err) {
      console.warn('[content-plan] agno failed:', err.message);
    }
  }

  if (!generated?.posts?.length) {
    generated = heuristicPosts(procedures, label);
  }

  const posts = (generated.posts || []).map((p) => ({
    day: p.day || 1,
    format: p.format || 'carrossel',
    hook: p.hook || '',
    caption: p.caption || '',
    hashtags: p.hashtags || [],
    visualSuggestion: p.visualSuggestion || '',
    bestTime: p.bestTime || '19:00',
    status: 'pending',
  }));

  if (plan) {
    plan.monthLabel = generated.monthLabel || label;
    plan.posts = posts;
    plan.source = source;
    await plan.save();
  } else {
    plan = await ContentPlan.create({
      userId,
      month: key,
      monthLabel: generated.monthLabel || label,
      posts,
      source,
    });
  }

  return formatPlan(plan);
}

async function markContentPost(userId, postIndex, status) {
  const plan = await ContentPlan.findOne({ userId }).sort({ updatedAt: -1 });
  // Prefer current month; fall back to most recent
  const key = currentMonthKey();
  let target = await ContentPlan.findOne({ userId, month: key });
  if (!target) target = plan;
  if (!target) {
    const err = new Error('Plano de conteúdo não encontrado');
    err.statusCode = 404;
    throw err;
  }
  const idx = Number(postIndex);
  if (!target.posts[idx]) {
    const err = new Error('Post não encontrado');
    err.statusCode = 404;
    throw err;
  }
  if (!['pending', 'used'].includes(status)) {
    const err = new Error('Status inválido');
    err.statusCode = 400;
    throw err;
  }
  target.posts[idx].status = status;
  await target.save();
  return formatPlan(target);
}

module.exports = {
  getOrCreateContentPlan,
  markContentPost,
  currentMonthKey,
};
