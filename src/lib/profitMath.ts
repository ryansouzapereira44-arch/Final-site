import { db, formatProductSku, mapOrderRow, mapProductRow } from './db.ts';
import {
  computeProductProfitMetrics,
  computeTotalUnitCost,
  computeWeightedAverageCost,
  roundMoney,
  roundPercent,
} from '../src/lib/profitMath.ts';
import type {
  HistoricalSaleProfitSummary,
  Product,
  ProductCostBatch,
  ProductCostEventType,
  ProductCostHistoryEntry,
  ProfitCategorySummary,
  ProfitIndicators,
  ProfitOverviewResponse,
  ProfitProductRow,
} from '../src/types.ts';

export const COSTING_METHOD_NOTE =
  'Custo Médio Ponderado (CMP): ao registrar um novo lote de compra com custo diferente, o custo unitário é recalculado pela média ponderada entre o estoque disponível atual e as novas unidades. Histórico de custos anteriores é preservado imutavelmente.';

export function buildProfitProductRow(product: Product): ProfitProductRow {
  const costPrice = Math.max(0, Number(product.costPrice || 0));
  const freightCostUnit = Math.max(0, Number(product.freightCostUnit || 0));
  const packagingCostUnit = Math.max(0, Number(product.packagingCostUnit || 0));
  const otherCostUnit = Math.max(0, Number(product.otherCostUnit || 0));
  const purchasedQuantity = Math.max(0, Math.round(Number(product.purchasedQuantity || 0)));
  const stockQuantity = Math.max(0, Math.round(Number(product.stockQuantity || 0)));

  const metrics = computeProductProfitMetrics({
    price: product.price,
    costPrice,
    freightCostUnit,
    packagingCostUnit,
    otherCostUnit,
    purchasedQuantity,
    stockQuantity,
  });

  return {
    id: product.id,
    sku: formatProductSku(product.id, product.sku),
    name: product.name,
    category: product.category,
    description: product.description,
    imageUrl: product.imageUrl,
    variations: product.variations,
    active: product.active,
    price: roundMoney(product.price),
    costPrice: roundMoney(costPrice),
    freightCostUnit: roundMoney(freightCostUnit),
    packagingCostUnit: roundMoney(packagingCostUnit),
    otherCostUnit: roundMoney(otherCostUnit),
    totalAdditionalCostUnit: metrics.totalAdditionalCostUnit,
    totalUnitCost: metrics.totalUnitCost,
    purchasedQuantity,
    stockQuantity,
    profitPerUnit: metrics.profitPerUnit,
    marginPercent: metrics.marginPercent,
    markupPercent: metrics.markupPercent,
    potentialCost: metrics.potentialCost,
    potentialRevenue: metrics.potentialRevenue,
    potentialProfit: metrics.potentialProfit,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

export function recordProductCostSnapshot(params: {
  productId: number;
  productNameSnapshot: string;
  eventType: ProductCostEventType;
  unitPurchaseCost: number;
  freightCostUnit: number;
  packagingCostUnit: number;
  otherCostUnit: number;
  salePrice: number;
  purchasedQuantity: number;
  stockQuantity: number;
  note: string;
  recordedAt?: string;
}): void {
  const unitPurchaseCost = roundMoney(Math.max(0, params.unitPurchaseCost));
  const freightCostUnit = roundMoney(Math.max(0, params.freightCostUnit));
  const packagingCostUnit = roundMoney(Math.max(0, params.packagingCostUnit));
  const otherCostUnit = roundMoney(Math.max(0, params.otherCostUnit));
  const totalUnitCost = computeTotalUnitCost({
    costPrice: unitPurchaseCost,
    freightCostUnit,
    packagingCostUnit,
    otherCostUnit,
  });
  const salePrice = roundMoney(Math.max(0, params.salePrice));
  const purchasedQuantity = Math.max(0, Math.round(params.purchasedQuantity));
  const stockQuantity = Math.max(0, Math.round(params.stockQuantity));
  const recordedAt = params.recordedAt || new Date().toISOString();

  db.prepare(`
    INSERT INTO product_cost_history (
      productId, productNameSnapshot, eventType, unitPurchaseCost,
      freightCostUnit, packagingCostUnit, otherCostUnit, totalUnitCost,
      salePrice, purchasedQuantity, stockQuantity, note, recordedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.productId,
    params.productNameSnapshot,
    params.eventType,
    unitPurchaseCost,
    freightCostUnit,
    packagingCostUnit,
    otherCostUnit,
    totalUnitCost,
    salePrice,
    purchasedQuantity,
    stockQuantity,
    params.note,
    recordedAt
  );
}

function getHistoricalUnitCostAt(productId: number, atIso: string): number | null {
  const rowAtTime = db
    .prepare(
      `SELECT totalUnitCost FROM product_cost_history
       WHERE productId = ? AND recordedAt <= ?
       ORDER BY recordedAt DESC, id DESC LIMIT 1`
    )
    .get(productId, atIso) as { totalUnitCost: number } | undefined;

  if (rowAtTime) {
    return Number(rowAtTime.totalUnitCost || 0);
  }

  const earliest = db
    .prepare(
      `SELECT totalUnitCost FROM product_cost_history
       WHERE productId = ?
       ORDER BY recordedAt ASC, id ASC LIMIT 1`
    )
    .get(productId) as { totalUnitCost: number } | undefined;

  if (earliest) {
    return Number(earliest.totalUnitCost || 0);
  }

  const prod = db
    .prepare('SELECT costPrice, freightCostUnit, packagingCostUnit, otherCostUnit FROM products WHERE id = ?')
    .get(productId) as
    | {
        costPrice: number;
        freightCostUnit: number;
        packagingCostUnit: number;
        otherCostUnit: number;
      }
    | undefined;

  if (!prod) return null;
  return computeTotalUnitCost({
    costPrice: Number(prod.costPrice || 0),
    freightCostUnit: Number(prod.freightCostUnit || 0),
    packagingCostUnit: Number(prod.packagingCostUnit || 0),
    otherCostUnit: Number(prod.otherCostUnit || 0),
  });
}

function computeHistoricalSalesSummary(): HistoricalSaleProfitSummary {
  const orderRows = db
    .prepare("SELECT * FROM orders WHERE status != 'Cancelado' ORDER BY id DESC LIMIT 200")
    .all() as Record<string, unknown>[];

  let unitsSold = 0;
  let totalSalesRevenue = 0;
  let totalHistoricalCost = 0;
  const recentOrders: HistoricalSaleProfitSummary['recentOrders'] = [];

  for (const row of orderRows) {
    const order = mapOrderRow(row);
    let orderItemsRevenue = 0;
    let orderHistoricalCost = 0;

    for (const item of order.items) {
      const qty = Math.max(0, Math.round(Number(item.quantity || 0)));
      const unitSale = Math.max(0, Number(item.price || 0));
      const lineRevenue = roundMoney(unitSale * qty);
      const historicalUnitCost = getHistoricalUnitCostAt(item.productId, order.createdAt) ?? 0;
      const lineCost = roundMoney(historicalUnitCost * qty);

      unitsSold += qty;
      orderItemsRevenue = roundMoney(orderItemsRevenue + lineRevenue);
      orderHistoricalCost = roundMoney(orderHistoricalCost + lineCost);
    }

    const orderGrossProfit = roundMoney(orderItemsRevenue - orderHistoricalCost);
    const marginPercent =
      orderItemsRevenue > 0 ? roundPercent((orderGrossProfit / orderItemsRevenue) * 100) : 0;

    totalSalesRevenue = roundMoney(totalSalesRevenue + orderItemsRevenue);
    totalHistoricalCost = roundMoney(totalHistoricalCost + orderHistoricalCost);

    if (recentOrders.length < 15) {
      recentOrders.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        createdAt: order.createdAt,
        status: order.status,
        itemsRevenue: orderItemsRevenue,
        historicalCost: orderHistoricalCost,
        historicalGrossProfit: orderGrossProfit,
        marginPercent,
      });
    }
  }

  return {
    ordersAnalyzed: orderRows.length,
    unitsSold,
    totalSalesRevenue,
    totalHistoricalCost,
    totalHistoricalGrossProfit: roundMoney(totalSalesRevenue - totalHistoricalCost),
    recentOrders,
  };
}

export function getProfitOverview(): ProfitOverviewResponse {
  const productRows = db
    .prepare('SELECT * FROM products WHERE archived = 0 ORDER BY id DESC')
    .all() as Record<string, unknown>[];

  const products = productRows.map(mapProductRow).map(buildProfitProductRow);

  let totalInvested = 0;
  let potentialRevenue = 0;
  let potentialGrossProfit = 0;
  let totalStockUnits = 0;
  let totalPurchasedUnits = 0;

  for (const p of products) {
    totalInvested = roundMoney(totalInvested + p.potentialCost);
    potentialRevenue = roundMoney(potentialRevenue + p.potentialRevenue);
    potentialGrossProfit = roundMoney(potentialGrossProfit + p.potentialProfit);
    totalStockUnits += p.stockQuantity;
    totalPurchasedUnits += p.purchasedQuantity;
  }

  const configuredProducts = products.filter((p) => p.totalUnitCost > 0);
  const marginSource = configuredProducts.length > 0 ? configuredProducts : products.filter((p) => p.price > 0);
  const averageMarginPercent =
    marginSource.length > 0
      ? roundPercent(marginSource.reduce((acc, p) => acc + p.marginPercent, 0) / marginSource.length)
      : 0;

  const rankingSource = configuredProducts.length > 0 ? configuredProducts : products;

  let mostProfitableProduct: ProfitProductRow | null = null;
  if (rankingSource.length > 0) {
    mostProfitableProduct = [...rankingSource].sort((a, b) => {
      if (b.potentialProfit !== a.potentialProfit) return b.potentialProfit - a.potentialProfit;
      return b.profitPerUnit - a.profitPerUnit;
    })[0];
  }

  let lowestMarginProduct: ProfitProductRow | null = null;
  if (rankingSource.length > 0) {
    lowestMarginProduct = [...rankingSource].sort((a, b) => {
      if (a.marginPercent !== b.marginPercent) return a.marginPercent - b.marginPercent;
      return a.profitPerUnit - b.profitPerUnit;
    })[0];
  }

  const indicators: ProfitIndicators = {
    totalInvested,
    potentialRevenue,
    potentialGrossProfit,
    averageMarginPercent,
    totalStockUnits,
    totalPurchasedUnits,
    activeProductCount: products.length,
    configuredCostCount: configuredProducts.length,
    mostProfitableProduct,
    lowestMarginProduct,
  };

  // Group by category
  const catMap = new Map<
    string,
    {
      productCount: number;
      totalUnits: number;
      totalInvested: number;
      potentialRevenue: number;
      potentialProfit: number;
      marginSum: number;
      marginCount: number;
    }
  >();

  for (const p of products) {
    const key = p.category || 'Sem categoria';
    const cur = catMap.get(key) || {
      productCount: 0,
      totalUnits: 0,
      totalInvested: 0,
      potentialRevenue: 0,
      potentialProfit: 0,
      marginSum: 0,
      marginCount: 0,
    };
    cur.productCount += 1;
    cur.totalUnits += p.stockQuantity;
    cur.totalInvested = roundMoney(cur.totalInvested + p.potentialCost);
    cur.potentialRevenue = roundMoney(cur.potentialRevenue + p.potentialRevenue);
    cur.potentialProfit = roundMoney(cur.potentialProfit + p.potentialProfit);
    if (p.totalUnitCost > 0 || configuredProducts.length === 0) {
      cur.marginSum += p.marginPercent;
      cur.marginCount += 1;
    }
    catMap.set(key, cur);
  }

  const categories: ProfitCategorySummary[] = Array.from(catMap.entries())
    .map(([category, v]) => ({
      category,
      productCount: v.productCount,
      totalUnits: v.totalUnits,
      totalInvested: v.totalInvested,
      potentialRevenue: v.potentialRevenue,
      potentialProfit: v.potentialProfit,
      avgMarginPercent: v.marginCount > 0 ? roundPercent(v.marginSum / v.marginCount) : 0,
    }))
    .sort((a, b) => b.potentialProfit - a.potentialProfit);

  const batchRows = db
    .prepare(
      `SELECT b.*, p.name as productName, p.sku as productSku, p.archived as productArchived
       FROM product_cost_batches b
       LEFT JOIN products p ON p.id = b.productId
       ORDER BY b.id DESC LIMIT 100`
    )
    .all() as Record<string, unknown>[];

  const batches: ProductCostBatch[] = batchRows.map((r) => ({
    id: Number(r.id),
    productId: Number(r.productId),
    productName: String(r.productName || `Produto #${r.productId}`),
    productSku: formatProductSku(Number(r.productId), r.productSku),
    productArchived: Boolean(r.productArchived),
    quantityPurchased: Number(r.quantityPurchased || 0),
    remainingQuantity: Number(r.remainingQuantity || 0),
    unitPurchaseCost: Number(r.unitPurchaseCost || 0),
    freightCostUnit: Number(r.freightCostUnit || 0),
    packagingCostUnit: Number(r.packagingCostUnit || 0),
    otherCostUnit: Number(r.otherCostUnit || 0),
    totalUnitCost: Number(r.totalUnitCost || 0),
    supplierNote: String(r.supplierNote || ''),
    purchasedAt: String(r.purchasedAt),
    createdAt: String(r.createdAt),
  }));

  const historyRows = db
    .prepare(
      `SELECT h.*, p.archived as productArchived
       FROM product_cost_history h
       LEFT JOIN products p ON p.id = h.productId
       ORDER BY h.id DESC LIMIT 150`
    )
    .all() as Record<string, unknown>[];

  const history: ProductCostHistoryEntry[] = historyRows.map((r) => ({
    id: Number(r.id),
    productId: Number(r.productId),
    productNameSnapshot: String(r.productNameSnapshot || `Produto #${r.productId}`),
    productArchived: Boolean(r.productArchived),
    eventType: String(r.eventType) as ProductCostEventType,
    unitPurchaseCost: Number(r.unitPurchaseCost || 0),
    freightCostUnit: Number(r.freightCostUnit || 0),
    packagingCostUnit: Number(r.packagingCostUnit || 0),
    otherCostUnit: Number(r.otherCostUnit || 0),
    totalUnitCost: Number(r.totalUnitCost || 0),
    salePrice: Number(r.salePrice || 0),
    purchasedQuantity: Number(r.purchasedQuantity || 0),
    stockQuantity: Number(r.stockQuantity || 0),
    note: String(r.note || ''),
    recordedAt: String(r.recordedAt),
  }));

  const historicalSales = computeHistoricalSalesSummary();

  return {
    products,
    indicators,
    categories,
    batches,
    history,
    historicalSales,
    costingMethodNote: COSTING_METHOD_NOTE,
  };
}

