export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function roundPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface ProductCostInput {
  price: number;
  costPrice: number;
  freightCostUnit: number;
  packagingCostUnit: number;
  otherCostUnit: number;
  purchasedQuantity: number;
  stockQuantity: number;
}

export interface ComputedProductProfit {
  totalAdditionalCostUnit: number;
  totalUnitCost: number;
  profitPerUnit: number;
  marginPercent: number;
  markupPercent: number;
  potentialCost: number;
  potentialRevenue: number;
  potentialProfit: number;
}

export function computeTotalUnitCost(params: {
  costPrice: number;
  freightCostUnit?: number;
  packagingCostUnit?: number;
  otherCostUnit?: number;
}): number {
  const cost = Math.max(0, Number(params.costPrice || 0));
  const freight = Math.max(0, Number(params.freightCostUnit || 0));
  const packaging = Math.max(0, Number(params.packagingCostUnit || 0));
  const other = Math.max(0, Number(params.otherCostUnit || 0));
  return roundMoney(cost + freight + packaging + other);
}

export function computeProductProfitMetrics(input: ProductCostInput): ComputedProductProfit {
  const salePrice = Math.max(0, Number(input.price || 0));
  const costPrice = Math.max(0, Number(input.costPrice || 0));
  const freight = Math.max(0, Number(input.freightCostUnit || 0));
  const packaging = Math.max(0, Number(input.packagingCostUnit || 0));
  const other = Math.max(0, Number(input.otherCostUnit || 0));
  const stockQuantity = Math.max(0, Math.round(Number(input.stockQuantity || 0)));

  const totalAdditionalCostUnit = roundMoney(freight + packaging + other);
  const totalUnitCost = roundMoney(costPrice + totalAdditionalCostUnit);
  const profitPerUnit = roundMoney(salePrice - totalUnitCost);
  const marginPercent = salePrice > 0 ? roundPercent((profitPerUnit / salePrice) * 100) : 0;
  const markupPercent = totalUnitCost > 0 ? roundPercent((profitPerUnit / totalUnitCost) * 100) : 0;

  const potentialCost = roundMoney(totalUnitCost * stockQuantity);
  const potentialRevenue = roundMoney(salePrice * stockQuantity);
  const potentialProfit = roundMoney(profitPerUnit * stockQuantity);

  return {
    totalAdditionalCostUnit,
    totalUnitCost,
    profitPerUnit,
    marginPercent,
    markupPercent,
    potentialCost,
    potentialRevenue,
    potentialProfit,
  };
}

export interface SalesSimulationInput {
  unitPurchaseCost: number;
  additionalCostUnit: number;
  salePrice: number;
  stockQuantity: number;
  sellQuantity: number;
}

export interface SalesSimulationResult {
  totalUnitCost: number;
  totalInvestment: number;
  expectedRevenue: number;
  expectedGrossProfit: number;
  profitPerUnit: number;
  marginPercent: number;
  markupPercent: number;
  remainingStock: number;
  stockDeficit: number;
}

export function simulateSales(input: SalesSimulationInput): SalesSimulationResult {
  const unitPurchaseCost = Math.max(0, Number(input.unitPurchaseCost || 0));
  const additionalCostUnit = Math.max(0, Number(input.additionalCostUnit || 0));
  const salePrice = Math.max(0, Number(input.salePrice || 0));
  const stockQuantity = Math.max(0, Math.round(Number(input.stockQuantity || 0)));
  const sellQuantity = Math.max(0, Math.round(Number(input.sellQuantity || 0)));

  const totalUnitCost = roundMoney(unitPurchaseCost + additionalCostUnit);
  const profitPerUnit = roundMoney(salePrice - totalUnitCost);
  const totalInvestment = roundMoney(totalUnitCost * sellQuantity);
  const expectedRevenue = roundMoney(salePrice * sellQuantity);
  const expectedGrossProfit = roundMoney(profitPerUnit * sellQuantity);
  const marginPercent = salePrice > 0 ? roundPercent((profitPerUnit / salePrice) * 100) : 0;
  const markupPercent = totalUnitCost > 0 ? roundPercent((profitPerUnit / totalUnitCost) * 100) : 0;
  const remainingStock = stockQuantity - sellQuantity;
  const stockDeficit = remainingStock < 0 ? Math.abs(remainingStock) : 0;

  return {
    totalUnitCost,
    totalInvestment,
    expectedRevenue,
    expectedGrossProfit,
    profitPerUnit,
    marginPercent,
    markupPercent,
    remainingStock,
    stockDeficit,
  };
}

