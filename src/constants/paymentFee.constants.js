const BRAND_GROUPS = [
  { id: 'visa_master', label: 'Visa e Mastercard' },
  { id: 'elo_amex', label: 'Elo e American Express' },
];

const BRAND_GROUP_IDS = BRAND_GROUPS.map((g) => g.id);

const INSTALLMENT_FEE_KEYS = Array.from({ length: 11 }, (_, index) => {
  const installments = index + 2;
  return {
    key: `credito_${installments}x`,
    label: `${installments}x`,
  };
});

const CARD_FEE_KEYS = [
  { key: 'pix', label: 'Pix' },
  { key: 'debito', label: 'Débito' },
  { key: 'credito_vista', label: 'Crédito à vista' },
  ...INSTALLMENT_FEE_KEYS,
];

const DEFAULT_FEE_KEYS = [
  { key: 'pix', label: 'Pix' },
  { key: 'dinheiro', label: 'Dinheiro' },
  { key: 'link_pagamento', label: 'Link de pagamento' },
];

const FEE_SCHEDULE = [
  { brandGroup: 'visa_master', label: 'Visa e Mastercard', feeKeys: CARD_FEE_KEYS },
  { brandGroup: 'elo_amex', label: 'Elo e American Express', feeKeys: CARD_FEE_KEYS },
  { brandGroup: 'default', label: 'Outros meios', feeKeys: DEFAULT_FEE_KEYS },
];

const ALL_FEE_KEYS = [
  ...new Set([
    ...CARD_FEE_KEYS.map((f) => f.key),
    ...DEFAULT_FEE_KEYS.map((f) => f.key),
  ]),
];

function resolveFeeKey(paymentMethod, installments = 1) {
  if (paymentMethod === 'pix') return 'pix';
  if (paymentMethod === 'dinheiro') return 'dinheiro';
  if (paymentMethod === 'link de pagamento') return 'link_pagamento';
  if (paymentMethod === 'débito') return 'debito';

  if (paymentMethod === 'crédito') {
    const count = Number(installments) || 1;
    if (count <= 1) return 'credito_vista';
    if (count >= 2 && count <= 12) return `credito_${count}x`;
    return 'credito_vista';
  }

  return null;
}

function resolveBrandGroup(paymentMethod, cardBrandGroup) {
  if (paymentMethod === 'débito' || paymentMethod === 'crédito') {
    return BRAND_GROUP_IDS.includes(cardBrandGroup) ? cardBrandGroup : 'visa_master';
  }
  return 'default';
}

function buildDefaultFeesResponse() {
  return FEE_SCHEDULE.map((group) => ({
    brandGroup: group.brandGroup,
    label: group.label,
    fees: group.feeKeys.map((feeKey) => ({
      feeKey: feeKey.key,
      label: feeKey.label,
      feePercentage: 0,
    })),
  }));
}

module.exports = {
  BRAND_GROUPS,
  BRAND_GROUP_IDS,
  CARD_FEE_KEYS,
  DEFAULT_FEE_KEYS,
  FEE_SCHEDULE,
  ALL_FEE_KEYS,
  resolveFeeKey,
  resolveBrandGroup,
  buildDefaultFeesResponse,
};
