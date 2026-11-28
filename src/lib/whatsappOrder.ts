import { formatBRL } from './format';
import type { CartItem, Order } from '../types';

export function formatCartItemVariationLine(item: CartItem): string {
  const details = item.variationDetails;
  if (details && (details.primaryValue || details.secondaryValue)) {
    const parts: string[] = [];
    if (details.primaryValue) {
      parts.push(
        details.primaryLabel ? `${details.primaryLabel}: ${details.primaryValue}` : details.primaryValue
      );
    }
    if (details.secondaryValue) {
      parts.push(
        details.secondaryLabel
          ? `${details.secondaryLabel}: ${details.secondaryValue}`
          : details.secondaryValue
      );
    }
    return parts.join(' · ');
  }
  return item.variation || 'Padrão';
}

export function buildWhatsAppOrderMessage(order: Order): string {
  const lines: string[] = [
    'NOVO PEDIDO — TABACARIA RP',
    `Pedido #${order.orderNumber}`,
    '',
    `Cliente: ${order.customerName}`,
    `WhatsApp: ${order.customerWhatsapp}`,
    `Recebimento: ${order.deliveryMethod}`,
  ];

  if (order.deliveryMethod === 'Entrega' && order.address) {
    lines.push(
      `Endereço: ${order.address.street}, ${order.address.number} — ${order.address.neighborhood} (CEP ${order.address.cep})${
        order.address.complement ? ` · ${order.address.complement}` : ''
      }`
    );
  }

  lines.push('', 'Itens:');
  for (const item of order.items) {
    const variationText =
      item.variation && item.variation !== 'Padrão' ? ` — ${item.variation}` : '';
    lines.push(
      `- ${item.quantity}x ${item.name}${variationText} (${formatBRL(item.price * item.quantity)})`
    );
  }

  lines.push('', `Subtotal: ${formatBRL(order.subtotal)}`);
  if (order.discountAmount > 0) {
    lines.push(
      `Desconto${order.couponCode ? ` (${order.couponCode})` : ''}: -${formatBRL(order.discountAmount)}`
    );
  }
  lines.push(`Frete: ${order.shippingLabel}`);
  lines.push(`Total: ${formatBRL(order.total)}`);
  lines.push(
    `Pagamento: ${order.paymentMethod}${order.changeFor ? ` (Troco para ${order.changeFor})` : ''}`
  );

  if (order.notes) {
    lines.push(`Observações: ${order.notes}`);
  }

  return lines.join('\n');
}

export function buildWhatsAppOrderUrl(storeWhatsapp: string, order: Order): string {
  const message = buildWhatsAppOrderMessage(order);
  const rawDigits = (storeWhatsapp || '').replace(/\D/g, '');
  let targetDigits = rawDigits;
  if (rawDigits.length === 10 || rawDigits.length === 11) {
    targetDigits = `55${rawDigits}`;
  }
  const encodedText = encodeURIComponent(message);
  if (targetDigits.length >= 12) {
    return `https://wa.me/${targetDigits}?text=${encodedText}`;
  }
  return `https://wa.me/?text=${encodedText}`;
}