export function calculatePriceFromTargetMargin(
  totalUnitCost: number,
  desiredMarginPercent: number
): number | null {
  const cost = Math.max(0, Number(totalUnitCost || 0));
  const margin = Number(desiredMarginPercent);
  if (!Number.isFinite(margin) || margin >= 100 || margin < -1000) {
    return null;
  }
  const denominator = 1 - margin / 100;
  if (denominator <= 0) return null;
  return roundMoney(cost / denominator);
}

export function calculatePriceFromTargetProfit(
  totalUnitCost: number,
  desiredUnitProfit: number
): number {
  const cost = Math.max(0, Number(totalUnitCost || 0));
  const profit = Number(desiredUnitProfit || 0);
  return roundMoney(Math.max(0, cost + profit));
}

export interface WeightedAverageCostInput {
  currentStockQuantity: number;
  currentCostPrice: number;
  currentFreightCostUnit: number;
  currentPackagingCostUnit: number;
  currentOtherCostUnit: number;
  batchQuantity: number;
  batchUnitPurchaseCost: number;
  batchFreightCostUnit: number;
  batchPackagingCostUnit: number;
  batchOtherCostUnit: number;
}

export interface WeightedAverageCostResult {
  nextStockQuantity: number;
  nextCostPrice: number;
  nextFreightCostUnit: number;
  nextPackagingCostUnit: number;
  nextOtherCostUnit: number;
  nextTotalUnitCost: number;
}

export function computeWeightedAverageCost(
  input: WeightedAverageCostInput
): WeightedAverageCostResult {
  const curQty = Math.max(0, Math.round(Number(input.currentStockQuantity || 0)));
  const newQty = Math.max(1, Math.round(Number(input.batchQuantity || 1)));

  const curCost = Math.max(0, Number(input.currentCostPrice || 0));
  const curFreight = Math.max(0, Number(input.currentFreightCostUnit || 0));
  const curPackaging = Math.max(0, Number(input.currentPackagingCostUnit || 0));
  const curOther = Math.max(0, Number(input.currentOtherCostUnit || 0));

  const newCost = Math.max(0, Number(input.batchUnitPurchaseCost || 0));
  const newFreight = Math.max(0, Number(input.batchFreightCostUnit || 0));
  const newPackaging = Math.max(0, Number(input.batchPackagingCostUnit || 0));
  const newOther = Math.max(0, Number(input.batchOtherCostUnit || 0));

  const curTotal = curCost + curFreight + curPackaging + curOther;
  const totalQty = curQty + newQty;

  if (curQty <= 0 || curTotal <= 0) {
    return {
      nextStockQuantity: totalQty,
      nextCostPrice: roundMoney(newCost),
      nextFreightCostUnit: roundMoney(newFreight),
      nextPackagingCostUnit: roundMoney(newPackaging),
      nextOtherCostUnit: roundMoney(newOther),
      nextTotalUnitCost: computeTotalUnitCost({
        costPrice: newCost,
        freightCostUnit: newFreight,
        packagingCostUnit: newPackaging,
        otherCostUnit: newOther,
      }),
    };
  }

  const nextCostPrice = roundMoney((curQty * curCost + newQty * newCost) / totalQty);
  const nextFreightCostUnit = roundMoney((curQty * curFreight + newQty * newFreight) / totalQty);
  const nextPackagingCostUnit = roundMoney(
    (curQty * curPackaging + newQty * newPackaging) / totalQty
  );
  const nextOtherCostUnit = roundMoney((curQty * curOther + newQty * newOther) / totalQty);

  return {
    nextStockQuantity: totalQty,
    nextCostPrice,
    nextFreightCostUnit,
    nextPackagingCostUnit,
    nextOtherCostUnit,
    nextTotalUnitCost: computeTotalUnitCost({
      costPrice: nextCostPrice,
      freightCostUnit: nextFreightCostUnit,
      packagingCostUnit: nextPackagingCostUnit,
      otherCostUnit: nextOtherCostUnit,
    }),
  };
}
