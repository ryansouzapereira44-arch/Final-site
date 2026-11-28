import { ArrowLeft, Bike, CheckCircle2, MapPin, PackageCheck } from 'lucide-react';
import { formatBRL, formatDateTimeBR } from '../lib/format';
import { isOrderDelivered, isTrackingAvailableForOrder } from '../lib/tracking';
import type { Order } from '../types';

interface MyOrdersViewProps {
  orders: Order[];
  loading: boolean;
  onBackToStore: () => void;
  onTrackDelivery: (orderId: number) => void;
}

export function MyOrdersView({
  orders,
  loading,
  onBackToStore,
  onTrackDelivery,
}: MyOrdersViewProps) {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Meus Pedidos</h1>
          <p className="text-sm text-[#9E9E9E] mt-1">
            Acompanhe o status dos seus pedidos e o rastreamento de entregas em tempo real.
          </p>
        </div>

        <button
          type="button"
          onClick={onBackToStore}
          className="h-10 px-4 rounded-xl border border-white/15 text-xs sm:text-sm font-bold text-white inline-flex items-center gap-2 hover:bg-white hover:text-black transition-colors whitespace-nowrap"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar ao Catálogo
        </button>
      </div>

      {loading ? (
        <div className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-10 text-center text-sm text-[#9E9E9E]">
          Carregando seus pedidos...
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-12 text-center space-y-3">
          <PackageCheck className="w-9 h-9 mx-auto text-[#9E9E9E]" />
          <p className="text-base font-bold text-white">Você ainda não possui pedidos</p>
          <p className="text-sm text-[#9E9E9E]">
            Quando finalizar um pedido no catálogo, ele aparecerá aqui para acompanhamento.
          </p>
          <button
            type="button"
            onClick={onBackToStore}
            className="mt-2 h-11 px-6 rounded-xl bg-white text-black font-extrabold text-xs sm:text-sm hover:bg-neutral-200 transition-colors"
          >
            Explorar Catálogo
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => {
            const canTrack = isTrackingAvailableForOrder(order);
            const delivered = isOrderDelivered(order.status);

            return (
              <article
                key={order.id}
                className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-5 sm:p-6 space-y-4"
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
                  <span
                    className={`text-xs sm:text-sm font-bold px-3 py-1.5 rounded-lg ${
                      canTrack
                        ? 'bg-white text-black'
                        : delivered
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/35'
                          : 'bg-white/10 text-white'
                    }`}
                  >
                    {order.status}
                  </span>
                </div>

                {order.address && (
                  <div className="rounded-2xl bg-black border border-white/10 p-3.5 flex items-start gap-2.5 text-xs sm:text-sm">
                    <MapPin className="w-4 h-4 text-white shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-white">
                        {order.address.street}, {order.address.number} — {order.address.neighborhood}
                      </p>
                      <p className="text-xs text-[#9E9E9E] tabular-nums">
                        CEP {order.address.cep}
                        {order.address.complement ? ` · ${order.address.complement}` : ''}
                      </p>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
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

                {canTrack && (
                  <div className="pt-3 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="text-xs">
                      <p className="font-bold text-white">Entrega em deslocamento</p>
                      <p className="text-[#9E9E9E]">
                        {order.assignedCourierName
                          ? `Motoboy: ${order.assignedCourierName} · `
                          : ''}
                        Clique para abrir o mapa em tempo real.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onTrackDelivery(order.id)}
                      className="h-11 px-5 rounded-xl bg-white text-black font-extrabold text-xs sm:text-sm inline-flex items-center justify-center gap-2 hover:bg-neutral-200 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Bike className="w-4 h-4" />
                      ACOMPANHAR ENTREGA
                    </button>
                  </div>
                )}

                {order.status === 'Entregue' && (
                  <div className="pt-2 flex items-center gap-2 text-xs text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>
                      Entrega concluída{order.deliveredAt ? ` em ${formatDateTimeBR(order.deliveredAt)}` : ''}.
                    </span>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