export function getProductProfitDetail(productId: number): {
  product: ProfitProductRow;
  batches: ProductCostBatch[];
  history: ProductCostHistoryEntry[];
} | null {
  const row = db
    .prepare('SELECT * FROM products WHERE id = ? AND archived = 0')
    .get(productId) as Record<string, unknown> | undefined;
  if (!row) return null;

  const product = buildProfitProductRow(mapProductRow(row));
  const batchRows = db
    .prepare(
      `SELECT b.*, p.name as productName, p.sku as productSku, p.archived as productArchived
       FROM product_cost_batches b
       LEFT JOIN products p ON p.id = b.productId
       WHERE b.productId = ?
       ORDER BY b.id DESC`
    )
    .all(productId) as Record<string, unknown>[];

  const batches: ProductCostBatch[] = batchRows.map((r) => ({
    id: Number(r.id),
    productId: Number(r.productId),
    productName: String(r.productName || product.name),
    productSku: formatProductSku(Number(r.productId), r.productSku),
    productArchived: Boolean(r.productArchived),
    quantityPurchased: Number(r.quantityPurchased || 0),
    remainingQuantity: Number(r.remainingQuantity || 0),
    unitPurchaseCost: Number(r.unitPurchaseCost || 0),
    freightCostUnit: Number(r.freightCostUnit || 0),
    packagingCostUnit: Number(r.packagingCostUnit || 0),
    otherCostUnit: Number(r.otherCostUnit || 0),
    totalUnitCost: Number(r.totalUnitCost || 0),
    supplierNote: String(r.supplierNote || ''),
    purchasedAt: String(r.purchasedAt),
    createdAt: String(r.createdAt),
  }));

  const historyRows = db
    .prepare(
      `SELECT h.*, p.archived as productArchived
       FROM product_cost_history h
       LEFT JOIN products p ON p.id = h.productId
       WHERE h.productId = ?
       ORDER BY h.id DESC`
    )
    .all(productId) as Record<string, unknown>[];

  const history: ProductCostHistoryEntry[] = historyRows.map((r) => ({
    id: Number(r.id),
    productId: Number(r.productId),
    productNameSnapshot: String(r.productNameSnapshot || product.name),
    productArchived: Boolean(r.productArchived),
    eventType: String(r.eventType) as ProductCostEventType,
    unitPurchaseCost: Number(r.unitPurchaseCost || 0),
    freightCostUnit: Number(r.freightCostUnit || 0),
    packagingCostUnit: Number(r.packagingCostUnit || 0),
    otherCostUnit: Number(r.otherCostUnit || 0),
    totalUnitCost: Number(r.totalUnitCost || 0),
    salePrice: Number(r.salePrice || 0),
    purchasedQuantity: Number(r.purchasedQuantity || 0),
    stockQuantity: Number(r.stockQuantity || 0),
    note: String(r.note || ''),
    recordedAt: String(r.recordedAt),
  }));

  return { product, batches, history };
}

