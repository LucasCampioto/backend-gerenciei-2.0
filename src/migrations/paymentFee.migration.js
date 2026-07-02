const PaymentFee = require('../models/PaymentFee');

async function migratePaymentFeeIndexes() {
  const collection = PaymentFee.collection;
  const indexes = await collection.indexes();

  for (const index of indexes) {
    if (!index.unique) continue;

    const keyNames = Object.keys(index.key || {});
    const isNewCompound =
      keyNames.length === 3 &&
      index.key.userId === 1 &&
      index.key.brandGroup === 1 &&
      index.key.feeKey === 1;

    if (isNewCompound) continue;

    if (keyNames.includes('userId') || keyNames.includes('paymentMethod')) {
      try {
        await collection.dropIndex(index.name);
        console.log(`PaymentFee: índice legado removido (${index.name})`);
      } catch (error) {
        if (error.code !== 27) {
          console.warn(`PaymentFee: falha ao remover índice ${index.name}:`, error.message);
        }
      }
    }
  }

  await PaymentFee.syncIndexes();

  const legacyResult = await PaymentFee.deleteMany({
    $or: [
      { brandGroup: { $exists: false } },
      { feeKey: { $exists: false } },
      { paymentMethod: { $exists: true } },
    ],
  });

  if (legacyResult.deletedCount > 0) {
    console.log(`PaymentFee: ${legacyResult.deletedCount} registro(s) legado(s) removido(s)`);
  }
}

module.exports = { migratePaymentFeeIndexes };
