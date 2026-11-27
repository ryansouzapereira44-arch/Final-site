import { PackageCheck } from 'lucide-react';
import { formatBRL, formatDateTimeBR } from '../lib/format';
import type { Order } from '../types';

interface MyOrdersViewProps {
  orders: Order[];
  loading: boolean;
  onBackToStore: () => void;
}

export function MyOrdersView({ orders, loading, onBackToStore }: MyOrdersViewProps) {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Meus Pedidos</h1>
          <p className="text-sm text-[#9E9E9E] mt-1">Acompanhe o andamento dos seus pedidos na R&amp;P Tabacaria.</p>
        </div>
        <button
          type="button"
          onClick={onBackToStore}
          className="h-10 px-4 rounded-xl border border-white/20 text-xs sm:text-sm font-semibold text-white hover:bg-white hover:text-black transition-colors whitespace-nowrap"
        >
          Ver catálogo
        </button>
      </div>

      {loading ? (
        <div className="rounded-3xl border border-white/10 bg-[#0C0C0C] p-10 text-center text-sm text-[#9E9E9E]">
          Carregando seus pedidos...
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-3xl border border-white/10 bg-[#0C0C0C] p-12 text-center space-y-3">
          <PackageCheck className="w-9 h-9 mx-auto text-[#9E9E9E]" />
          <p className="text-base font-bold text-white">Você ainda não fez nenhum pedido</p>
          <p className="text-sm text-[#9E9E9E]">Quando você finalizar uma compra, ela aparecerá aqui.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <article
              key={order.id}
              className="rounded-2xl border border-white/12 bg-[#0C0C0C] p-5 sm:p-6 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10">
                <div>
                  <h2 className="text-base sm:text-lg font-extrabold text-white tabular-nums">
                    Pedido #{order.orderNumber}
                  </h2>
                  <p className="text-xs text-[#9E9E9E] mt-0.5">
                    {formatDateTimeBR(order.createdAt)} · {order.deliveryMethod} · {order.paymentMethod}
                  </p>
                </div>
                <span className="text-xs sm:text-sm font-bold text-white px-3 py-1.5 rounded-lg bg-white/10">
                  {order.status}
                </span>
              </div>

              <div className="space-y-2">
                {order.items.map((item, idx) => (
                  <div key={`${item.productId}-${idx}`} className="flex justify-between text-sm">
                    <span className="text-[#E5E5E5]">
                      {item.quantity}x {item.name}{' '}
                      <span className="text-[#9E9E9E]">({item.variation})</span>
                    </span>
                    <span className="font-semibold text-white tabular-nums">
                      {formatBRL(item.price * item.quantity)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="text-xs text-[#9E9E9E]">
                  Frete: <strong className="text-white">{order.shippingLabel}</strong>
                  {order.couponCode ? ` · Cupom: ${order.couponCode}` : ''}
                </span>
                <span className="text-base font-extrabold text-white tabular-nums">
                  Total: {formatBRL(order.total)}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