export function updateProductProfitData(
  productId: number,
  input: {
    sku?: string;
    price?: number;
    costPrice?: number;
    freightCostUnit?: number;
    packagingCostUnit?: number;
    otherCostUnit?: number;
    purchasedQuantity?: number;
    stockQuantity?: number;
    note?: string;
  }
): ProfitProductRow {
  const existingRow = db
    .prepare('SELECT * FROM products WHERE id = ? AND archived = 0')
    .get(productId) as Record<string, unknown> | undefined;

  if (!existingRow) {
    throw new Error('Produto não encontrado ou arquivado.');
  }

  const existing = mapProductRow(existingRow);

  const nextSku =
    typeof input.sku === 'string' && input.sku.trim()
      ? input.sku.trim().toUpperCase().slice(0, 40)
      : formatProductSku(productId, existing.sku);

  const nextPrice =
    input.price !== undefined ? roundMoney(Number(input.price)) : roundMoney(existing.price);
  if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
    throw new Error('O preço de venda deve ser maior que zero.');
  }

  const nextCostPrice =
    input.costPrice !== undefined
      ? roundMoney(Math.max(0, Number(input.costPrice)))
      : roundMoney(existing.costPrice || 0);
  const nextFreight =
    input.freightCostUnit !== undefined
      ? roundMoney(Math.max(0, Number(input.freightCostUnit)))
      : roundMoney(existing.freightCostUnit || 0);
  const nextPackaging =
    input.packagingCostUnit !== undefined
      ? roundMoney(Math.max(0, Number(input.packagingCostUnit)))
      : roundMoney(existing.packagingCostUnit || 0);
  const nextOther =
    input.otherCostUnit !== undefined
      ? roundMoney(Math.max(0, Number(input.otherCostUnit)))
      : roundMoney(existing.otherCostUnit || 0);
  const nextPurchased =
    input.purchasedQuantity !== undefined
      ? Math.max(0, Math.round(Number(input.purchasedQuantity)))
      : Math.max(0, Math.round(Number(existing.purchasedQuantity || 0)));
  const nextStock =
    input.stockQuantity !== undefined
      ? Math.max(0, Math.round(Number(input.stockQuantity)))
      : Math.max(0, Math.round(Number(existing.stockQuantity || 0)));

  if (
    !Number.isFinite(nextCostPrice) ||
    !Number.isFinite(nextFreight) ||
    !Number.isFinite(nextPackaging) ||
    !Number.isFinite(nextOther)
  ) {
    throw new Error('Os valores de custo devem ser numéricos e válidos.');
  }

  const now = new Date().toISOString();
  const onlyPriceChanged =
    nextPrice !== roundMoney(existing.price) &&
    nextCostPrice === roundMoney(existing.costPrice || 0) &&
    nextFreight === roundMoney(existing.freightCostUnit || 0) &&
    nextPackaging === roundMoney(existing.packagingCostUnit || 0) &&
    nextOther === roundMoney(existing.otherCostUnit || 0);

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      UPDATE products SET
        sku = ?,
        price = ?,
        costPrice = ?,
        freightCostUnit = ?,
        packagingCostUnit = ?,
        otherCostUnit = ?,
        purchasedQuantity = ?,
        stockQuantity = ?,
        updatedAt = ?
      WHERE id = ?
    `).run(
      nextSku,
      nextPrice,
      nextCostPrice,
      nextFreight,
      nextPackaging,
      nextOther,
      nextPurchased,
      nextStock,
      now,
      productId
    );

    recordProductCostSnapshot({
      productId,
      productNameSnapshot: existing.name,
      eventType: onlyPriceChanged ? 'price_change' : 'manual_edit',
      unitPurchaseCost: nextCostPrice,
      freightCostUnit: nextFreight,
      packagingCostUnit: nextPackaging,
      otherCostUnit: nextOther,
      salePrice: nextPrice,
      purchasedQuantity: nextPurchased,
      stockQuantity: nextStock,
      note:
        (typeof input.note === 'string' && input.note.trim()) ||
        (onlyPriceChanged
          ? 'Atualização de preço de venda (custo preservado)'
          : 'Atualização de custos e estoque no R&P Profit Manager'),
      recordedAt: now,
    });

    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }

  const updatedRow = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as Record<
    string,
    unknown
  >;
  return buildProfitProductRow(mapProductRow(updatedRow));
}

export function registerProductBatch(
  productId: number,
  input: {
    quantityPurchased: number;
    unitPurchaseCost: number;
    freightCostUnit?: number;
    packagingCostUnit?: number;
    otherCostUnit?: number;
    supplierNote?: string;
    purchasedAt?: string;
  },
  adminId?: number
): { product: ProfitProductRow; batch: ProductCostBatch } {
  const existingRow = db
    .prepare('SELECT * FROM products WHERE id = ? AND archived = 0')
    .get(productId) as Record<string, unknown> | undefined;

  if (!existingRow) {
    throw new Error('Produto não encontrado ou arquivado.');
  }

  const existing = mapProductRow(existingRow);
  const quantityPurchased = Math.round(Number(input.quantityPurchased));
  const unitPurchaseCost = roundMoney(Number(input.unitPurchaseCost));
  const freightCostUnit = roundMoney(Math.max(0, Number(input.freightCostUnit || 0)));
  const packagingCostUnit = roundMoney(Math.max(0, Number(input.packagingCostUnit || 0)));
  const otherCostUnit = roundMoney(Math.max(0, Number(input.otherCostUnit || 0)));
  const supplierNote =
    typeof input.supplierNote === 'string' ? input.supplierNote.trim().slice(0, 200) : '';

  if (!Number.isInteger(quantityPurchased) || quantityPurchased < 1) {
    throw new Error('A quantidade comprada do lote deve ser de pelo menos 1 unidade.');
  }
  if (!Number.isFinite(unitPurchaseCost) || unitPurchaseCost < 0) {
    throw new Error('O valor de compra por unidade deve ser válido e não negativo.');
  }

  const now = new Date().toISOString();
  const purchasedAt =
    typeof input.purchasedAt === 'string' && input.purchasedAt.trim()
      ? input.purchasedAt.trim()
      : now;

  const batchTotalUnitCost = computeTotalUnitCost({
    costPrice: unitPurchaseCost,
    freightCostUnit,
    packagingCostUnit,
    otherCostUnit,
  });

  const weighted = computeWeightedAverageCost({
    currentStockQuantity: Number(existing.stockQuantity || 0),
    currentCostPrice: Number(existing.costPrice || 0),
    currentFreightCostUnit: Number(existing.freightCostUnit || 0),
    currentPackagingCostUnit: Number(existing.packagingCostUnit || 0),
    currentOtherCostUnit: Number(existing.otherCostUnit || 0),
    batchQuantity: quantityPurchased,
    batchUnitPurchaseCost: unitPurchaseCost,
    batchFreightCostUnit: freightCostUnit,
    batchPackagingCostUnit: packagingCostUnit,
    batchOtherCostUnit: otherCostUnit,
  });

  const nextPurchasedTotal = Math.max(0, Number(existing.purchasedQuantity || 0)) + quantityPurchased;

  let batchId = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    const insertRes = db
      .prepare(`
        INSERT INTO product_cost_batches (
          productId, quantityPurchased, remainingQuantity, unitPurchaseCost,
          freightCostUnit, packagingCostUnit, otherCostUnit, totalUnitCost,
          supplierNote, purchasedAt, createdAt, createdByAdminId
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        productId,
        quantityPurchased,
        quantityPurchased,
        unitPurchaseCost,
        freightCostUnit,
        packagingCostUnit,
        otherCostUnit,
        batchTotalUnitCost,
        supplierNote,
        purchasedAt,
        now,
        adminId ?? null
      );

    batchId = Number(insertRes.lastInsertRowid);

    db.prepare(`
      UPDATE products SET
        costPrice = ?,
        freightCostUnit = ?,
        packagingCostUnit = ?,
        otherCostUnit = ?,
        purchasedQuantity = ?,
        stockQuantity = ?,
        updatedAt = ?
      WHERE id = ?
    `).run(
      weighted.nextCostPrice,
      weighted.nextFreightCostUnit,
      weighted.nextPackagingCostUnit,
      weighted.nextOtherCostUnit,
      nextPurchasedTotal,
      weighted.nextStockQuantity,
      now,
      productId
    );

    recordProductCostSnapshot({
      productId,
      productNameSnapshot: existing.name,
      eventType: 'batch_entry',
      unitPurchaseCost: weighted.nextCostPrice,
      freightCostUnit: weighted.nextFreightCostUnit,
      packagingCostUnit: weighted.nextPackagingCostUnit,
      otherCostUnit: weighted.nextOtherCostUnit,
      salePrice: existing.price,
      purchasedQuantity: nextPurchasedTotal,
      stockQuantity: weighted.nextStockQuantity,
      note: supplierNote
        ? `Lote +${quantityPurchased} un. (${supplierNote}) — CMP aplicado`
        : `Lote +${quantityPurchased} un. a R$ ${batchTotalUnitCost.toFixed(2).replace('.', ',')} — CMP aplicado`,
      recordedAt: now,
    });

    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }

  const updatedRow = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as Record<
    string,
    unknown
  >;
  const batchRow = db
    .prepare(
      `SELECT b.*, p.name as productName, p.sku as productSku, p.archived as productArchived
       FROM product_cost_batches b
       LEFT JOIN products p ON p.id = b.productId
       WHERE b.id = ?`
    )
    .get(batchId) as Record<string, unknown>;

  const product = buildProfitProductRow(mapProductRow(updatedRow));
  const batch: ProductCostBatch = {
    id: Number(batchRow.id),
    productId: Number(batchRow.productId),
    productName: String(batchRow.productName || product.name),
    productSku: formatProductSku(Number(batchRow.productId), batchRow.productSku),
    productArchived: Boolean(batchRow.productArchived),
    quantityPurchased: Number(batchRow.quantityPurchased),
    remainingQuantity: Number(batchRow.remainingQuantity),
    unitPurchaseCost: Number(batchRow.unitPurchaseCost),
    freightCostUnit: Number(batchRow.freightCostUnit),
    packagingCostUnit: Number(batchRow.packagingCostUnit),
    otherCostUnit: Number(batchRow.otherCostUnit),
    totalUnitCost: Number(batchRow.totalUnitCost),
    supplierNote: String(batchRow.supplierNote || ''),
    purchasedAt: String(batchRow.purchasedAt),
    createdAt: String(batchRow.createdAt),
  };

  return { product, batch };
}
