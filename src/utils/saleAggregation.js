/**
 * Stages de agregação que distribuem desconto da venda proporcionalmente
 * entre os itens, alinhando totais por procedimento ao faturamento mensal.
 */
function buildSaleItemsAllocationStages() {
  return [
    {
      $addFields: {
        itemsGrossTotal: { $sum: '$items.totalValue' },
      },
    },
    {
      $addFields: {
        items: {
          $map: {
            input: '$items',
            as: 'item',
            in: {
              $mergeObjects: [
                '$$item',
                {
                  grossValueAllocated: {
                    $cond: [
                      { $gt: ['$itemsGrossTotal', 0] },
                      {
                        $subtract: [
                          '$$item.totalValue',
                          {
                            $multiply: [
                              { $ifNull: ['$discount', 0] },
                              { $divide: ['$$item.totalValue', '$itemsGrossTotal'] },
                            ],
                          },
                        ],
                      },
                      '$$item.totalValue',
                    ],
                  },
                  netValueAllocated: {
                    $cond: [
                      { $gt: ['$itemsGrossTotal', 0] },
                      {
                        $multiply: [
                          '$netValue',
                          { $divide: ['$$item.totalValue', '$itemsGrossTotal'] },
                        ],
                      },
                      0,
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    },
  ];
}

module.exports = {
  buildSaleItemsAllocationStages,
};
