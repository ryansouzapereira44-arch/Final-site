import { useEffect, useState, type FormEvent } from 'react';
import {
  ClipboardList,
  Edit3,
  Gift,
  Layers,
  Lock,
  Package,
  Plus,
  RefreshCw,
  Settings,
  Store,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { api, type AdminRouletteResponse } from '../lib/api';
import { formatBRL, formatCepInput, formatDateTimeBR } from '../lib/format';
import type {
  CarouselSlide,
  Coupon,
  Order,
  OrderStatus,
  Product,
  RoulettePrize,
  ShippingMode,
  StoreSettings,
} from '../types';
import { SafeProductImage } from './BrandMark';

interface AdminPanelProps {
  token: string | null;
  onStoreDataChanged: () => void;
}

type AdminTab = 'orders' | 'products' | 'coupons' | 'carousel' | 'roulette' | 'settings';

const ORDER_STATUSES: OrderStatus[] = [
  'Pendente',
  'Confirmado',
  'Em preparo',
  'Saiu para entrega',
  'Pronto para retirada',
  'Concluído',
  'Cancelado',
];

const PRESET_IMAGES = [
  { label: 'Narguilé Black', url: '/src/assets/images/product_hookah_black_1795779511252.jpg' },
  { label: 'Essência Blend', url: '/src/assets/images/product_tobacco_essence_1795779511616.jpg' },
  { label: 'Carvão Coco', url: '/src/assets/images/product_coconut_charcoal_1795779511363.jpg' },
  { label: 'Rosh Cerâmico', url: '/src/assets/images/product_ceramic_rosh_1795779511909.jpg' },
  { label: 'Pod System', url: '/src/assets/images/product_pod_device_1795779511951.jpg' },
];

export function AdminPanel({ token, onStoreDataChanged }: AdminPanelProps) {
  const [tab, setTab] = useState<AdminTab>('orders');
  const [loading, setLoading] = useState(true);
  const [togglingStore, setTogglingStore] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [slides, setSlides] = useState<CarouselSlide[]>([]);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [adminRoulette, setAdminRoulette] = useState<AdminRouletteResponse | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>('Todos');

  const [editingProduct, setEditingProduct] = useState<{
    id?: number;
    name: string;
    category: string;
    description: string;
    price: string;
    imageUrl: string;
    variationsText: string;
    active: boolean;
  } | null>(null);

  const [editingCoupon, setEditingCoupon] = useState<{
    id?: number;
    code: string;
    discountType: 'percent' | 'fixed' | 'free_shipping';
    discountValue: string;
    minOrderValue: string;
    active: boolean;
  } | null>(null);

  const [editingSlide, setEditingSlide] = useState<{
    id?: number;
    tag: string;
    title: string;
    subtitle: string;
    ctaText: string;
    targetCategory: string;
    imageUrl: string;
    sortOrder: string;
    active: boolean;
  } | null>(null);

  const [editingPrize, setEditingPrize] = useState<{
    id: number;
    prizeType: RoulettePrize['prizeType'];
    label: string;
    shortLabel: string;
    discountValue: string;
    weight: string;
    active: boolean;
  } | null>(null);

  async function loadOverview() {
    setLoading(true);
    setError('');
    try {
      const [data, rouletteData] = await Promise.all([
        api.getAdminOverview(token),
        api.getAdminRoulette(token),
      ]);
      setOrders(data.orders);
      setProducts(data.products);
      setCoupons(data.coupons);
      setSlides(data.slides);
      setSettings(data.settings);
      setAdminRoulette(rouletteData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar painel administrativo.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOverview();
  }, [token]);

  function showNotice(msg: string) {
    setFeedback(msg);
    window.setTimeout(() => setFeedback(''), 3500);
  }

  async function handleToggleStoreOpen() {
    if (!settings) return;
    setTogglingStore(true);
    setError('');
    try {
      const nextOpen = !settings.storeOpen;
      const res = await api.toggleStoreStatus(token, nextOpen, settings.closedMessage);
      setSettings(res.settings);
      onStoreDataChanged();
      showNotice(nextOpen ? 'Loja aberta para pedidos!' : 'Loja fechada no momento.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao alterar status da loja.');
    } finally {
      setTogglingStore(false);
    }
  }

  async function handleOrderStatusChange(orderId: number, status: OrderStatus) {
    try {
      const res = await api.updateOrderStatus(token, orderId, status);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? res.order : o)));
      if (res.chancesGranted && res.chancesGranted > 0) {
        showNotice(
          `Pedido #${res.order.orderNumber} confirmado! +${res.chancesGranted} chance(s) liberada(s) na roleta do cliente.`
        );
        void api
          .getAdminRoulette(token)
          .then(setAdminRoulette)
          .catch(() => {});
      } else {
        showNotice(`Pedido #${res.order.orderNumber} atualizado para "${status}".`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar status.');
    }
  }

  async function handleSaveProduct(e: FormEvent) {
    e.preventDefault();
    if (!editingProduct) return;
    setError('');
    try {
      const price = Number(editingProduct.price.replace(',', '.'));
      const variations = editingProduct.variationsText
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      await api.saveProduct(token, {
        id: editingProduct.id,
        name: editingProduct.name,
        category: editingProduct.category,
        description: editingProduct.description,
        price,
        imageUrl: editingProduct.imageUrl,
        variations,
        active: editingProduct.active,
      });
      setEditingProduct(null);
      await loadOverview();
      onStoreDataChanged();
      showNotice('Produto salvo com sucesso.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar produto.');
    }
  }

  async function handleDeleteProduct(id: number) {
    try {
      await api.deleteProduct(token, id);
      await loadOverview();
      onStoreDataChanged();
      showNotice('Produto removido.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover produto.');
    }
  }

  async function handleSaveCoupon(e: FormEvent) {
    e.preventDefault();
    if (!editingCoupon) return;
    setError('');
    try {
      await api.saveCoupon(token, {
        id: editingCoupon.id,
        code: editingCoupon.code.trim().toUpperCase(),
        discountType: editingCoupon.discountType,
        discountValue: Number(editingCoupon.discountValue.replace(',', '.')),
        minOrderValue: Number((editingCoupon.minOrderValue || '0').replace(',', '.')),
        active: editingCoupon.active,
      });
      setEditingCoupon(null);
      await loadOverview();
      showNotice('Cupom salvo com sucesso.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar cupom.');
    }
  }

  async function handleDeleteCoupon(id: number) {
    try {
      await api.deleteCoupon(token, id);
      await loadOverview();
      showNotice('Cupom removido.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover cupom.');
    }
  }

  async function handleSaveSlide(e: FormEvent) {
    e.preventDefault();
    if (!editingSlide) return;
    setError('');
    try {
      await api.saveSlide(token, {
        id: editingSlide.id,
        tag: editingSlide.tag,
        title: editingSlide.title,
        subtitle: editingSlide.subtitle,
        ctaText: editingSlide.ctaText,
        targetCategory: editingSlide.targetCategory,
        imageUrl: editingSlide.imageUrl,
        sortOrder: Number(editingSlide.sortOrder || 1),
        active: editingSlide.active,
      });
      setEditingSlide(null);
      await loadOverview();
      onStoreDataChanged();
      showNotice('Slide do carrossel salvo com sucesso.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar slide.');
    }
  }

  async function handleDeleteSlide(id: number) {
    try {
      await api.deleteSlide(token, id);
      await loadOverview();
      onStoreDataChanged();
      showNotice('Slide removido.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover slide.');
    }
  }

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setError('');
    try {
      const res = await api.saveSettings(token, settings);
      setSettings(res.settings);
      onStoreDataChanged();
      showNotice('Configurações da loja atualizadas.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar configurações.');
    }
  }

  async function handleSavePrize(e: FormEvent) {
    e.preventDefault();
    if (!editingPrize) return;
    setError('');
    try {
      await api.updateAdminRoulettePrize(token, editingPrize.id, {
        label: editingPrize.label.trim(),
        shortLabel: editingPrize.shortLabel.trim(),
        discountValue: Number((editingPrize.discountValue || '0').replace(',', '.')),
        weight: Math.max(0, Math.round(Number(editingPrize.weight || '0'))),
        active: editingPrize.active,
      });
      setEditingPrize(null);
      const rouletteData = await api.getAdminRoulette(token);
      setAdminRoulette(rouletteData);
      showNotice('Prêmio da roleta atualizado com sucesso.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar prêmio da roleta.');
    }
  }

  const filteredOrders =
    statusFilter === 'Todos' ? orders : orders.filter((o) => o.status === statusFilter);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Painel Administrativo</h1>
          <p className="text-sm text-[#9E9E9E] mt-1">
            Gerencie pedidos, produtos, cupons de desconto, carrossel e funcionamento da loja.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadOverview()}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-white/15 text-xs font-semibold text-white hover:bg-white hover:text-black transition-colors self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Atualizar
        </button>
      </div>

      {/* Store Open / Close Switch */}
      {settings && (
        <div
          className={`rounded-2xl border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
            settings.storeOpen
              ? 'border-emerald-500/35 bg-emerald-950/20'
              : 'border-red-500/40 bg-red-950/25'
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                settings.storeOpen ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
              }`}
            >
              {settings.storeOpen ? <Store className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
            </div>
            <div>
              <p className="text-sm sm:text-base font-extrabold text-white">
                {settings.storeOpen ? 'Loja Aberta para Pedidos' : 'Loja Fechada no Momento'}
              </p>
              <p className="text-xs text-[#E5E5E5] mt-0.5">
                {settings.storeOpen
                  ? 'Os clientes podem adicionar itens e finalizar pedidos normalmente.'
                  : settings.closedMessage}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleToggleStoreOpen()}
            disabled={togglingStore}
            className={`h-11 px-5 rounded-xl font-bold text-xs sm:text-sm whitespace-nowrap shrink-0 transition-colors disabled:opacity-50 ${
              settings.storeOpen
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-emerald-500 text-black hover:bg-emerald-400'
            }`}
          >
            {togglingStore
              ? 'Atualizando...'
              : settings.storeOpen
                ? 'Fechar Loja'
                : 'Abrir Loja'}
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {[
          { id: 'orders', label: `Pedidos (${orders.length})`, icon: ClipboardList },
          { id: 'products', label: `Produtos (${products.length})`, icon: Package },
          { id: 'coupons', label: `Cupons (${coupons.length})`, icon: Tag },
          { id: 'carousel', label: `Carrossel (${slides.length})`, icon: Layers },
          { id: 'roulette', label: 'Roleta', icon: Gift },
          { id: 'settings', label: 'Configurações', icon: Settings },
        ].map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as AdminTab)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap shrink-0 transition-colors border ${
                active
                  ? 'bg-white text-black border-white'
                  : 'bg-[#0C0C0C] text-[#9E9E9E] border-white/12 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </div>

      {feedback && (
        <div className="p-3.5 rounded-2xl bg-emerald-950/60 border border-emerald-500/40 text-sm text-emerald-200">
          {feedback}
        </div>
      )}

      {error && (
        <div role="alert" className="p-3.5 rounded-2xl bg-red-950/60 border border-red-500/40 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-3xl border border-white/10 bg-[#0C0C0C] p-12 text-center text-sm text-[#9E9E9E]">
          Carregando dados administrativos...
        </div>
      ) : (
        <>
          {/* ORDERS TAB */}
          {tab === 'orders' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {['Todos', ...ORDER_STATUSES].map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 border ${
                      statusFilter === st
                        ? 'bg-white text-black border-white'
                        : 'bg-[#0C0C0C] text-[#9E9E9E] border-white/10 hover:text-white'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>

              {filteredOrders.length === 0 ? (
                <div className="rounded-3xl border border-white/10 bg-[#0C0C0C] p-12 text-center text-sm text-[#9E9E9E]">
                  Nenhum pedido encontrado neste status.
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredOrders.map((order) => (
                    <div
                      key={order.id}
                      className="rounded-2xl border border-white/12 bg-[#0C0C0C] p-5 sm:p-6 space-y-4"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
                        <div>
                          <h3 className="text-lg font-extrabold text-white tabular-nums">
                            Pedido #{order.orderNumber}
                          </h3>
                          <p className="text-xs text-[#9E9E9E] mt-0.5">
                            {formatDateTimeBR(order.createdAt)} · {order.deliveryMethod} · {order.paymentMethod}
                            {order.changeFor ? ` (Troco p/ ${order.changeFor})` : ''}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <label className="text-xs text-[#9E9E9E]" htmlFor={`status-${order.id}`}>
                            Status:
                          </label>
                          <select
                            id={`status-${order.id}`}
                            value={order.status}
                            onChange={(e) => handleOrderStatusChange(order.id, e.target.value as OrderStatus)}
                            className="h-9 px-3 rounded-xl bg-black border border-white/20 text-xs font-bold text-white focus:outline-none focus:border-white"
                          >
                            {ORDER_STATUSES.map((st) => (
                              <option key={st} value={st}>
                                {st}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div className="space-y-1">
                          <p className="text-xs text-[#9E9E9E]">Cliente</p>
                          <p className="font-bold text-white">{order.customerName}</p>
                          <p className="text-xs text-[#E5E5E5] tabular-nums">
                            WhatsApp: {order.customerWhatsapp}
                            {order.customerCpf ? ` · CPF: ${order.customerCpf}` : ''}
                          </p>
                        </div>

                        {order.address ? (
                          <div className="space-y-1">
                            <p className="text-xs text-[#9E9E9E]">Endereço de entrega</p>
                            <p className="text-sm text-white">
                              {order.address.street}, {order.address.number} — {order.address.neighborhood}
                            </p>
                            <p className="text-xs text-[#9E9E9E] tabular-nums">
                              CEP {order.address.cep}
                              {order.address.complement ? ` · ${order.address.complement}` : ''}
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <p className="text-xs text-[#9E9E9E]">Recebimento</p>
                            <p className="text-sm font-semibold text-white">Retirada na loja</p>
                          </div>
                        )}
                      </div>

                      <div className="rounded-xl bg-black border border-white/10 p-3.5 space-y-1.5 text-sm">
                        {order.items.map((item, idx) => (
                          <div key={`${item.productId}-${idx}`} className="flex justify-between gap-4">
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

                      {order.notes && (
                        <p className="text-xs text-[#9E9E9E]">
                          Obs: <span className="text-white">{order.notes}</span>
                        </p>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/10 text-xs sm:text-sm">
                        <div className="text-[#9E9E9E] space-x-3">
                          <span>
                            Subtotal: <strong className="text-white tabular-nums">{formatBRL(order.subtotal)}</strong>
                          </span>
                          {order.discountAmount > 0 && (
                            <span className="text-emerald-400">
                              Desconto ({order.couponCode}): -{formatBRL(order.discountAmount)}
                            </span>
                          )}
                          <span>
                            Frete: <strong className="text-white">{order.shippingLabel}</strong>
                          </span>
                        </div>
                        <span className="text-base font-extrabold text-white tabular-nums">
                          Total: {formatBRL(order.total)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* PRODUCTS TAB */}
          {tab === 'products' && (
            <div className="space-y-5">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-bold text-white">Produtos Cadastrados</h2>
                <button
                  type="button"
                  onClick={() =>
                    setEditingProduct({
                      name: '',
                      category: 'Essências',
                      description: '',
                      price: '',
                      imageUrl: PRESET_IMAGES[1].url,
                      variationsText: '',
                      active: true,
                    })
                  }
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-white text-black font-bold text-xs sm:text-sm hover:bg-neutral-200 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Adicionar Produto
                </button>
              </div>

              {editingProduct && (
                <form
                  onSubmit={handleSaveProduct}
                  className="rounded-3xl border border-white/20 bg-[#111111] p-5 sm:p-6 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-extrabold text-white">
                      {editingProduct.id ? 'Editar Produto' : 'Novo Produto'}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setEditingProduct(null)}
                      className="p-1.5 rounded-lg text-[#9E9E9E] hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Nome do produto *</label>
                      <input
                        type="text"
                        required
                        value={editingProduct.name}
                        onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Preço (R$) *</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={editingProduct.price}
                        onChange={(e) => setEditingProduct({ ...editingProduct, price: e.target.value })}
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Categoria *</label>
                      <input
                        type="text"
                        required
                        value={editingProduct.category}
                        onChange={(e) => setEditingProduct({ ...editingProduct, category: e.target.value })}
                        placeholder="Ex: Essências, Narguilés..."
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                        Sabores / Variações (separados por vírgula)
                      </label>
                      <input
                        type="text"
                        value={editingProduct.variationsText}
                        onChange={(e) =>
                          setEditingProduct({ ...editingProduct, variationsText: e.target.value })
                        }
                        placeholder="Ex: Menta, Melancia, Love 66"
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Descrição</label>
                      <textarea
                        rows={2}
                        value={editingProduct.description}
                        onChange={(e) => setEditingProduct({ ...editingProduct, description: e.target.value })}
                        className="w-full p-3.5 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white resize-none"
                      />
                    </div>
                    <div className="sm:col-span-3 space-y-2">
                      <label className="block text-xs font-semibold text-[#E5E5E5]">URL da Imagem</label>
                      <input
                        type="text"
                        value={editingProduct.imageUrl}
                        onChange={(e) => setEditingProduct({ ...editingProduct, imageUrl: e.target.value })}
                        placeholder="https://... ou escolha um modelo abaixo"
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                      />
                      <div className="flex flex-wrap gap-2">
                        {PRESET_IMAGES.map((img) => (
                          <button
                            key={img.url}
                            type="button"
                            onClick={() => setEditingProduct({ ...editingProduct, imageUrl: img.url })}
                            className="px-2.5 py-1 rounded-lg bg-black border border-white/15 text-xs text-[#E5E5E5] hover:border-white"
                          >
                            {img.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <label className="inline-flex items-center gap-2 text-sm text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingProduct.active}
                      onChange={(e) => setEditingProduct({ ...editingProduct, active: e.target.checked })}
                      className="w-4 h-4 accent-white"
                    />
                    Produto visível no catálogo
                  </label>

                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setEditingProduct(null)}
                      className="h-10 px-4 rounded-xl border border-white/15 text-sm font-semibold text-[#9E9E9E] hover:text-white"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="h-10 px-6 rounded-xl bg-white text-black text-sm font-bold hover:bg-neutral-200"
                    >
                      Salvar Produto
                    </button>
                  </div>
                </form>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {products.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-4 p-4 rounded-2xl border border-white/12 bg-[#0C0C0C]"
                  >
                    <div className="w-20 h-20 rounded-xl overflow-hidden bg-[#141414] shrink-0">
                      <SafeProductImage src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[#9E9E9E]">
                        {p.category} · {p.active ? 'Ativo' : 'Oculto'}
                      </p>
                      <h3 className="text-sm font-bold text-white truncate">{p.name}</h3>
                      <p className="text-sm font-extrabold text-white tabular-nums mt-0.5">
                        {formatBRL(p.price)}
                      </p>
                      {p.variations.length > 0 && (
                        <p className="text-xs text-[#9E9E9E] truncate mt-0.5">
                          Variações: {p.variations.join(', ')}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setEditingProduct({
                            id: p.id,
                            name: p.name,
                            category: p.category,
                            description: p.description,
                            price: String(p.price),
                            imageUrl: p.imageUrl,
                            variationsText: p.variations.join(', '),
                            active: p.active,
                          })
                        }
                        aria-label={`Editar ${p.name}`}
                        className="w-9 h-9 flex items-center justify-center rounded-xl border border-white/15 text-white hover:bg-white hover:text-black transition-colors"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteProduct(p.id)}
                        aria-label={`Excluir ${p.name}`}
                        className="w-9 h-9 flex items-center justify-center rounded-xl border border-white/15 text-[#9E9E9E] hover:text-red-400 hover:border-red-500/40 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* COUPONS TAB */}
          {tab === 'coupons' && (
            <div className="space-y-5">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-bold text-white">Cupons de Desconto</h2>
                <button
                  type="button"
                  onClick={() =>
                    setEditingCoupon({
                      code: '',
                      discountType: 'percent',
                      discountValue: '10',
                      minOrderValue: '0',
                      active: true,
                    })
                  }
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-white text-black font-bold text-xs sm:text-sm hover:bg-neutral-200 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Adicionar Cupom
                </button>
              </div>

              {editingCoupon && (
                <form
                  onSubmit={handleSaveCoupon}
                  className="rounded-3xl border border-white/20 bg-[#111111] p-5 sm:p-6 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-extrabold text-white">
                      {editingCoupon.id ? 'Editar Cupom' : 'Novo Cupom'}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setEditingCoupon(null)}
                      className="p-1.5 rounded-lg text-[#9E9E9E] hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Código *</label>
                      <input
                        type="text"
                        required
                        value={editingCoupon.code}
                        onChange={(e) =>
                          setEditingCoupon({ ...editingCoupon, code: e.target.value.toUpperCase() })
                        }
                        placeholder="Ex: RP15"
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white uppercase focus:outline-none focus:border-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Tipo *</label>
                      <select
                        value={editingCoupon.discountType}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditingCoupon({
                            ...editingCoupon,
                            discountType:
                              val === 'fixed'
                                ? 'fixed'
                                : val === 'free_shipping'
                                  ? 'free_shipping'
                                  : 'percent',
                            discountValue: val === 'free_shipping' ? '0' : editingCoupon.discountValue || '10',
                          });
                        }}
                        className="w-full h-11 px-3 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                      >
                        <option value="percent">Porcentagem (%)</option>
                        <option value="fixed">Valor fixo (R$)</option>
                        <option value="free_shipping">Frete Grátis</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                        {editingCoupon.discountType === 'free_shipping'
                          ? 'Valor (Frete Grátis)'
                          : `Valor (${editingCoupon.discountType === 'percent' ? '%' : 'R$'}) *`}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min={editingCoupon.discountType === 'free_shipping' ? '0' : '0.01'}
                        required={editingCoupon.discountType !== 'free_shipping'}
                        disabled={editingCoupon.discountType === 'free_shipping'}
                        value={editingCoupon.discountType === 'free_shipping' ? '0' : editingCoupon.discountValue}
                        onChange={(e) => setEditingCoupon({ ...editingCoupon, discountValue: e.target.value })}
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white disabled:opacity-50"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Pedido mínimo (R$)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editingCoupon.minOrderValue}
                        onChange={(e) => setEditingCoupon({ ...editingCoupon, minOrderValue: e.target.value })}
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                      />
                    </div>
                  </div>

                  <label className="inline-flex items-center gap-2 text-sm text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingCoupon.active}
                      onChange={(e) => setEditingCoupon({ ...editingCoupon, active: e.target.checked })}
                      className="w-4 h-4 accent-white"
                    />
                    Cupom ativo
                  </label>

                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setEditingCoupon(null)}
                      className="h-10 px-4 rounded-xl border border-white/15 text-sm font-semibold text-[#9E9E9E] hover:text-white"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="h-10 px-6 rounded-xl bg-white text-black text-sm font-bold hover:bg-neutral-200"
                    >
                      Salvar Cupom
                    </button>
                  </div>
                </form>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {coupons.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-4 p-4 rounded-2xl border border-white/12 bg-[#0C0C0C]"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-extrabold text-white">{c.code}</span>
                        <span className="text-xs text-[#9E9E9E]">
                          · {c.active ? 'Ativo' : 'Inativo'}
                          {c.ownerUserId ? ` · Roleta (Cliente #${c.ownerUserId})` : ''}
                        </span>
                      </div>
                      <p className="text-sm text-[#E5E5E5] mt-1 tabular-nums">
                        {c.freeShipping || c.discountType === 'free_shipping'
                          ? 'Frete Grátis'
                          : c.discountType === 'percent'
                            ? `${c.discountValue}% de desconto`
                            : `${formatBRL(c.discountValue)} de desconto`}
                        {c.minOrderValue > 0 ? ` · Mínimo ${formatBRL(c.minOrderValue)}` : ''}
                      </p>
                      <p className="text-xs text-[#9E9E9E] mt-0.5 tabular-nums">
                        Usos: {c.usageCount}
                        {c.maxUses !== null ? ` / ${c.maxUses}` : ''}
                        {c.expiresAt ? ` · Expira em ${formatDateTimeBR(c.expiresAt)}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setEditingCoupon({
                            id: c.id,
                            code: c.code,
                            discountType: c.discountType,
                            discountValue: String(c.discountValue),
                            minOrderValue: String(c.minOrderValue),
                            active: c.active,
                          })
                        }
                        aria-label={`Editar cupom ${c.code}`}
                        className="w-9 h-9 flex items-center justify-center rounded-xl border border-white/15 text-white hover:bg-white hover:text-black transition-colors"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteCoupon(c.id)}
                        aria-label={`Excluir cupom ${c.code}`}
                        className="w-9 h-9 flex items-center justify-center rounded-xl border border-white/15 text-[#9E9E9E] hover:text-red-400 hover:border-red-500/40 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CAROUSEL TAB */}
          {tab === 'carousel' && (
            <div className="space-y-5">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-bold text-white">Carrossel da Página Inicial</h2>
                  <p className="text-xs text-[#9E9E9E]">
                    Por padrão os slides são exibidos sem foto, com foco na tipografia R&amp;P.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setEditingSlide({
                      tag: 'DESTAQUE R&P',
                      title: '',
                      subtitle: '',
                      ctaText: 'Ver catálogo',
                      targetCategory: 'Todos',
                      imageUrl: '',
                      sortOrder: String(slides.length + 1),
                      active: true,
                    })
                  }
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-white text-black font-bold text-xs sm:text-sm hover:bg-neutral-200 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Novo Slide
                </button>
              </div>

              {editingSlide && (
                <form
                  onSubmit={handleSaveSlide}
                  className="rounded-3xl border border-white/20 bg-[#111111] p-5 sm:p-6 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-extrabold text-white">
                      {editingSlide.id ? 'Editar Slide' : 'Novo Slide'}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setEditingSlide(null)}
                      className="p-1.5 rounded-lg text-[#9E9E9E] hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Tag / Subtítulo superior</label>
                      <input
                        type="text"
                        value={editingSlide.tag}
                        onChange={(e) => setEditingSlide({ ...editingSlide, tag: e.target.value })}
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Ordem de exibição</label>
                      <input
                        type="number"
                        min="1"
                        value={editingSlide.sortOrder}
                        onChange={(e) => setEditingSlide({ ...editingSlide, sortOrder: e.target.value })}
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Título principal *</label>
                      <input
                        type="text"
                        required
                        value={editingSlide.title}
                        onChange={(e) => setEditingSlide({ ...editingSlide, title: e.target.value })}
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Descrição / Subtítulo</label>
                      <textarea
                        rows={2}
                        value={editingSlide.subtitle}
                        onChange={(e) => setEditingSlide({ ...editingSlide, subtitle: e.target.value })}
                        className="w-full p-3.5 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white resize-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Texto do botão</label>
                      <input
                        type="text"
                        value={editingSlide.ctaText}
                        onChange={(e) => setEditingSlide({ ...editingSlide, ctaText: e.target.value })}
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Categoria ao clicar</label>
                      <input
                        type="text"
                        value={editingSlide.targetCategory}
                        onChange={(e) => setEditingSlide({ ...editingSlide, targetCategory: e.target.value })}
                        placeholder="Todos, Essências, Narguilés..."
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                        URL da foto (opcional — deixe em branco para manter sem foto)
                      </label>
                      <input
                        type="text"
                        value={editingSlide.imageUrl}
                        onChange={(e) => setEditingSlide({ ...editingSlide, imageUrl: e.target.value })}
                        placeholder="Vazio (sem foto)"
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                      />
                    </div>
                  </div>

                  <label className="inline-flex items-center gap-2 text-sm text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingSlide.active}
                      onChange={(e) => setEditingSlide({ ...editingSlide, active: e.target.checked })}
                      className="w-4 h-4 accent-white"
                    />
                    Slide ativo no carrossel
                  </label>

                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setEditingSlide(null)}
                      className="h-10 px-4 rounded-xl border border-white/15 text-sm font-semibold text-[#9E9E9E] hover:text-white"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="h-10 px-6 rounded-xl bg-white text-black text-sm font-bold hover:bg-neutral-200"
                    >
                      Salvar Slide
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-3">
                {slides.map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl border border-white/12 bg-[#0C0C0C]"
                  >
                    <div className="space-y-1">
                      <p className="text-xs text-[#9E9E9E]">
                        Ordem {s.sortOrder} · {s.active ? 'Ativo' : 'Oculto'} · Botão: {s.ctaText} ({s.targetCategory})
                      </p>
                      <h3 className="text-base font-bold text-white">{s.title}</h3>
                      {s.subtitle && <p className="text-xs text-[#9E9E9E]">{s.subtitle}</p>}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setEditingSlide({
                            id: s.id,
                            tag: s.tag,
                            title: s.title,
                            subtitle: s.subtitle,
                            ctaText: s.ctaText,
                            targetCategory: s.targetCategory,
                            imageUrl: s.imageUrl,
                            sortOrder: String(s.sortOrder),
                            active: s.active,
                          })
                        }
                        aria-label={`Editar slide ${s.title}`}
                        className="w-9 h-9 flex items-center justify-center rounded-xl border border-white/15 text-white hover:bg-white hover:text-black transition-colors"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteSlide(s.id)}
                        aria-label={`Excluir slide ${s.title}`}
                        className="w-9 h-9 flex items-center justify-center rounded-xl border border-white/15 text-[#9E9E9E] hover:text-red-400 hover:border-red-500/40 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ROULETTE TAB */}
          {tab === 'roulette' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-extrabold text-white">Gerenciamento da Roleta de Prêmios</h2>
                <p className="text-xs text-[#9E9E9E] mt-0.5">
                  Chances liberadas automaticamente ao confirmar pedidos (1 chance a cada R$ 50,00 em produtos,
                  válida por 7 dias). Probabilidades e sorteio controlados exclusivamente no servidor.
                </p>
              </div>

              {adminRoulette && (
                <>
                  <div className="grid grid-cols-3 gap-3 sm:gap-4">
                    <div className="rounded-2xl border border-white/15 bg-[#0C0C0C] p-4 sm:p-5">
                      <p className="text-xs text-[#9E9E9E]">Chances Disponíveis</p>
                      <p className="text-2xl sm:text-3xl font-extrabold text-white mt-1 tabular-nums">
                        {adminRoulette.totals.available}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/12 bg-[#0C0C0C] p-4 sm:p-5">
                      <p className="text-xs text-[#9E9E9E]">Chances Utilizadas</p>
                      <p className="text-2xl sm:text-3xl font-extrabold text-white mt-1 tabular-nums">
                        {adminRoulette.totals.used}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/12 bg-[#0C0C0C] p-4 sm:p-5">
                      <p className="text-xs text-[#9E9E9E]">Chances Expiradas</p>
                      <p className="text-2xl sm:text-3xl font-extrabold text-[#9E9E9E] mt-1 tabular-nums">
                        {adminRoulette.totals.expired}
                      </p>
                    </div>
                  </div>

                  {editingPrize && (
                    <form
                      onSubmit={handleSavePrize}
                      className="rounded-3xl border border-white/20 bg-[#111111] p-5 sm:p-6 space-y-4"
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="text-base font-extrabold text-white">Editar Prêmio da Roleta</h3>
                        <button
                          type="button"
                          onClick={() => setEditingPrize(null)}
                          className="p-1.5 rounded-lg text-[#9E9E9E] hover:text-white"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                            Descrição do prêmio *
                          </label>
                          <input
                            type="text"
                            required
                            value={editingPrize.label}
                            onChange={(e) => setEditingPrize({ ...editingPrize, label: e.target.value })}
                            className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                            Texto na roleta *
                          </label>
                          <input
                            type="text"
                            required
                            value={editingPrize.shortLabel}
                            onChange={(e) => setEditingPrize({ ...editingPrize, shortLabel: e.target.value })}
                            className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                            Peso / Chance (número) *
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            required
                            value={editingPrize.weight}
                            onChange={(e) => setEditingPrize({ ...editingPrize, weight: e.target.value })}
                            className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                          />
                        </div>

                        {editingPrize.prizeType === 'percent' && (
                          <div>
                            <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                              Desconto (%) *
                            </label>
                            <input
                              type="number"
                              min="1"
                              max="100"
                              step="1"
                              required
                              value={editingPrize.discountValue}
                              onChange={(e) => setEditingPrize({ ...editingPrize, discountValue: e.target.value })}
                              className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                            />
                          </div>
                        )}
                      </div>

                      <label className="inline-flex items-center gap-2 text-sm text-white cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editingPrize.active}
                          onChange={(e) => setEditingPrize({ ...editingPrize, active: e.target.checked })}
                          className="w-4 h-4 accent-white"
                        />
                        Prêmio ativo na roleta
                      </label>

                      <div className="flex justify-end gap-3 pt-2">
                        <button
                          type="button"
                          onClick={() => setEditingPrize(null)}
                          className="h-10 px-4 rounded-xl border border-white/15 text-sm font-semibold text-[#9E9E9E] hover:text-white"
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          className="h-10 px-6 rounded-xl bg-white text-black text-sm font-bold hover:bg-neutral-200"
                        >
                          Salvar Prêmio
                        </button>
                      </div>
                    </form>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-5 space-y-3">
                      <h3 className="text-base font-extrabold text-white">Prêmios e Probabilidades</h3>
                      {(() => {
                        const totalWeight = adminRoulette.prizes
                          .filter((p) => p.active)
                          .reduce((acc, p) => acc + Math.max(0, p.weight), 0);
                        return (
                          <div className="space-y-2.5">
                            {adminRoulette.prizes.map((prize) => {
                              const pct =
                                prize.active && totalWeight > 0
                                  ? ((prize.weight / totalWeight) * 100).toFixed(1)
                                  : '0.0';
                              return (
                                <div
                                  key={prize.id}
                                  className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-black border border-white/10"
                                >
                                  <div>
                                    <p className="text-sm font-bold text-white">
                                      {prize.label}{' '}
                                      <span className="text-xs font-normal text-[#9E9E9E]">
                                        ({prize.shortLabel})
                                      </span>
                                    </p>
                                    <p className="text-xs text-[#9E9E9E] mt-0.5 tabular-nums">
                                      Peso: {prize.weight} · Chance real: {pct}% ·{' '}
                                      {prize.active ? 'Ativo' : 'Desativado'}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditingPrize({
                                        id: prize.id,
                                        prizeType: prize.prizeType,
                                        label: prize.label,
                                        shortLabel: prize.shortLabel,
                                        discountValue: String(prize.discountValue),
                                        weight: String(prize.weight),
                                        active: prize.active,
                                      })
                                    }
                                    aria-label={`Editar prêmio ${prize.label}`}
                                    className="w-9 h-9 flex items-center justify-center rounded-xl border border-white/15 text-white hover:bg-white hover:text-black transition-colors shrink-0"
                                  >
                                    <Edit3 className="w-4 h-4" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>

                    <div className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-5 space-y-3">
                      <h3 className="text-base font-extrabold text-white">Histórico Global de Giros</h3>
                      {adminRoulette.spins.length === 0 ? (
                        <p className="text-xs text-[#9E9E9E]">Nenhum giro registrado ainda.</p>
                      ) : (
                        <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                          {adminRoulette.spins.map((spin) => (
                            <div
                              key={spin.id}
                              className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-black border border-white/10 text-xs sm:text-sm"
                            >
                              <div>
                                <p className="font-bold text-white">
                                  {spin.userName} · {spin.prizeLabel}
                                </p>
                                <p className="text-xs text-[#9E9E9E] mt-0.5 tabular-nums">
                                  {formatDateTimeBR(spin.createdAt)}
                                  {spin.couponExpiresAt
                                    ? ` · Expira ${formatDateTimeBR(spin.couponExpiresAt)}`
                                    : ''}
                                </p>
                              </div>
                              {spin.couponCode ? (
                                <span className="px-2.5 py-1 rounded-lg bg-white text-black font-bold text-xs shrink-0">
                                  {spin.couponCode}
                                </span>
                              ) : (
                                <span className="text-xs text-[#9E9E9E] shrink-0">Sem cupom</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* SETTINGS TAB */}
          {tab === 'settings' && settings && (
            <form
              onSubmit={handleSaveSettings}
              className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-6 space-y-5 max-w-3xl"
            >
              <h2 className="text-lg font-extrabold text-white">Regras de Entrega, Frete e Informações da Loja</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Nome da Loja</label>
                  <input
                    type="text"
                    value={settings.storeName}
                    onChange={(e) => setSettings({ ...settings, storeName: e.target.value })}
                    className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Regra do Frete</label>
                  <select
                    value={settings.shippingMode}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        shippingMode: e.target.value as ShippingMode,
                      })
                    }
                    className="w-full h-11 px-3 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                  >
                    <option value="per_km">Automático por km (R$/km + km grátis)</option>
                    <option value="fixed">Valor fixo definido</option>
                    <option value="to_confirm">A confirmar</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                    CEP de origem da loja (p/ cálculo por km)
                  </label>
                  <input
                    type="text"
                    value={settings.storeCep}
                    onChange={(e) => setSettings({ ...settings, storeCep: formatCepInput(e.target.value) })}
                    placeholder="00000-000"
                    className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                  />
                </div>

                {settings.shippingMode === 'per_km' && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Valor por km (R$)</label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={settings.shippingPerKm}
                        onChange={(e) =>
                          setSettings({ ...settings, shippingPerKm: Number(e.target.value || 0) })
                        }
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                        Frete grátis até quantos km?
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={settings.freeShippingKm}
                        onChange={(e) =>
                          setSettings({ ...settings, freeShippingKm: Number(e.target.value || 0) })
                        }
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                      />
                    </div>
                  </>
                )}

                {settings.shippingMode === 'fixed' && (
                  <div>
                    <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Valor do frete fixo (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={settings.shippingFee ?? ''}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          shippingFee: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                    Frete grátis acima de (R$ — opcional)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={settings.freeShippingThreshold ?? ''}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        freeShippingThreshold: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    placeholder="Deixe vazio para não aplicar"
                    className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">WhatsApp da Loja</label>
                  <input
                    type="text"
                    value={settings.storeWhatsapp}
                    onChange={(e) => setSettings({ ...settings, storeWhatsapp: e.target.value })}
                    className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                    Mensagem quando a loja estiver fechada
                  </label>
                  <input
                    type="text"
                    value={settings.closedMessage}
                    onChange={(e) => setSettings({ ...settings, closedMessage: e.target.value })}
                    className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                    Endereço da loja (exibido na Retirada na loja)
                  </label>
                  <input
                    type="text"
                    value={settings.storeAddress}
                    onChange={(e) => setSettings({ ...settings, storeAddress: e.target.value })}
                    className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Horário de funcionamento</label>
                  <input
                    type="text"
                    value={settings.storeHours}
                    onChange={(e) => setSettings({ ...settings, storeHours: e.target.value })}
                    className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Instruções para retirada</label>
                  <textarea
                    rows={2}
                    value={settings.pickupInstructions}
                    onChange={(e) => setSettings({ ...settings, pickupInstructions: e.target.value })}
                    className="w-full p-3.5 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white resize-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="h-11 px-6 rounded-xl bg-white text-black font-bold text-sm hover:bg-neutral-200 transition-colors"
              >
                Salvar Configurações
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
