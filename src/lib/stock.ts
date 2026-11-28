import type { CartItem, Product } from '../types.ts';

export function sanitizeVariationStockMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, number> = {};
  for (const [rawKey, rawVal] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(rawKey).trim();
    const num = Number(rawVal);
    if (!key || !Number.isFinite(num)) continue;
    result[key] = Math.max(0, Math.round(num));
  }
  return result;
}

export function buildVariationCombinedString(
  primaryVariation?: string,
  secondaryVariation?: string
): string {
  const combined = [primaryVariation?.trim(), secondaryVariation?.trim()].filter(Boolean).join(' · ');
  return combined || 'Padrão';
}

export function splitVariationString(variation: string): {
  primary: string;
  secondary: string;
} {
  const parts = String(variation || '')
    .split('·')
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    primary: parts[0] || '',
    secondary: parts.slice(1).join(' · '),
  };
}

export function resolveVariationStockInfo(
  product: Pick<Product, 'stockQuantity' | 'variationStock' | 'variations' | 'secondaryVariations'>,
  variationString?: string
): {
  stockKey: string | null;
  available: number;
  usesOptionStock: boolean;
} {
  const productStock = Math.max(0, Math.round(Number(product.stockQuantity ?? 0)));
  if (productStock <= 0) {
    return { stockKey: null, available: 0, usesOptionStock: false };
  }

  const varStock = product.variationStock || {};
  const cleanVariation = (variationString || '').trim();

  if (cleanVariation && Object.prototype.hasOwnProperty.call(varStock, cleanVariation)) {
    const optStock = Math.max(0, Math.round(Number(varStock[cleanVariation] ?? 0)));
    return {
      stockKey: cleanVariation,
      available: Math.min(productStock, optStock),
      usesOptionStock: true,
    };
  }

  const { primary } = splitVariationString(cleanVariation);
  if (primary && Object.prototype.hasOwnProperty.call(varStock, primary)) {
    const optStock = Math.max(0, Math.round(Number(varStock[primary] ?? 0)));
    return {
      stockKey: primary,
      available: Math.min(productStock, optStock),
      usesOptionStock: true,
    };
  }

  return {
    stockKey: null,
    available: productStock,
    usesOptionStock: false,
  };
}

export function getRemainingAddableForCard(
  product: Product,
  cart: CartItem[],
  primaryVariation: string,
  secondaryVariation: string
): {
  optionStock: number;
  remainingAddable: number;
  inCartSameOption: number;
  inCartSameProduct: number;
  usesOptionStock: boolean;
} {
  const combined = buildVariationCombinedString(primaryVariation, secondaryVariation);
  const { available: optionStock, usesOptionStock } = resolveVariationStockInfo(product, combined);

  const inCartSameOption = cart
    .filter((item) => item.productId === product.id && item.variation === combined)
    .reduce((sum, item) => sum + item.quantity, 0);

  const inCartSameProduct = cart
    .filter((item) => item.productId === product.id)
    .reduce((sum, item) => sum + item.quantity, 0);

  const productTotalStock = Math.max(0, Math.round(Number(product.stockQuantity ?? 0)));
  const remainingByProduct = Math.max(0, productTotalStock - inCartSameProduct);
  const remainingByOption = Math.max(0, optionStock - inCartSameOption);

  const remainingAddable = usesOptionStock
    ? Math.min(remainingByOption, remainingByProduct)
    : remainingByProduct;

  return {
    optionStock,
    remainingAddable,
    inCartSameOption,
    inCartSameProduct,
    usesOptionStock,
  };
}

export function getMaxQuantityForCartLine(
  product: Product | undefined,
  cart: CartItem[],
  targetItem: CartItem
): number {
  if (!product) return targetItem.quantity;
  const { available: optionStock, usesOptionStock } = resolveVariationStockInfo(product, targetItem.variation);
  const productTotalStock = Math.max(0, Math.round(Number(product.stockQuantity ?? 0)));

  const otherUnitsSameProduct = cart
    .filter((item) => item.productId === targetItem.productId && item.variation !== targetItem.variation)
    .reduce((sum, item) => sum + item.quantity, 0);

  const maxByProduct = Math.max(0, productTotalStock - otherUnitsSameProduct);
  return usesOptionStock ? Math.min(optionStock, maxByProduct) : maxByProduct;
}
