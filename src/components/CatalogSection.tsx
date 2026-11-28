import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Check, ChevronDown, Minus, Plus, Search, ShoppingBag } from 'lucide-react';
import { formatBRL } from '../lib/format';
import {
  buildVariationCombinedString,
  getRemainingAddableForCard,
  resolveVariationStockInfo,
} from '../lib/stock';
import type { CartItem, Product } from '../types';
import { SafeProductImage } from './BrandMark';

interface CatalogSectionProps {
  products: Product[];
  categories: string[];
  selectedCategory: string;
  cart: CartItem[];
  onSelectCategory: (category: string) => void;
  onAddToCart: (
    product: Product,
    variation: string,
    quantity: number,
    variationDetails?: CartItem['variationDetails']
  ) => void;
  onOpenRzin?: () => void;
}

interface FlyingBadgeState {
  id: number;
  startX: number;
  startY: number;
  deltaX: number;
  deltaY: number;
  imageUrl: string;
  qty: number;
}

export function CatalogSection({
  products,
  categories,
  selectedCategory,
  cart,
  onSelectCategory,
  onAddToCart,
  onOpenRzin,
}: CatalogSectionProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVariations, setSelectedVariations] = useState<Record<number, string>>({});
  const [selectedSecondaryVariations, setSelectedSecondaryVariations] = useState<Record<number, string>>({});
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [addedFeedback, setAddedFeedback] = useState<{ productId: number; qty: number } | null>(null);
  const [toastText, setToastText] = useState<string | null>(null);
  const [flyingBadge, setFlyingBadge] = useState<FlyingBadgeState | null>(null);
  const [flyingActive, setFlyingActive] = useState(false);

  const imageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const addCooldownRef = useRef<Record<number, number>>({});
  const holdDelayRef = useRef<number | null>(null);
  const holdIntervalRef = useRef<number | null>(null);
  const didHoldRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const flyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (holdDelayRef.current) window.clearTimeout(holdDelayRef.current);
      if (holdIntervalRef.current) window.clearInterval(holdIntervalRef.current);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
      if (flyTimerRef.current) window.clearTimeout(flyTimerRef.current);
    };
  }, []);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      const matchesCat = selectedCategory === 'Todos' || p.category === selectedCategory;
      const matchesQuery =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.variations.some((v) => v.toLowerCase().includes(q)) ||
        (p.secondaryVariations || []).some((v) => v.toLowerCase().includes(q));
      return matchesCat && matchesQuery;
    });
  }, [products, selectedCategory, searchQuery]);

  function getPrimaryVariation(product: Product): string {
    if (product.variations.length === 0) return '';
    const saved = selectedVariations[product.id];
    if (saved && product.variations.includes(saved)) return saved;
    return '';
  }

  function getSecondaryVariation(product: Product): string {
    const secondary = product.secondaryVariations || [];
    if (secondary.length === 0) return '';
    const saved = selectedSecondaryVariations[product.id];
    if (saved && secondary.includes(saved)) return saved;
    return '';
  }

  function getNumericQuantity(productId: number, maxAllowed: number): number {
    const raw = quantities[productId];
    if (raw === undefined || raw === '') return 1;
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return 1;
    if (maxAllowed > 0 && parsed > maxAllowed) return maxAllowed;
    return parsed;
  }

  function stepQuantity(productId: number, delta: number, maxAllowed: number) {
    if (maxAllowed <= 0) return;
    setQuantities((prev) => {
      const currentRaw = prev[productId];
      const current =
        currentRaw !== undefined && currentRaw !== ''
          ? Math.max(1, parseInt(currentRaw, 10) || 1)
          : 1;
      const next = Math.min(maxAllowed, Math.max(1, current + delta));
      return { ...prev, [productId]: String(next) };
    });
  }

  function clearHoldTimers() {
    if (holdDelayRef.current) {
      window.clearTimeout(holdDelayRef.current);
      holdDelayRef.current = null;
    }
    if (holdIntervalRef.current) {
      window.clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
  }

  function handleStepperPointerDown(
    e: PointerEvent<HTMLButtonElement>,
    productId: number,
    delta: number,
    maxAllowed: number,
    isDisabled: boolean
  ) {
    if (isDisabled || e.button > 0) return;
    clearHoldTimers();
    didHoldRef.current = false;
    holdDelayRef.current = window.setTimeout(() => {
      didHoldRef.current = true;
      stepQuantity(productId, delta, maxAllowed);
      holdIntervalRef.current = window.setInterval(() => {
        stepQuantity(productId, delta, maxAllowed);
      }, 95);
    }, 380);
  }

  function handleStepperClick(productId: number, delta: number, maxAllowed: number, isDisabled: boolean) {
    if (isDisabled) return;
    if (didHoldRef.current) {
      didHoldRef.current = false;
      return;
    }
    stepQuantity(productId, delta, maxAllowed);
  }

  function triggerFlyToCart(product: Product, qty: number, buttonEl: HTMLElement | null) {
    if (typeof window === 'undefined') return;
    const prefersReduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const targetEl = document.getElementById('header-cart-button');
    if (prefersReduced || !targetEl) return;

    const sourceEl = imageRefs.current[product.id] || buttonEl;
    if (!sourceEl) return;

    const srcRect = sourceEl.getBoundingClientRect();
    const dstRect = targetEl.getBoundingClientRect();

    const startX = srcRect.left + srcRect.width / 2 - 22;
    const startY = srcRect.top + srcRect.height / 2 - 22;
    const endX = dstRect.left + dstRect.width / 2 - 22;
    const endY = dstRect.top + dstRect.height / 2 - 22;

    if (flyTimerRef.current) window.clearTimeout(flyTimerRef.current);

    setFlyingActive(false);
    setFlyingBadge({
      id: Date.now(),
      startX,
      startY,
      deltaX: endX - startX,
      deltaY: endY - startY,
      imageUrl: product.imageUrl,
      qty,
    });

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setFlyingActive(true);
      });
    });

    flyTimerRef.current = window.setTimeout(() => {
      setFlyingBadge(null);
      setFlyingActive(false);
      targetEl.classList.add('scale-105');
      window.setTimeout(() => targetEl.classList.remove('scale-105'), 180);
    }, 680);
  }

  function handleAdd(product: Product, buttonEl: HTMLElement | null) {
    const now = Date.now();
    if (now - (addCooldownRef.current[product.id] || 0) < 400) {
      return;
    }

    const primary = getPrimaryVariation(product);
    const secondary = getSecondaryVariation(product);
    const secondaryList = product.secondaryVariations || [];
    const needsPrimary = product.variations.length > 0 && !primary;
    const needsSecondary = secondaryList.length > 0 && !secondary;
    if (needsPrimary || needsSecondary) {
      return;
    }

    const { optionStock, remainingAddable } = getRemainingAddableForCard(
      product,
      cart,
      primary,
      secondary
    );
    if (optionStock <= 0 || remainingAddable <= 0) {
      return;
    }

    const qty = Math.min(remainingAddable, getNumericQuantity(product.id, remainingAddable));
    addCooldownRef.current[product.id] = now;

    const variation = buildVariationCombinedString(primary, secondary);
    const variationDetails: CartItem['variationDetails'] | undefined =
      primary || secondary
        ? {
            ...(primary
              ? {
                  primaryLabel: product.variationLabel?.trim() || 'Sabor / Variação',
                  primaryValue: primary,
                }
              : {}),
            ...(secondary
              ? {
                  secondaryLabel: product.secondaryVariationLabel?.trim() || 'Opção',
                  secondaryValue: secondary,
                }
              : {}),
          }
        : undefined;

    onAddToCart(product, variation, qty, variationDetails);

    // Reset card selector back to 1
    setQuantities((prev) => ({ ...prev, [product.id]: '1' }));

    triggerFlyToCart(product, qty, buttonEl);

    setAddedFeedback({ productId: product.id, qty });
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => {
      setAddedFeedback((current) => (current?.productId === product.id ? null : current));
    }, 1600);

    const unitText = qty === 1 ? 'unidade adicionada' : 'unidades adicionadas';
    setToastText(`${qty} ${unitText}`);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToastText(null);
    }, 2200);
  }

  return (
    <section id="catalogo-section" className="space-y-4 sm:space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 sm:gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">Catálogo de Produtos</h2>
          <p className="text-xs sm:text-sm text-[#9E9E9E] mt-0.5">
            Escolha a opção desejada, ajuste a quantidade e clique em Adicionar.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full md:w-auto">
          {onOpenRzin && (
            <button
              type="button"
              onClick={onOpenRzin}
              className="h-10 px-3.5 rounded-xl bg-[#111111] border border-white/20 text-xs font-bold text-white hover:bg-white hover:text-black transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
            >
              <img
                src="/assets/aistudio/IMG_3605_dc04d8e0.jpeg"
                alt="RZIN"
                referrerPolicy="no-referrer"
                className="w-5 h-5 rounded-full object-cover object-top"
              />
              <span>Dúvida na essência? Falar com RZIN</span>
            </button>
          )}

          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 text-[#9E9E9E] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar produto ou sabor..."
              className="w-full h-10 pl-10 pr-4 rounded-xl bg-[#0D0D0D] border border-white/15 text-xs sm:text-sm text-white placeholder-[#9E9E9E] focus:outline-none focus:border-white transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Category Filter Tabs */}
      <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto pb-1">
        {categories.map((category) => {
          const isActive = selectedCategory === category;
          return (
            <button
              key={category}
              type="button"
              onClick={() => onSelectCategory(category)}
              className={`px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 border ${
                isActive
                  ? 'bg-white text-black border-white'
                  : 'bg-[#0D0D0D] text-[#9E9E9E] border-white/10 hover:text-white hover:border-white/30'
              }`}
            >
              {category}
            </button>
          );
        })}
      </div>

      {/* Product Grid */}
      {filteredProducts.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[#0A0A0A] p-10 text-center">
          <p className="text-sm sm:text-base font-semibold text-white">Nenhum produto encontrado</p>
          <p className="text-xs sm:text-sm text-[#9E9E9E] mt-1">Tente limpar a busca ou selecionar outra categoria.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 sm:gap-3.5 lg:gap-4 items-stretch">
          {filteredProducts.map((product) => {
            const primaryVariation = getPrimaryVariation(product);
            const secondaryVariation = getSecondaryVariation(product);
            const secondaryList = product.secondaryVariations || [];

            const needsPrimary = product.variations.length > 0 && !primaryVariation;
            const needsSecondary = secondaryList.length > 0 && !secondaryVariation;
            const missingOption = needsPrimary || needsSecondary;

            const productTotalStock = Math.max(0, Math.round(Number(product.stockQuantity ?? 0)));
            const { optionStock, remainingAddable } = getRemainingAddableForCard(
              product,
              cart,
              primaryVariation,
              secondaryVariation
            );

            const optionExplicitlySoldOut = !missingOption && optionStock <= 0;
            const productSoldOut = productTotalStock <= 0;
            const isSoldOut = productSoldOut || optionExplicitlySoldOut;

            const maxSelectable = missingOption ? productTotalStock : remainingAddable;
            const rawQtyText = quantities[product.id];
            const numericQty = getNumericQuantity(product.id, Math.max(1, maxSelectable));
            const displayQtyInput = rawQtyText !== undefined ? rawQtyText : String(numericQty);

            const reachedStockLimit = !isSoldOut && !missingOption && numericQty >= maxSelectable;
            const selectorDisabled = isSoldOut || missingOption || remainingAddable <= 0;
            const decrementDisabled = selectorDisabled || numericQty <= 1;
            const incrementDisabled = selectorDisabled || numericQty >= maxSelectable;

            const isAdded = addedFeedback?.productId === product.id;
            const totalLinePrice = product.price * numericQty;

            return (
              <article
                key={product.id}
                className="group flex flex-col h-full rounded-xl sm:rounded-2xl border border-white/12 bg-[#0C0C0C] overflow-hidden hover:border-white/30 transition-all duration-200 hover:-translate-y-0.5"
              >
                <div
                  ref={(el) => {
                    imageRefs.current[product.id] = el;
                  }}
                  className="relative aspect-[4/3] w-full bg-[#141414] overflow-hidden shrink-0"
                >
                  <SafeProductImage
                    src={product.imageUrl}
                    alt={product.name}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                  {product.badgeLabel && product.badgeLabel.trim() && (
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-white text-black text-[10px] font-extrabold uppercase tracking-wider shadow-md">
                      {product.badgeLabel.trim()}
                    </span>
                  )}
                </div>

                <div className="p-2.5 sm:p-3.5 flex flex-col flex-1 gap-2">
                  <div>
                    <p className="text-[10px] sm:text-[11px] font-medium uppercase tracking-wider text-[#8E8E9E] truncate">
                      {product.category}
                    </p>
                    <h3 className="text-[13px] sm:text-sm font-bold text-white mt-0.5 leading-snug line-clamp-2">
                      {product.name}
                    </h3>
                  </div>

                  {product.description && (
                    <p className="text-[11px] sm:text-xs text-[#9E9E9E] leading-snug line-clamp-2">
                      {product.description}
                    </p>
                  )}

                  {(product.variations.length > 0 || secondaryList.length > 0) && (
                    <div className="pt-0.5 space-y-2">
                      {product.variations.length > 0 && (
                        <div>
                          <label
                            htmlFor={`var-1-${product.id}`}
                            className="block text-[10px] sm:text-[11px] font-medium text-[#BDBDBD] mb-1 truncate"
                          >
                            {product.variationLabel?.trim() || 'Sabor / Variação'} *
                          </label>
                          <div className="relative">
                            <select
                              id={`var-1-${product.id}`}
                              value={primaryVariation}
                              disabled={productSoldOut}
                              onChange={(e) => {
                                const nextPrimary = e.target.value;
                                setSelectedVariations((prev) => ({
                                  ...prev,
                                  [product.id]: nextPrimary,
                                }));
                                const nextMax = getRemainingAddableForCard(
                                  product,
                                  cart,
                                  nextPrimary,
                                  secondaryVariation
                                ).remainingAddable;
                                setQuantities((prev) => ({
                                  ...prev,
                                  [product.id]: String(
                                    Math.min(
                                      Math.max(1, nextMax),
                                      Math.max(1, parseInt(prev[product.id] || '1', 10) || 1)
                                    )
                                  ),
                                }));
                              }}
                              className={`w-full min-h-[40px] pl-2.5 pr-7 rounded-lg bg-black border text-[11px] sm:text-xs font-medium text-white appearance-none focus:outline-none focus:border-white transition-colors truncate cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                                needsPrimary && !productSoldOut ? 'border-amber-400/60' : 'border-white/20'
                              }`}
                            >
                              <option value="" className="bg-[#0C0C0C] text-[#9E9E9E]">
                                Escolha uma opção...
                              </option>
                              {product.variations.map((variation) => {
                                const optInfo = resolveVariationStockInfo(product, variation);
                                const optEmpty = optInfo.available <= 0;
                                return (
                                  <option key={variation} value={variation} className="bg-[#0C0C0C] text-white">
                                    {optEmpty ? `${variation} (Esgotado)` : variation}
                                  </option>
                                );
                              })}
                            </select>
                            <ChevronDown className="w-3.5 h-3.5 text-white/80 pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" />
                          </div>
                        </div>
                      )}

                      {secondaryList.length > 0 && (
                        <div>
                          <label
                            htmlFor={`var-2-${product.id}`}
                            className="block text-[10px] sm:text-[11px] font-medium text-[#BDBDBD] mb-1 truncate"
                          >
                            {product.secondaryVariationLabel?.trim() || '2ª Variação / Opção'} *
                          </label>
                          <div className="relative">
                            <select
                              id={`var-2-${product.id}`}
                              value={secondaryVariation}
                              disabled={productSoldOut}
                              onChange={(e) => {
                                const nextSecondary = e.target.value;
                                setSelectedSecondaryVariations((prev) => ({
                                  ...prev,
                                  [product.id]: nextSecondary,
                                }));
                                const nextMax = getRemainingAddableForCard(
                                  product,
                                  cart,
                                  primaryVariation,
                                  nextSecondary
                                ).remainingAddable;
                                setQuantities((prev) => ({
                                  ...prev,
                                  [product.id]: String(
                                    Math.min(
                                      Math.max(1, nextMax),
                                      Math.max(1, parseInt(prev[product.id] || '1', 10) || 1)
                                    )
                                  ),
                                }));
                              }}
                              className={`w-full min-h-[40px] pl-2.5 pr-7 rounded-lg bg-black border text-[11px] sm:text-xs font-medium text-white appearance-none focus:outline-none focus:border-white transition-colors truncate cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                                needsSecondary && !productSoldOut ? 'border-amber-400/60' : 'border-white/20'
                              }`}
                            >
                              <option value="" className="bg-[#0C0C0C] text-[#9E9E9E]">
                                Escolha uma opção...
                              </option>
                              {secondaryList.map((variation) => {
                                const combinedOpt = buildVariationCombinedString(primaryVariation, variation);
                                const optInfo = resolveVariationStockInfo(product, combinedOpt);
                                const optEmpty = optInfo.available <= 0;
                                return (
                                  <option key={variation} value={variation} className="bg-[#0C0C0C] text-white">
                                    {optEmpty ? `${variation} (Esgotado)` : variation}
                                  </option>
                                );
                              })}
                            </select>
                            <ChevronDown className="w-3.5 h-3.5 text-white/80 pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Price + Dynamic Total + Selector + Add CTA */}
                  <div className="mt-auto pt-2.5 border-t border-white/10 space-y-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm sm:text-base font-extrabold text-white tabular-nums">
                        {formatBRL(totalLinePrice)}
                      </span>
                      {numericQty > 1 && (
                        <span className="text-[11px] text-[#9E9E9E] tabular-nums">
                          {numericQty} × {formatBRL(product.price)} = {formatBRL(totalLinePrice)}
                        </span>
                      )}
                    </div>

                    {!isSoldOut && missingOption && (
                      <p
                        role="status"
                        className="text-[11px] font-bold tracking-wide text-amber-400"
                      >
                        ESCOLHA UMA OPÇÃO
                      </p>
                    )}

                    {reachedStockLimit && (
                      <p className="text-[11px] font-semibold text-amber-300 tabular-nums">
                        Máximo disponível: {maxSelectable}
                      </p>
                    )}

                    {/* Quantity Selector: [ - ] qty [ + ] */}
                    <div className="flex items-center justify-between gap-1 bg-black border border-white/15 rounded-xl p-1">
                      <button
                        type="button"
                        aria-label={`Diminuir quantidade de ${product.name}`}
                        disabled={decrementDisabled}
                        onPointerDown={(e) =>
                          handleStepperPointerDown(e, product.id, -1, maxSelectable, decrementDisabled)
                        }
                        onPointerUp={clearHoldTimers}
                        onPointerLeave={clearHoldTimers}
                        onPointerCancel={clearHoldTimers}
                        onClick={() =>
                          handleStepperClick(product.id, -1, maxSelectable, decrementDisabled)
                        }
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-white hover:bg-white/10 active:bg-white/15 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent select-none"
                      >
                        <Minus className="w-4 h-4" />
                      </button>

                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        aria-label={`Quantidade de ${product.name}`}
                        disabled={selectorDisabled}
                        value={isSoldOut ? '0' : displayQtyInput}
                        onChange={(e) => {
                          const digitsOnly = e.target.value.replace(/\D/g, '');
                          if (digitsOnly === '') {
                            setQuantities((prev) => ({ ...prev, [product.id]: '' }));
                            return;
                          }
                          const parsed = parseInt(digitsOnly, 10);
                          if (!Number.isFinite(parsed)) return;
                          const clamped = Math.min(Math.max(1, maxSelectable), Math.max(1, parsed));
                          setQuantities((prev) => ({ ...prev, [product.id]: String(clamped) }));
                        }}
                        onBlur={() => {
                          const normalized = getNumericQuantity(product.id, Math.max(1, maxSelectable));
                          setQuantities((prev) => ({ ...prev, [product.id]: String(normalized) }));
                        }}
                        className="w-full min-w-0 h-11 bg-transparent text-center text-sm font-bold text-white tabular-nums focus:outline-none disabled:opacity-40"
                      />

                      <button
                        type="button"
                        aria-label={`Aumentar quantidade de ${product.name}`}
                        disabled={incrementDisabled}
                        onPointerDown={(e) =>
                          handleStepperPointerDown(e, product.id, 1, maxSelectable, incrementDisabled)
                        }
                        onPointerUp={clearHoldTimers}
                        onPointerLeave={clearHoldTimers}
                        onPointerCancel={clearHoldTimers}
                        onClick={() =>
                          handleStepperClick(product.id, 1, maxSelectable, incrementDisabled)
                        }
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-white hover:bg-white/10 active:bg-white/15 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent select-none"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Primary Add / Sold Out Button */}
                    <button
                      type="button"
                      disabled={isSoldOut || missingOption || remainingAddable <= 0}
                      onClick={(e) => handleAdd(product, e.currentTarget)}
                      className={`w-full min-h-[44px] px-3 rounded-xl text-xs sm:text-sm font-extrabold tracking-wide inline-flex items-center justify-center gap-1.5 transition-all whitespace-nowrap ${
                        isSoldOut
                          ? 'bg-white/10 text-[#9E9E9E] border border-white/10 cursor-not-allowed'
                          : isAdded
                            ? 'bg-emerald-500 text-black'
                            : missingOption || remainingAddable <= 0
                              ? 'bg-white/20 text-white/60 cursor-not-allowed'
                              : 'bg-white text-black hover:bg-neutral-200 active:scale-[0.98]'
                      }`}
                    >
                      {isSoldOut ? (
                        'ESGOTADO'
                      ) : isAdded ? (
                        <>
                          <Check className="w-4 h-4 shrink-0" />
                          <span>
                            {addedFeedback.qty}{' '}
                            {addedFeedback.qty === 1 ? 'unidade adicionada' : 'unidades adicionadas'}
                          </span>
                        </>
                      ) : (
                        'ADICIONAR'
                      )}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Flying-to-Cart Visual Element (680ms) */}
      {flyingBadge && (
        <div
          key={flyingBadge.id}
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: flyingBadge.startX,
            top: flyingBadge.startY,
            width: 44,
            height: 44,
            zIndex: 60,
            pointerEvents: 'none',
            transform: flyingActive
              ? `translate3d(${flyingBadge.deltaX}px, ${flyingBadge.deltaY}px, 0) scale(0.35)`
              : 'translate3d(0, 0, 0) scale(1)',
            opacity: flyingActive ? 0.15 : 1,
            transition:
              'transform 680ms cubic-bezier(0.22, 1, 0.36, 1), opacity 680ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
          className="rounded-xl overflow-hidden bg-white border-2 border-white shadow-2xl flex items-center justify-center"
        >
          {flyingBadge.imageUrl ? (
            <img
              src={flyingBadge.imageUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          ) : (
            <ShoppingBag className="w-5 h-5 text-black" />
          )}
          <span className="absolute -bottom-0.5 -right-0.5 px-1.5 py-0.5 rounded-md bg-black text-white text-[10px] font-extrabold tabular-nums">
            +{flyingBadge.qty}
          </span>
        </div>
      )}

      {/* Quick Toast Confirmation */}
      {toastText && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-white text-black font-extrabold text-xs sm:text-sm shadow-2xl border border-black/15 flex items-center gap-2 whitespace-nowrap pointer-events-none"
        >
          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{toastText}</span>
        </div>
      )}
    </section>
  );
}
