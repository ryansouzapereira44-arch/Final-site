import { CheckCircle2, ClipboardList, ShoppingBag } from 'lucide-react';
import { formatBRL, formatDateTimeBR } from '../lib/format';
import type { Order } from '../types';

interface OrderConfirmationModalProps {
  order: Order;
  onViewOrders: () => void;
  onBackToStore: () => void;
}

export function OrderConfirmationModal({
  order,
  onViewOrders,
  onBackToStore,
}: OrderConfirmationModalProps) {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="rounded-3xl border border-white/15 bg-[#0C0C0C] p-6 sm:p-10 space-y-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <div>
            <p className="text-xs font-semibold text-emerald-400">Pedido registrado</p>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white mt-0.5 tabular-nums">
              Pedido #{order.orderNumber}
            </h1>
            <p className="text-xs sm:text-sm text-[#9E9E9E] mt-1">
              Recebido em {formatDateTimeBR(order.createdAt)} · Status: {order.status}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-2xl bg-black border border-white/10 text-sm">
          <div>
            <p className="text-xs text-[#9E9E9E]">Cliente</p>
            <p className="font-semibold text-white">{order.customerName}</p>
            <p className="text-xs text-[#9E9E9E] mt-0.5 tabular-nums">{order.customerWhatsapp}</p>
          </div>
          <div>
            <p className="text-xs text-[#9E9E9E]">Recebimento e Pagamento</p>
            <p className="font-semibold text-white">{order.deliveryMethod}</p>
            <p className="text-xs text-[#9E9E9E] mt-0.5">
              {order.paymentMethod}
              {order.changeFor ? ` (Troco p/ ${order.changeFor})` : ''}
            </p>
          </div>
          {order.address && (
            <div className="sm:col-span-2 pt-2 border-t border-white/10">
              <p className="text-xs text-[#9E9E9E]">Endereço de entrega</p>
              <p className="text-sm text-white">
                {order.address.street}, {order.address.number} — {order.address.neighborhood} · CEP{' '}
                {order.address.cep}
                {order.address.complement ? ` (${order.address.complement})` : ''}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-2.5">
          <h2 className="text-sm font-bold text-white">Itens do pedido</h2>
          <div className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-black px-4">
            {order.items.map((item, idx) => (
              <div key={`${item.productId}-${idx}`} className="py-3 flex items-center justify-between gap-4 text-sm">
                <div>
                  <p className="font-semibold text-white">
                    {item.quantity}x {item.name}
                  </p>
                  <p className="text-xs text-[#9E9E9E]">Sabor / Variação: {item.variation}</p>
                </div>
                <span className="font-bold text-white tabular-nums">
                  {formatBRL(item.price * item.quantity)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2 pt-2 border-t border-white/10 text-sm">
          <div className="flex justify-between text-[#9E9E9E]">
            <span>Subtotal</span>
            <span className="tabular-nums text-white">{formatBRL(order.subtotal)}</span>
          </div>
          {order.discountAmount > 0 && (
            <div className="flex justify-between text-emerald-400">
              <span>Desconto ({order.couponCode})</span>
              <span className="tabular-nums">-{formatBRL(order.discountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between text-[#9E9E9E]">
            <span>Frete</span>
            <span className="tabular-nums text-white">{order.shippingLabel}</span>
          </div>
          <div className="flex justify-between text-base font-extrabold text-white pt-2 border-t border-white/10">
            <span>Total</span>
            <span className="tabular-nums">{formatBRL(order.total)}</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            type="button"
            onClick={onViewOrders}
            className="flex-1 h-11 rounded-xl border border-white/25 text-white font-bold text-sm inline-flex items-center justify-center gap-2 hover:bg-white hover:text-black transition-colors"
          >
            <ClipboardList className="w-4 h-4" />
            Meus Pedidos
          </button>
          <button
            type="button"
            onClick={onBackToStore}
            className="flex-1 h-11 rounded-xl bg-white text-black font-bold text-sm inline-flex items-center justify-center gap-2 hover:bg-neutral-200 transition-colors"
          >
            <ShoppingBag className="w-4 h-4" />
            Voltar à Loja
          </button>
        </div>
      </div>
    </div>
  );
}
