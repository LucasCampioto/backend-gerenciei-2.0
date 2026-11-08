const CLIENT_GROUPS = [
  'lead_quente',
  'lead_morno',
  'lead_frio',
  'cliente_ativa',
  'cliente_inativa',
];

const DEFAULT_CLIENT_GROUP = 'lead_frio';

const LEGACY_CLIENT_GROUPS = ['grupo_a', 'grupo_b', 'grupo_c', 'grupo_d'];

function categoryFromClientGroup(clientGroup) {
  if (typeof clientGroup === 'string' && clientGroup.startsWith('cliente_')) {
    return 'cliente';
  }
  return 'lead';
}

module.exports = {
  CLIENT_GROUPS,
  DEFAULT_CLIENT_GROUP,
  LEGACY_CLIENT_GROUPS,
  categoryFromClientGroup,
};
