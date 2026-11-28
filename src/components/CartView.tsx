import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ArrowLeft, ArrowRight, Lock, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { formatBRL } from '../lib/format';
import { getMaxQuantityForCartLine } from '../lib/stock';
import { formatCartItemVariationLine } from '../lib/whatsappOrder';
import type { CartItem, Product, StoreSettings } from '../types';
import { SafeProductImage } from './BrandMark';

interface CartViewProps {
  items: CartItem[];
  products: Product[];
  subtotal: number;
  discountAmount: number;
  settings: StoreSettings;
  onUpdateQuantity: (productId: number, variation: string, delta: number) => void;
  onRemoveItem: (productId: number, variation: string) => void;
  onBackToStore: () => void;
  onContinueToCheckout: () => void;
}

export function CartView({
  items,
  products,
  subtotal,
  discountAmount,
  settings,
  onUpdateQuantity,
  onRemoveItem,
  onBackToStore,
  onContinueToCheckout,
}: CartViewProps) {
  const [confirmRemoveKey, setConfirmRemoveKey] = useState<string | null>(null);
  const holdDelayRef = useRef<number | null>(null);
  const holdIntervalRef = useRef<number | null>(null);
  const didHoldRef = useRef(false);

  useEffect(() => {
    return () => {
      if (holdDelayRef.current) window.clearTimeout(holdDelayRef.current);
      if (holdIntervalRef.current) window.clearInterval(holdIntervalRef.current);
    };
  }, []);

  const totalUnits = items.reduce((acc, item) => acc + item.quantity, 0);
  const estimatedTotal = Math.max(0, subtotal - discountAmount);
  const minDeliveryOrder = Math.max(0, Number(settings.minDeliveryOrder || 0));
  const missingForMinDelivery = Math.max(0, minDeliveryOrder - subtotal);

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

  function handleQuantityStep(item: CartItem, delta: number, maxStock: number) {
    if (delta < 0 && item.quantity <= 1) {
      setConfirmRemoveKey(`${item.productId}__${item.variation}`);
      return;
    }
    if (delta > 0 && item.quantity >= maxStock) {
      return;
    }
    setConfirmRemoveKey(null);
    onUpdateQuantity(item.productId, item.variation, delta);
  }

  function handleStepperPointerDown(
    e: PointerEvent<HTMLButtonElement>,
    item: CartItem,
    delta: number,
    maxStock: number,
    isDisabled: boolean
  ) {
    if (isDisabled || e.button > 0) return;
    if (delta < 0 && item.quantity <= 1) return;
    clearHoldTimers();
    didHoldRef.current = false;
    holdDelayRef.current = window.setTimeout(() => {
      didHoldRef.current = true;
      handleQuantityStep(item, delta, maxStock);
      holdIntervalRef.current = window.setInterval(() => {
        onUpdateQuantity(item.productId, item.variation, delta);
      }, 110);
    }, 380);
  }

  function handleStepperClick(item: CartItem, delta: number, maxStock: number, isDisabled: boolean) {
    if (isDisabled) return;
    if (didHoldRef.current) {
      didHoldRef.current = false;
      return;
    }
    handleQuantityStep(item, delta, maxStock);
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={onBackToStore}
            className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-[#9E9E9E] hover:text-white transition-colors mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar ao catálogo
          </button>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Seu Carrinho</h1>
        </div>

        <span className="text-sm font-semibold text-[#9E9E9E] tabular-nums">
          {totalUnits} {totalUnits === 1 ? 'unidade' : 'unidades'}
        </span>
      </div>

      {!settings.storeOpen && (
        <div className="p-4 rounded-2xl bg-red-950/50 border border-red-500/40 text-xs sm:text-sm text-red-200 flex items-start gap-3">
          <Lock className="w-4 h-4 shrink-0 mt-0.5 text-red-300" />
          <div>
            <p className="font-bold text-white">Loja fechada no momento</p>
            <p className="mt-0.5">{settings.closedMessage}</p>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-3xl border border-white/12 bg-[#0B0B0B] p-10 sm:p-14 text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-[#9E9E9E]">
            <ShoppingBag className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-white">Seu carrinho está vazio</h2>
          <p className="text-sm text-[#9E9E9E] max-w-md mx-auto">
            Adicione produtos do catálogo da R&amp;P Tabacaria para iniciar seu pedido.
          </p>
          <button
            type="button"
            onClick={onBackToStore}
            className="inline-flex items-center justify-center h-11 px-6 rounded-xl bg-white text-black font-bold text-sm hover:bg-neutral-200 transition-colors"
          >
            Explorar catálogo
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Items List */}
          <div className="lg:col-span-2 space-y-3">
            {items.map((item) => {
              const rowKey = `${item.productId}__${item.variation}`;
              const product = products.find((p) => p.id === item.productId);
              const maxStock = getMaxQuantityForCartLine(product, items, item);
              const atMaxStock = item.quantity >= maxStock;
              const lineTotal = item.price * item.quantity;
              const isConfirmingRemoval = confirmRemoveKey === rowKey;
              const optionLine = formatCartItemVariationLine(item);

              return (
                <div
                  key={rowKey}
                  className="p-4 rounded-2xl border border-white/12 bg-[#0C0C0C] space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="w-20 h-20 rounded-xl overflow-hidden bg-[#141414] shrink-0">
                        <SafeProductImage
                          src={item.imageUrl}
                          alt={item.name}
                          className="w-full h-full object-cover"
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm sm:text-base font-bold text-white truncate">{item.name}</h3>
                        <p className="text-xs text-[#9E9E9E] mt-0.5 break-words">
                          Opção: <span className="text-white font-medium">{optionLine}</span>
                        </p>
                        <p className="text-xs text-[#9E9E9E] mt-1 tabular-nums">
                          Unitário: {formatBRL(item.price)}
                        </p>
                        {atMaxStock && (
                          <p className="text-[11px] font-semibold text-amber-300 mt-1 tabular-nums">
                            Máximo disponível: {maxStock}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 pt-3 sm:pt-0 border-t sm:border-t-0 border-white/10">
                      <div className="flex items-center gap-1 bg-black border border-white/15 rounded-xl p-1">
                        <button
                          type="button"
                          onPointerDown={(e) =>
                            handleStepperPointerDown(e, item, -1, maxStock, false)
                          }
                          onPointerUp={clearHoldTimers}
                          onPointerLeave={clearHoldTimers}
                          onPointerCancel={clearHoldTimers}
                          onClick={() => handleStepperClick(item, -1, maxStock, false)}
                          aria-label={`Diminuir quantidade de ${item.name}`}
                          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-white hover:bg-white/10 transition-colors select-none"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <span className="w-9 text-center text-sm font-bold text-white tabular-nums">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          disabled={atMaxStock}
                          onPointerDown={(e) =>
                            handleStepperPointerDown(e, item, 1, maxStock, atMaxStock)
                          }
                          onPointerUp={clearHoldTimers}
                          onPointerLeave={clearHoldTimers}
                          onPointerCancel={clearHoldTimers}
                          onClick={() => handleStepperClick(item, 1, maxStock, atMaxStock)}
                          aria-label={`Aumentar quantidade de ${item.name}`}
                          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed select-none"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="text-right min-w-[84px]">
                        <p className="text-sm sm:text-base font-extrabold text-white tabular-nums">
                          {formatBRL(lineTotal)}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => onRemoveItem(item.productId, item.variation)}
                        aria-label={`Excluir ${item.name}`}
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl border border-white/10 text-[#9E9E9E] hover:text-red-400 hover:border-red-500/40 transition-colors shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {isConfirmingRemoval && (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-white/10 text-xs">
                      <span className="font-semibold text-amber-300">Remover este item?</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveKey(null)}
                          className="min-h-[36px] px-3 rounded-lg border border-white/15 text-[#E5E5E5] hover:text-white font-semibold"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmRemoveKey(null);
                            onRemoveItem(item.productId, item.variation);
                          }}
                          className="min-h-[36px] px-3 rounded-lg bg-red-500 text-white hover:bg-red-400 font-bold"
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Summary Box */}
          <div className="rounded-3xl border border-white/15 bg-[#0C0C0C] p-6 space-y-5 lg:sticky lg:top-24">
            <h2 className="text-lg font-extrabold text-white">Resumo do Carrinho</h2>

            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-[#9E9E9E]">Subtotal ({totalUnits} un.)</span>
                <span className="font-bold text-white tabular-nums text-base">{formatBRL(subtotal)}</span>
              </div>

              {discountAmount > 0 && (
                <div className="flex items-center justify-between text-xs text-emerald-400">
                  <span>Desconto do cupom</span>
                  <span className="font-bold tabular-nums">-{formatBRL(discountAmount)}</span>
                </div>
              )}

              {minDeliveryOrder > 0 && (
                <div className="p-3 rounded-xl bg-black border border-white/10 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[#9E9E9E]">Pedido mínimo p/ entrega</span>
                    <span className="font-semibold text-white tabular-nums">
                      {formatBRL(minDeliveryOrder)}
                    </span>
                  </div>
                  {missingForMinDelivery > 0 ? (
                    <p className="text-amber-300 font-medium tabular-nums">
                      Falta {formatBRL(missingForMinDelivery)} para entrega (retirada liberada)
                    </p>
                  ) : (
                    <p className="text-emerald-400 font-medium">Valor mínimo para entrega atingido</p>
                  )}
                </div>
              )}

              {settings.shippingMode === 'per_km' && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#9E9E9E]">Frete por distância</span>
                  <span className="text-white font-medium tabular-nums">
                    Grátis até {settings.freeShippingKm.toFixed(1).replace('.', ',')} km ·{' '}
                    {formatBRL(settings.shippingPerKm)}/km
                  </span>
                </div>
              )}

              <div className="pt-3 border-t border-white/10 flex items-center justify-between">
                <span className="font-bold text-white">Total estimado</span>
                <span className="font-extrabold text-white text-lg tabular-nums">
                  {formatBRL(estimatedTotal)}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={onContinueToCheckout}
              disabled={items.length === 0 || !settings.storeOpen}
              className="w-full min-h-[44px] h-12 rounded-xl bg-white text-black font-extrabold text-sm inline-flex items-center justify-center gap-2 hover:bg-neutral-200 active:scale-[0.99] transition-all disabled:opacity-40"
            >
              <span>{settings.storeOpen ? 'CONTINUAR' : 'LOJA FECHADA'}</span>
              {settings.storeOpen && <ArrowRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
