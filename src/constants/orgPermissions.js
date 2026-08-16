/**
 * Catálogo de permissões por tela (ids estáveis).
 * Compatível com ids de módulo legado (ex.: `gestao` libera todas as telas de gestão).
 */

const PERMISSION_GROUPS = Object.freeze([
  {
    id: 'home',
    label: 'Meu dia',
    screens: [{ id: 'home', label: 'Meu dia' }],
  },
  {
    id: 'agenda',
    label: 'Agenda',
    screens: [{ id: 'agenda', label: 'Agenda' }],
  },
  {
    id: 'relatorios',
    label: 'Relatórios',
    screens: [{ id: 'relatorios', label: 'Relatórios' }],
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    screens: [
      { id: 'whatsapp.conexao', label: 'Conexão' },
      { id: 'whatsapp.automacoes', label: 'Automações' },
      { id: 'whatsapp.campanhas_dia', label: 'Campanhas do dia' },
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    screens: [
      { id: 'marketing.campanhas', label: 'Campanhas' },
      { id: 'marketing.reativacao', label: 'Reativação' },
    ],
  },
  {
    id: 'crm',
    label: 'CRM',
    screens: [
      { id: 'crm.funil', label: 'Funil' },
      { id: 'crm.jornada', label: 'Jornada comercial' },
      { id: 'crm.formularios', label: 'Formulários' },
    ],
  },
  {
    id: 'vendas',
    label: 'Vendas',
    screens: [
      { id: 'vendas.lista', label: 'Vendas realizadas' },
      { id: 'vendas.nova', label: 'Registrar venda' },
    ],
  },
  {
    id: 'simulacoes',
    label: 'Simulações',
    screens: [
      { id: 'simulacoes.nova', label: 'Nova simulação' },
      { id: 'simulacoes.historico', label: 'Histórico' },
      { id: 'simulacoes.precificacao', label: 'Precificação' },
    ],
  },
  {
    id: 'gestao',
    label: 'Gestão',
    screens: [
      { id: 'gestao.assinaturas', label: 'Assinaturas' },
      { id: 'gestao.documentos', label: 'Documentos' },
      { id: 'gestao.procedimentos', label: 'Procedimentos' },
      { id: 'gestao.estoque', label: 'Estoque' },
      { id: 'gestao.colaboradores', label: 'Profissionais' },
      { id: 'gestao.clientes', label: 'Leads & Clientes' },
    ],
  },
  {
    id: 'financeiro',
    label: 'Financeiro',
    screens: [
      { id: 'financeiro.gastos', label: 'Gastos' },
      { id: 'financeiro.lucro', label: 'Lucro' },
      { id: 'financeiro.taxas', label: 'Taxas de pagamento' },
    ],
  },
  {
    id: 'equipe',
    label: 'Acessos',
    screens: [{ id: 'equipe', label: 'Acessos' }],
  },
  {
    id: 'assinatura',
    label: 'Assinatura / Billing',
    screens: [{ id: 'assinatura', label: 'Assinatura / Billing' }],
  },
]);

/** Flat list for API catalog (screens only). */
const MODULE_PERMISSIONS = Object.freeze(
  PERMISSION_GROUPS.flatMap((g) =>
    g.screens.map((s) => ({
      id: s.id,
      label: s.label,
      groupId: g.id,
      groupLabel: g.label,
    })),
  ),
);

const ALL_SCREEN_IDS = Object.freeze(MODULE_PERMISSIONS.map((m) => m.id));

/** Módulos legados (um id por grupo do menu). */
const LEGACY_MODULE_IDS = Object.freeze(PERMISSION_GROUPS.map((g) => g.id));

const ALL_MODULE_IDS = ALL_SCREEN_IDS;

const SCREEN_IDS_BY_GROUP = Object.freeze(
  Object.fromEntries(PERMISSION_GROUPS.map((g) => [g.id, g.screens.map((s) => s.id)])),
);

function expandModuleToScreens(moduleId) {
  if (ALL_SCREEN_IDS.includes(moduleId)) return [moduleId];
  const screens = SCREEN_IDS_BY_GROUP[moduleId];
  return screens ? [...screens] : [];
}

function expandPermissionList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const id = String(raw || '').trim();
    if (!id) continue;
    for (const screenId of expandModuleToScreens(id)) {
      if (seen.has(screenId)) continue;
      seen.add(screenId);
      out.push(screenId);
    }
  }
  return out;
}

/** Tudo exceto billing — padrão para admin. */
const ADMIN_DEFAULT_PERMISSIONS = Object.freeze(
  ALL_SCREEN_IDS.filter((id) => id !== 'assinatura'),
);

const OWNER_PERMISSIONS = Object.freeze([...ALL_SCREEN_IDS]);

const PRESET_MODULES = Object.freeze({
  marketing: ['home', 'agenda', 'marketing', 'whatsapp', 'crm'],
  comercial: ['home', 'agenda', 'crm', 'vendas', 'gestao', 'simulacoes'],
  financeiro: ['home', 'financeiro', 'vendas', 'relatorios'],
  recepcao: ['home', 'agenda', 'crm', 'gestao'],
});

const PRESETS = Object.freeze(
  Object.fromEntries(
    Object.entries(PRESET_MODULES).map(([key, modules]) => [key, expandPermissionList(modules)]),
  ),
);

const ORG_ROLES = Object.freeze(['owner', 'admin', 'member']);

function isValidPermissionId(id) {
  return typeof id === 'string' && (ALL_SCREEN_IDS.includes(id) || LEGACY_MODULE_IDS.includes(id));
}

function sanitizePermissions(list) {
  return expandPermissionList(list);
}

function permissionCovers(permissions, requiredId) {
  if (!requiredId || !Array.isArray(permissions)) return false;
  if (permissions.includes(requiredId)) return true;

  // Legado: `gestao` cobre `gestao.estoque`
  const groupId = requiredId.includes('.') ? requiredId.split('.')[0] : requiredId;
  if (permissions.includes(groupId)) return true;

  // Pedido de módulo: qualquer tela do grupo libera o grupo (menu pai)
  if (!requiredId.includes('.') && SCREEN_IDS_BY_GROUP[requiredId]) {
    return SCREEN_IDS_BY_GROUP[requiredId].some((s) => permissions.includes(s));
  }

  return false;
}

function roleHasPermission(role, permissions, moduleId) {
  if (!moduleId) return false;
  if (role === 'owner') return true;
  if (role === 'admin') {
    if (moduleId === 'assinatura' || moduleId.startsWith('assinatura.')) {
      return permissionCovers(permissions, 'assinatura');
    }
    return true;
  }
  return permissionCovers(permissions, moduleId);
}

function isOrgAdminRole(role) {
  return role === 'owner' || role === 'admin';
}

module.exports = {
  PERMISSION_GROUPS,
  MODULE_PERMISSIONS,
  ALL_MODULE_IDS,
  ALL_SCREEN_IDS,
  LEGACY_MODULE_IDS,
  SCREEN_IDS_BY_GROUP,
  ADMIN_DEFAULT_PERMISSIONS,
  OWNER_PERMISSIONS,
  PRESETS,
  PRESET_MODULES,
  ORG_ROLES,
  isValidPermissionId,
  sanitizePermissions,
  expandPermissionList,
  expandModuleToScreens,
  permissionCovers,
  roleHasPermission,
  isOrgAdminRole,
};
