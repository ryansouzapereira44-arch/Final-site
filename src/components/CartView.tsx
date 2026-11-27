import { ArrowLeft, ArrowRight, Lock, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { formatBRL } from '../lib/format';
import type { CartItem, StoreSettings } from '../types';
import { SafeProductImage } from './BrandMark';

interface CartViewProps {
  items: CartItem[];
  subtotal: number;
  settings: StoreSettings;
  onUpdateQuantity: (productId: number, variation: string, delta: number) => void;
  onRemoveItem: (productId: number, variation: string) => void;
  onBackToStore: () => void;
  onContinueToCheckout: () => void;
}

export function CartView({
  items,
  subtotal,
  settings,
  onUpdateQuantity,
  onRemoveItem,
  onBackToStore,
  onContinueToCheckout,
}: CartViewProps) {
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
          {items.reduce((acc, item) => acc + item.quantity, 0)} {items.length === 1 ? 'item' : 'itens'}
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
              const lineTotal = item.price * item.quantity;
              return (
                <div
                  key={`${item.productId}__${item.variation}`}
                  className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-2xl border border-white/12 bg-[#0C0C0C]"
                >
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
                      <p className="text-xs text-[#9E9E9E] mt-0.5">
                        Sabor / Variação: <span className="text-white font-medium">{item.variation}</span>
                      </p>
                      <p className="text-xs text-[#9E9E9E] mt-1 tabular-nums">
                        Unitário: {formatBRL(item.price)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 pt-3 sm:pt-0 border-t sm:border-t-0 border-white/10">
                    <div className="flex items-center gap-1 bg-black border border-white/15 rounded-xl p-1">
                      <button
                        type="button"
                        onClick={() => onUpdateQuantity(item.productId, item.variation, -1)}
                        aria-label="Diminuir quantidade"
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-white hover:bg-white/10 transition-colors"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-8 text-center text-sm font-bold text-white tabular-nums">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => onUpdateQuantity(item.productId, item.variation, 1)}
                        aria-label="Aumentar quantidade"
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-white hover:bg-white/10 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
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
                      className="w-9 h-9 flex items-center justify-center rounded-xl border border-white/10 text-[#9E9E9E] hover:text-red-400 hover:border-red-500/40 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Summary Box */}
          <div className="rounded-3xl border border-white/15 bg-[#0C0C0C] p-6 space-y-5 lg:sticky lg:top-24">
            <h2 className="text-lg font-extrabold text-white">Resumo do Carrinho</h2>

            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-[#9E9E9E]">Subtotal</span>
                <span className="font-bold text-white tabular-nums text-base">{formatBRL(subtotal)}</span>
              </div>

              {settings.shippingMode === 'per_km' && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#9E9E9E]">Frete por distância</span>
                  <span className="text-white font-medium tabular-nums">
                    Grátis até {settings.freeShippingKm.toFixed(1).replace('.', ',')} km ·{' '}
                    {formatBRL(settings.shippingPerKm)}/km
                  </span>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onContinueToCheckout}
              disabled={items.length === 0 || !settings.storeOpen}
              className="w-full h-12 rounded-xl bg-white text-black font-extrabold text-sm inline-flex items-center justify-center gap-2 hover:bg-neutral-200 active:scale-[0.99] transition-all disabled:opacity-40"
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
