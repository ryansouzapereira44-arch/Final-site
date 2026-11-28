import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Bike,
  ClipboardList,
  Edit3,
  Gift,
  ImagePlus,
  Layers,
  Lock,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  Settings,
  Store,
  Tag,
  Trash2,
  TrendingUp,
  UserPlus,
  X,
} from 'lucide-react';
import { api, type AdminRouletteResponse } from '../lib/api';
import { formatBRL, formatCepInput, formatDateTimeBR, formatWhatsappInput } from '../lib/format';
import { compressImageFileToDataUrl } from '../lib/imageUpload';
import { computeProductProfitMetrics } from '../lib/profitMath';
import { isTrackingAvailableForOrder } from '../lib/tracking';
import { ProfitManagerModule } from './profit/ProfitManagerModule';
import type {
  CarouselSlide,
  CourierSummary,
  Coupon,
  CustomerSummary,
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
  liveSyncTrigger?: number;
  onStoreDataChanged: () => void;
  onOpenTracking: (orderId: number) => void;
}

type AdminTab =
  | 'orders'
  | 'couriers'
  | 'products'
  | 'profit'
  | 'coupons'
  | 'carousel'
  | 'roulette'
  | 'settings';

const ORDER_STATUSES: OrderStatus[] = [
  'Pendente',
  'Confirmado',
  'Em preparo',
  'Saiu para entrega',
  'Entregue',
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

export function AdminPanel({
  token,
  liveSyncTrigger = 0,
  onStoreDataChanged,
  onOpenTracking,
}: AdminPanelProps) {
  const [tab, setTab] = useState<AdminTab>('orders');
  const [loading, setLoading] = useState(true);
  const [togglingStore, setTogglingStore] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const [orders, setOrders] = useState<Order[]>([]);
  const [couriers, setCouriers] = useState<CourierSummary[]>([]);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [slides, setSlides] = useState<CarouselSlide[]>([]);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [adminRoulette, setAdminRoulette] = useState<AdminRouletteResponse | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>('Todos');
  const [newCourier, setNewCourier] = useState({
    name: '',
    email: '',
    whatsapp: '',
    password: '',
  });
  const [savingCourier, setSavingCourier] = useState(false);
  const [editingCourier, setEditingCourier] = useState<{
    id: number;
    name: string;
    email: string;
    whatsapp: string;
    password: string;
    active: boolean;
  } | null>(null);
  const [savingEditCourier, setSavingEditCourier] = useState(false);
  const [confirmDeleteCourierId, setConfirmDeleteCourierId] = useState<number | null>(null);
  const [deletingCourierId, setDeletingCourierId] = useState<number | null>(null);

  const [editingProduct, setEditingProduct] = useState<{
    id?: number;
    sku: string;
    name: string;
    category: string;
    description: string;
    price: string;
    costPrice: string;
    freightCostUnit: string;
    packagingCostUnit: string;
    otherCostUnit: string;
    purchasedQuantity: string;
    stockQuantity: string;
    imageUrl: string;
    variationLabel: string;
    variationsText: string;
    secondaryVariationLabel: string;
    secondaryVariationsText: string;
    active: boolean;
  } | null>(null);
  const [confirmDeleteProductId, setConfirmDeleteProductId] = useState<number | null>(null);
  const [uploadingProductImage, setUploadingProductImage] = useState(false);
  const productFileInputRef = useRef<HTMLInputElement | null>(null);

  const [editingCoupon, setEditingCoupon] = useState<{
    id?: number;
    code: string;
    discountType: 'percent' | 'fixed' | 'free_shipping';
    discountValue: string;
    minOrderValue: string;
    audience: 'all' | 'specific';
    allowedEmail: string;
    allowMultipleUses: boolean;
    active: boolean;
  } | null>(null);
  const [confirmDeleteCouponId, setConfirmDeleteCouponId] = useState<number | null>(null);

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
  const [confirmDeleteSlideId, setConfirmDeleteSlideId] = useState<number | null>(null);
  const [uploadingSlideImage, setUploadingSlideImage] = useState(false);
  const slideFileInputRef = useRef<HTMLInputElement | null>(null);

  const [editingPrize, setEditingPrize] = useState<{
    id: number;
    prizeType: RoulettePrize['prizeType'];
    label: string;
    shortLabel: string;
    discountValue: string;
    weight: string;
    active: boolean;
  } | null>(null);

  async function loadOverview(silent = false) {
    if (!silent) setLoading(true);
    setError('');
    try {
      const [data, rouletteData] = await Promise.all([
        api.getAdminOverview(token),
        api.getAdminRoulette(token),
      ]);
      setOrders(data.orders);
      setCouriers(data.couriers || []);
      setCustomers(data.customers || []);
      setProducts(data.products);
      setCoupons(data.coupons);
      setSlides(data.slides);
      setSettings(data.settings);
      setAdminRoulette(rouletteData);
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Erro ao carregar painel administrativo.');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void loadOverview(false);
  }, [token]);

  useEffect(() => {
    if (liveSyncTrigger > 0) {
      void loadOverview(true);
    }
  }, [liveSyncTrigger]);

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

  async function handleAssignCourier(orderId: number, courierIdValue: string) {
    setError('');
    try {
      const courierId = courierIdValue ? Number(courierIdValue) : null;
      const res = await api.assignOrderCourier(token, orderId, courierId);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? res.order : o)));
      showNotice(
        res.order.assignedCourierName
          ? `Motoboy ${res.order.assignedCourierName} atribuído ao Pedido #${res.order.orderNumber}.`
          : `Motoboy removido do Pedido #${res.order.orderNumber}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atribuir motoboy.');
    }
  }

  async function handleCreateCourier(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSavingCourier(true);
    try {
      const res = await api.createAdminCourier(token, {
        name: newCourier.name.trim(),
        email: newCourier.email.trim(),
        whatsapp: newCourier.whatsapp.trim(),
        password: newCourier.password,
      });
      setCouriers((prev) => [res.courier, ...prev]);
      setNewCourier({ name: '', email: '', whatsapp: '', password: '' });
      showNotice(`Motoboy ${res.courier.name} cadastrado com sucesso.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cadastrar motoboy.');
    } finally {
      setSavingCourier(false);
    }
  }

  async function handleToggleCourierActive(courier: CourierSummary) {
    setError('');
    try {
      const res = await api.toggleCourierActive(token, courier.id, !courier.active);
      setCouriers((prev) => prev.map((c) => (c.id === courier.id ? res.courier : c)));
      showNotice(
        res.courier.active
          ? `Entregador ${res.courier.name} reativado.`
          : `Entregador ${res.courier.name} desativado.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar entregador.');
    }
  }

  async function handleUpdateCourier(e: FormEvent) {
    e.preventDefault();
    if (!editingCourier) return;
    setError('');
    setSavingEditCourier(true);
    try {
      const res = await api.updateAdminCourier(token, editingCourier.id, {
        name: editingCourier.name.trim(),
        email: editingCourier.email.trim(),
        whatsapp: editingCourier.whatsapp.trim(),
        active: editingCourier.active,
        password: editingCourier.password.trim() || undefined,
      });
      setCouriers((prev) => prev.map((c) => (c.id === res.courier.id ? res.courier : c)));
      setEditingCourier(null);
      await loadOverview(true);
      showNotice(`Entregador ${res.courier.name} salvo no banco de dados.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar entregador.');
    } finally {
      setSavingEditCourier(false);
    }
  }

  async function handleDeleteCourier(courier: CourierSummary) {
    setError('');
    setDeletingCourierId(courier.id);
    try {
      await api.deleteAdminCourier(token, courier.id);
      setCouriers((prev) => prev.filter((c) => c.id !== courier.id));
      setConfirmDeleteCourierId(null);
      if (editingCourier?.id === courier.id) {
        setEditingCourier(null);
      }
      await loadOverview(true);
      showNotice(`Entregador ${courier.name} excluído permanentemente.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir entregador.');
    } finally {
      setDeletingCourierId(null);
    }
  }

  async function handleProductFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editingProduct) return;
    setError('');
    setUploadingProductImage(true);
    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      const res = await api.uploadAdminImage(token, dataUrl);
      setEditingProduct((prev) => (prev ? { ...prev, imageUrl: res.imageUrl } : prev));
      showNotice('Foto do celular carregada no produto. Clique em "Salvar Produto" para publicar.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar foto do produto.');
    } finally {
      setUploadingProductImage(false);
    }
  }

  async function handleSaveProduct(e: FormEvent) {
    e.preventDefault();
    if (!editingProduct) return;
    setError('');
    try {
      const price = Number(editingProduct.price.replace(',', '.'));
      const costPrice = Math.max(0, Number((editingProduct.costPrice || '0').replace(',', '.')) || 0);
      const freightCostUnit = Math.max(
        0,
        Number((editingProduct.freightCostUnit || '0').replace(',', '.')) || 0
      );
      const packagingCostUnit = Math.max(
        0,
        Number((editingProduct.packagingCostUnit || '0').replace(',', '.')) || 0
      );
      const otherCostUnit = Math.max(
        0,
        Number((editingProduct.otherCostUnit || '0').replace(',', '.')) || 0
      );
      const purchasedQuantity = Math.max(
        0,
        Math.round(Number(editingProduct.purchasedQuantity || '0') || 0)
      );
      const stockQuantity = Math.max(0, Math.round(Number(editingProduct.stockQuantity || '0') || 0));
      const variations = editingProduct.variationsText
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      const secondaryVariations = editingProduct.secondaryVariationsText
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      await api.saveProduct(token, {
        id: editingProduct.id,
        sku: editingProduct.sku.trim().toUpperCase(),
        name: editingProduct.name,
        category: editingProduct.category,
        description: editingProduct.description,
        price,
        costPrice,
        freightCostUnit,
        packagingCostUnit,
        otherCostUnit,
        purchasedQuantity,
        stockQuantity,
        imageUrl: editingProduct.imageUrl,
        variationLabel: editingProduct.variationLabel.trim() || 'Sabor / Variação',
        variations,
        secondaryVariationLabel: editingProduct.secondaryVariationLabel.trim(),
        secondaryVariations,
        active: editingProduct.active,
      });
      setEditingProduct(null);
      await loadOverview();
      onStoreDataChanged();
      showNotice('Produto salvo no banco! Ele só sai quando você clicar em Excluir.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar produto.');
    }
  }

  async function handleDeleteProduct(id: number) {
    try {
      await api.deleteProduct(token, id);
      setConfirmDeleteProductId(null);
      await loadOverview();
      onStoreDataChanged();
      showNotice('Produto excluído permanentemente.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover produto.');
    }
  }

  async function handleSaveCoupon(e: FormEvent) {
    e.preventDefault();
    if (!editingCoupon) return;
    setError('');
    const normalizedAllowedEmail =
      editingCoupon.audience === 'specific' ? editingCoupon.allowedEmail.trim().toLowerCase() : null;
    if (editingCoupon.audience === 'specific' && !normalizedAllowedEmail) {
      setError('Informe o e-mail do usuário autorizado a usar este cupom.');
      return;
    }
    try {
      await api.saveCoupon(token, {
        id: editingCoupon.id,
        code: editingCoupon.code.trim().toUpperCase(),
        discountType: editingCoupon.discountType,
        discountValue: Number(editingCoupon.discountValue.replace(',', '.')),
        minOrderValue: Number((editingCoupon.minOrderValue || '0').replace(',', '.')),
        allowedEmail: normalizedAllowedEmail,
        allowMultipleUses: editingCoupon.allowMultipleUses,
        active: editingCoupon.active,
      });
      setEditingCoupon(null);
      await loadOverview();
      showNotice('Cupom salvo com sucesso. Permanece salvo até você excluir.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar cupom.');
    }
  }

  async function handleDeleteCoupon(id: number) {
    try {
      await api.deleteCoupon(token, id);
      setConfirmDeleteCouponId(null);
      await loadOverview();
      showNotice('Cupom excluído permanentemente.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover cupom.');
    }
  }

  async function handleSlideFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editingSlide) return;
    setError('');
    setUploadingSlideImage(true);
    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      const res = await api.uploadAdminImage(token, dataUrl);
      setEditingSlide((prev) => (prev ? { ...prev, imageUrl: res.imageUrl } : prev));
      showNotice('Foto do celular carregada no slide. Clique em "Salvar Slide" para publicar.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar foto do slide.');
    } finally {
      setUploadingSlideImage(false);
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
      setConfirmDeleteSlideId(null);
      await loadOverview();
      onStoreDataChanged();
      showNotice('Slide excluído permanentemente.');
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
          { id: 'couriers', label: `Motoboys (${couriers.length})`, icon: Bike },
          { id: 'products', label: `Produtos (${products.length})`, icon: Package },
          { id: 'profit', label: 'Rentabilidade', icon: TrendingUp },
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

                        <div className="flex flex-wrap items-center gap-2.5">
                          {order.deliveryMethod === 'Entrega' && (
                            <div className="flex items-center gap-1.5">
                              <label className="text-xs text-[#9E9E9E]" htmlFor={`courier-${order.id}`}>
                                Motoboy:
                              </label>
                              <select
                                id={`courier-${order.id}`}
                                value={order.assignedCourierId ?? ''}
                                onChange={(e) => void handleAssignCourier(order.id, e.target.value)}
                                className="h-9 px-3 rounded-xl bg-black border border-white/20 text-xs font-semibold text-white focus:outline-none focus:border-white"
                              >
                                <option value="">Sem motoboy</option>
                                {couriers
                                  .filter((c) => c.active || c.id === order.assignedCourierId)
                                  .map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}
                                    </option>
                                  ))}
                              </select>
                            </div>
                          )}

                          <div className="flex items-center gap-1.5">
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

                          {isTrackingAvailableForOrder(order) && (
                            <button
                              type="button"
                              onClick={() => onOpenTracking(order.id)}
                              className="h-9 px-3 rounded-xl bg-white text-black text-xs font-extrabold inline-flex items-center gap-1.5 hover:bg-neutral-200 transition-colors"
                            >
                              <MapPin className="w-3.5 h-3.5" />
                              Ver Mapa
                            </button>
                          )}
                        </div>
                      </div>

                      {order.deliveryMethod === 'Entrega' && isTrackingAvailableForOrder(order) && (
                        <div className="rounded-xl bg-black border border-white/15 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="text-[#E5E5E5]">
                            Rastreamento ativo ·{' '}
                            <strong className="text-white">
                              {order.courierGpsStatus === 'active'
                                ? 'GPS em tempo real'
                                : order.courierGpsStatus === 'unavailable'
                                  ? 'GPS do motoboy indisponível'
                                  : 'Aguardando motoboy ativar GPS'}
                            </strong>
                          </span>
                          {order.assignedCourierName && (
                            <span className="text-[#9E9E9E]">Entregador: {order.assignedCourierName}</span>
                          )}
                        </div>
                      )}

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

          {/* COURIERS (MOTOBOYS) TAB */}
          {tab === 'couriers' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-extrabold text-white">Equipe de Motoboys</h2>
                <p className="text-xs text-[#9E9E9E] mt-0.5">
                  Cadastre os motoboys para que eles façam login, compartilhem a localização GPS e concluam entregas
                  atribuídas.
                </p>
              </div>

              <form
                onSubmit={handleCreateCourier}
                className="rounded-3xl border border-white/15 bg-[#0C0C0C] p-5 sm:p-6 space-y-4"
              >
                <div className="flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-white" />
                  <h3 className="text-base font-extrabold text-white">Cadastrar Novo Motoboy</h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                  <div>
                    <label htmlFor="courier-name" className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                      Nome completo *
                    </label>
                    <input
                      id="courier-name"
                      type="text"
                      required
                      value={newCourier.name}
                      onChange={(e) => setNewCourier({ ...newCourier, name: e.target.value })}
                      placeholder="Ex: Lucas Entregas"
                      className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="courier-email" className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                      E-mail de acesso *
                    </label>
                    <input
                      id="courier-email"
                      type="email"
                      required
                      value={newCourier.email}
                      onChange={(e) => setNewCourier({ ...newCourier, email: e.target.value })}
                      placeholder="motoboy@rptabacaria.com"
                      className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="courier-whatsapp" className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                      WhatsApp
                    </label>
                    <input
                      id="courier-whatsapp"
                      type="tel"
                      value={newCourier.whatsapp}
                      onChange={(e) =>
                        setNewCourier({ ...newCourier, whatsapp: formatWhatsappInput(e.target.value) })
                      }
                      placeholder="(11) 99999-9999"
                      className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="courier-password" className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                      Senha inicial (mín. 6) *
                    </label>
                    <input
                      id="courier-password"
                      type="password"
                      required
                      minLength={6}
                      value={newCourier.password}
                      onChange={(e) => setNewCourier({ ...newCourier, password: e.target.value })}
                      placeholder="******"
                      className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={savingCourier}
                  className="h-11 px-6 rounded-xl bg-white text-black font-extrabold text-xs sm:text-sm hover:bg-neutral-200 transition-colors disabled:opacity-50"
                >
                  {savingCourier ? 'Cadastrando...' : 'Cadastrar Motoboy'}
                </button>
              </form>

              {editingCourier && (
                <form
                  onSubmit={handleUpdateCourier}
                  className="rounded-3xl border border-white/25 bg-[#111111] p-5 sm:p-6 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-extrabold text-white">
                      Editar Entregador — {editingCourier.name}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setEditingCourier(null)}
                      className="p-1.5 rounded-lg text-[#9E9E9E] hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Nome completo *</label>
                      <input
                        type="text"
                        required
                        value={editingCourier.name}
                        onChange={(e) => setEditingCourier({ ...editingCourier, name: e.target.value })}
                        className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">E-mail de acesso *</label>
                      <input
                        type="email"
                        required
                        value={editingCourier.email}
                        onChange={(e) => setEditingCourier({ ...editingCourier, email: e.target.value })}
                        className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">WhatsApp</label>
                      <input
                        type="tel"
                        value={editingCourier.whatsapp}
                        onChange={(e) =>
                          setEditingCourier({ ...editingCourier, whatsapp: formatWhatsappInput(e.target.value) })
                        }
                        className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                        Nova senha (opcional)
                      </label>
                      <input
                        type="password"
                        minLength={6}
                        value={editingCourier.password}
                        onChange={(e) => setEditingCourier({ ...editingCourier, password: e.target.value })}
                        placeholder="Manter senha atual"
                        className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <label className="inline-flex items-center gap-2 text-sm text-white cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingCourier.active}
                        onChange={(e) => setEditingCourier({ ...editingCourier, active: e.target.checked })}
                        className="w-4 h-4 accent-white"
                      />
                      Entregador ativo para entregas
                    </label>
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => setEditingCourier(null)}
                        className="h-10 px-4 rounded-xl border border-white/15 text-xs sm:text-sm font-semibold text-[#9E9E9E] hover:text-white"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={savingEditCourier}
                        className="h-10 px-5 rounded-xl bg-white text-black text-xs sm:text-sm font-extrabold hover:bg-neutral-200 disabled:opacity-50"
                      >
                        {savingEditCourier ? 'Salvando...' : 'Salvar Entregador'}
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {couriers.length === 0 ? (
                <div className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-10 text-center text-sm text-[#9E9E9E]">
                  Nenhum motoboy cadastrado. Cadastre acima e ele ficará salvo até você excluir.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {couriers.map((courier) => (
                    <div
                      key={courier.id}
                      className="rounded-2xl border border-white/12 bg-[#0C0C0C] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-base font-bold text-white truncate">{courier.name}</p>
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              courier.active
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-red-500/20 text-red-300'
                            }`}
                          >
                            {courier.active ? 'Ativo' : 'Desativado'}
                          </span>
                        </div>
                        <p className="text-xs text-[#9E9E9E] truncate mt-0.5">{courier.email}</p>
                        {courier.whatsapp && (
                          <p className="text-xs text-[#E5E5E5] tabular-nums mt-0.5">{courier.whatsapp}</p>
                        )}
                      </div>

                      {confirmDeleteCourierId === courier.id ? (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={deletingCourierId === courier.id}
                            onClick={() => void handleDeleteCourier(courier)}
                            className="h-9 px-3 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-500 disabled:opacity-50"
                          >
                            {deletingCourierId === courier.id ? 'Excluindo...' : 'Confirmar'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteCourierId(null)}
                            className="h-9 px-3 rounded-xl border border-white/15 text-xs text-[#9E9E9E] hover:text-white"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => void handleToggleCourierActive(courier)}
                            className="h-9 px-3 rounded-xl border border-white/15 text-xs font-bold text-white hover:bg-white hover:text-black transition-colors"
                          >
                            {courier.active ? 'Desativar' : 'Reativar'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setEditingCourier({
                                id: courier.id,
                                name: courier.name,
                                email: courier.email,
                                whatsapp: courier.whatsapp || '',
                                password: '',
                                active: courier.active,
                              })
                            }
                            aria-label={`Editar entregador ${courier.name}`}
                            className="w-9 h-9 flex items-center justify-center rounded-xl border border-white/15 text-white hover:bg-white hover:text-black transition-colors"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteCourierId(courier.id)}
                            aria-label={`Excluir entregador ${courier.name}`}
                            className="w-9 h-9 flex items-center justify-center rounded-xl border border-white/15 text-[#9E9E9E] hover:text-red-400 hover:border-red-500/40 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* PRODUCTS TAB */}
          {tab === 'products' && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                <div>
                  <h2 className="text-lg font-bold text-white">Produtos Cadastrados</h2>
                  <p className="text-xs text-[#9E9E9E]">
                    Tudo que você salvar aqui fica gravado no banco e só sai quando você clicar em Excluir.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setEditingProduct({
                      sku: '',
                      name: '',
                      category: 'Essências',
                      description: '',
                      price: '',
                      costPrice: '0',
                      freightCostUnit: '0',
                      packagingCostUnit: '0',
                      otherCostUnit: '0',
                      purchasedQuantity: '0',
                      stockQuantity: '0',
                      imageUrl: PRESET_IMAGES[1].url,
                      variationLabel: 'Sabor / Variação',
                      variationsText: '',
                      secondaryVariationLabel: '',
                      secondaryVariationsText: '',
                      active: true,
                    })
                  }
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-white text-black font-bold text-xs sm:text-sm hover:bg-neutral-200 transition-colors self-start sm:self-auto shrink-0"
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
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">SKU (opcional)</label>
                      <input
                        type="text"
                        value={editingProduct.sku}
                        onChange={(e) => setEditingProduct({ ...editingProduct, sku: e.target.value })}
                        placeholder="Automático se vazio"
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white uppercase focus:outline-none focus:border-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                        Valor de compra / un. (R$)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editingProduct.costPrice}
                        onChange={(e) => setEditingProduct({ ...editingProduct, costPrice: e.target.value })}
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                        Preço de venda / un. (R$) *
                      </label>
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
                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                        Quantidade comprada (un.)
                      </label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={editingProduct.purchasedQuantity}
                        onChange={(e) =>
                          setEditingProduct({ ...editingProduct, purchasedQuantity: e.target.value })
                        }
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                        Estoque disponível (un.)
                      </label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={editingProduct.stockQuantity}
                        onChange={(e) =>
                          setEditingProduct({ ...editingProduct, stockQuantity: e.target.value })
                        }
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                        Frete de compra / un. (R$)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editingProduct.freightCostUnit}
                        onChange={(e) =>
                          setEditingProduct({ ...editingProduct, freightCostUnit: e.target.value })
                        }
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                        Embalagem / un. (R$)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editingProduct.packagingCostUnit}
                        onChange={(e) =>
                          setEditingProduct({ ...editingProduct, packagingCostUnit: e.target.value })
                        }
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                        Outros custos / un. (R$)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editingProduct.otherCostUnit}
                        onChange={(e) =>
                          setEditingProduct({ ...editingProduct, otherCostUnit: e.target.value })
                        }
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                        Título da 1ª seleção
                      </label>
                      <input
                        type="text"
                        value={editingProduct.variationLabel}
                        onChange={(e) =>
                          setEditingProduct({ ...editingProduct, variationLabel: e.target.value })
                        }
                        placeholder="Ex: Sabor"
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                        1ª Variação / Sabores (por vírgula)
                      </label>
                      <input
                        type="text"
                        value={editingProduct.variationsText}
                        onChange={(e) =>
                          setEditingProduct({ ...editingProduct, variationsText: e.target.value })
                        }
                        placeholder="Ex: Melancia, Tropical"
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                        Título da 2ª seleção (opcional)
                      </label>
                      <input
                        type="text"
                        value={editingProduct.secondaryVariationLabel}
                        onChange={(e) =>
                          setEditingProduct({ ...editingProduct, secondaryVariationLabel: e.target.value })
                        }
                        placeholder="Ex: Gelo"
                        className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                        2ª Variação / Sabores (por vírgula — opcional)
                      </label>
                      <input
                        type="text"
                        value={editingProduct.secondaryVariationsText}
                        onChange={(e) =>
                          setEditingProduct({ ...editingProduct, secondaryVariationsText: e.target.value })
                        }
                        placeholder="Ex: Gelo de coco, Gelo de melancia, Gelo de maracujá"
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
                    <div className="sm:col-span-3 space-y-3">
                      <label className="block text-xs font-semibold text-[#E5E5E5]">
                        Foto do produto (escolha do celular, cole uma URL ou selecione um modelo)
                      </label>

                      <input
                        ref={productFileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={(e) => void handleProductFileSelected(e)}
                        className="hidden"
                      />

                      <div className="flex flex-col sm:flex-row gap-2.5">
                        <button
                          type="button"
                          disabled={uploadingProductImage}
                          onClick={() => productFileInputRef.current?.click()}
                          className="inline-flex items-center justify-center gap-2 min-h-11 px-4 py-2.5 rounded-xl bg-white text-black font-bold text-xs sm:text-sm hover:bg-neutral-200 disabled:opacity-50 transition-colors shrink-0"
                        >
                          <ImagePlus className="w-4 h-4" />
                          {uploadingProductImage ? 'Enviando foto...' : 'Escolher foto do celular'}
                        </button>

                        <input
                          type="text"
                          value={editingProduct.imageUrl}
                          onChange={(e) => setEditingProduct({ ...editingProduct, imageUrl: e.target.value })}
                          placeholder="https://... ou escolha um modelo abaixo"
                          className="flex-1 h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                        />
                      </div>

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

                      {editingProduct.imageUrl && (
                        <div className="flex items-center justify-between gap-4 p-3 rounded-2xl border border-white/15 bg-black">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-16 h-16 rounded-xl overflow-hidden bg-[#141414] border border-white/10 shrink-0">
                              <SafeProductImage
                                src={editingProduct.imageUrl}
                                alt={editingProduct.name || 'Prévia do produto'}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-white">Prévia da foto do produto</p>
                              <p className="text-[11px] text-[#9E9E9E] truncate">{editingProduct.imageUrl}</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setEditingProduct({ ...editingProduct, imageUrl: '' })}
                            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#111111] border border-white/20 text-xs font-semibold text-white hover:bg-white hover:text-black transition-colors shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Remover foto
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {(() => {
                    const liveCalc = computeProductProfitMetrics({
                      price: Number((editingProduct.price || '0').replace(',', '.')) || 0,
                      costPrice: Number((editingProduct.costPrice || '0').replace(',', '.')) || 0,
                      freightCostUnit:
                        Number((editingProduct.freightCostUnit || '0').replace(',', '.')) || 0,
                      packagingCostUnit:
                        Number((editingProduct.packagingCostUnit || '0').replace(',', '.')) || 0,
                      otherCostUnit: Number((editingProduct.otherCostUnit || '0').replace(',', '.')) || 0,
                      purchasedQuantity: Math.max(0, Math.round(Number(editingProduct.purchasedQuantity || '0') || 0)),
                      stockQuantity: Math.max(0, Math.round(Number(editingProduct.stockQuantity || '0') || 0)),
                    });
                    return (
                      <div className="p-3.5 rounded-2xl border border-white/12 bg-black grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div>
                          <p className="text-[#9E9E9E]">Custo total / un.</p>
                          <p className="text-sm font-bold text-white tabular-nums mt-0.5">
                            {formatBRL(liveCalc.totalUnitCost)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[#9E9E9E]">Lucro bruto / un.</p>
                          <p
                            className={`text-sm font-extrabold tabular-nums mt-0.5 ${
                              liveCalc.profitPerUnit >= 0 ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          >
                            {formatBRL(liveCalc.profitPerUnit)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[#9E9E9E]">Margem · Markup</p>
                          <p className="text-sm font-bold text-white tabular-nums mt-0.5">
                            {liveCalc.marginPercent.toFixed(1).replace('.', ',')}% ·{' '}
                            {liveCalc.markupPercent.toFixed(1).replace('.', ',')}%
                          </p>
                        </div>
                        <div>
                          <p className="text-[#9E9E9E]">Lucro potencial estoque</p>
                          <p
                            className={`text-sm font-extrabold tabular-nums mt-0.5 ${
                              liveCalc.potentialProfit >= 0 ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          >
                            {formatBRL(liveCalc.potentialProfit)}
                          </p>
                        </div>
                      </div>
                    );
                  })()}

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
                      disabled={uploadingProductImage}
                      className="h-10 px-6 rounded-xl bg-white text-black text-sm font-bold hover:bg-neutral-200 disabled:opacity-50"
                    >
                      Salvar Produto
                    </button>
                  </div>
                </form>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {products.map((p) => {
                  const cardMetrics = computeProductProfitMetrics({
                    price: p.price,
                    costPrice: Number(p.costPrice || 0),
                    freightCostUnit: Number(p.freightCostUnit || 0),
                    packagingCostUnit: Number(p.packagingCostUnit || 0),
                    otherCostUnit: Number(p.otherCostUnit || 0),
                    purchasedQuantity: Number(p.purchasedQuantity || 0),
                    stockQuantity: Number(p.stockQuantity || 0),
                  });
                  return (
                    <div
                      key={p.id}
                      className="flex items-center gap-4 p-4 rounded-2xl border border-white/12 bg-[#0C0C0C]"
                    >
                      <div className="w-20 h-20 rounded-xl overflow-hidden bg-[#141414] shrink-0">
                        <SafeProductImage src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[#9E9E9E] truncate">
                          {p.sku || `RP-${String(p.id).padStart(4, '0')}`} · {p.category} ·{' '}
                          {p.active ? 'Ativo' : 'Oculto'}
                        </p>
                        <h3 className="text-sm font-bold text-white truncate">{p.name}</h3>
                        <p className="text-sm font-extrabold text-white tabular-nums mt-0.5">
                          {formatBRL(p.price)}
                          {cardMetrics.totalUnitCost > 0 && (
                            <span className="text-[11px] font-semibold text-[#9E9E9E] ml-2">
                              · Custo {formatBRL(cardMetrics.totalUnitCost)} · Lucro{' '}
                              <span
                                className={
                                  cardMetrics.profitPerUnit >= 0 ? 'text-emerald-400' : 'text-red-400'
                                }
                              >
                                {formatBRL(cardMetrics.profitPerUnit)}
                              </span>
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-[#9E9E9E] truncate mt-0.5 tabular-nums">
                          Estoque: {p.stockQuantity ?? 0} un.
                          {p.variations.length > 0 ? ` · ${p.variations.join(', ')}` : ''}
                          {p.secondaryVariations && p.secondaryVariations.length > 0
                            ? ` · ${p.secondaryVariationLabel || '2ª'}: ${p.secondaryVariations.join(', ')}`
                            : ''}
                        </p>
                      </div>
                      {confirmDeleteProductId === p.id ? (
                        <div className="flex flex-col gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => void handleDeleteProduct(p.id)}
                            className="h-8 px-2.5 rounded-lg bg-red-600 text-white text-[11px] font-bold hover:bg-red-500"
                          >
                            Confirmar
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteProductId(null)}
                            className="h-8 px-2.5 rounded-lg border border-white/15 text-[11px] text-[#9E9E9E] hover:text-white"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setEditingProduct({
                                id: p.id,
                                sku: p.sku || `RP-${String(p.id).padStart(4, '0')}`,
                                name: p.name,
                                category: p.category,
                                description: p.description,
                                price: String(p.price),
                                costPrice: String(p.costPrice ?? 0),
                                freightCostUnit: String(p.freightCostUnit ?? 0),
                                packagingCostUnit: String(p.packagingCostUnit ?? 0),
                                otherCostUnit: String(p.otherCostUnit ?? 0),
                                purchasedQuantity: String(p.purchasedQuantity ?? 0),
                                stockQuantity: String(p.stockQuantity ?? 0),
                                imageUrl: p.imageUrl,
                                variationLabel: p.variationLabel || 'Sabor / Variação',
                                variationsText: p.variations.join(', '),
                                secondaryVariationLabel: p.secondaryVariationLabel || '',
                                secondaryVariationsText: (p.secondaryVariations || []).join(', '),
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
                            onClick={() => setConfirmDeleteProductId(p.id)}
                            aria-label={`Excluir ${p.name}`}
                            className="w-9 h-9 flex items-center justify-center rounded-xl border border-white/15 text-[#9E9E9E] hover:text-red-400 hover:border-red-500/40 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                  </div>
                  );
                })}
              </div>
              {products.length === 0 && (
                <div className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-10 text-center text-sm text-[#9E9E9E]">
                  Nenhum produto cadastrado no momento. Clique em &ldquo;Adicionar Produto&rdquo; para cadastrar e salvar.
                </div>
              )}
            </div>
          )}

          {/* R&P PROFIT MANAGER TAB (RENTABILIDADE) */}
          {tab === 'profit' && (
            <ProfitManagerModule
              token={token}
              liveSyncTrigger={liveSyncTrigger}
              onProductsChanged={() => {
                void loadOverview(true);
                onStoreDataChanged();
              }}
            />
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
                      audience: 'all',
                      allowedEmail: '',
                      allowMultipleUses: true,
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

                  {/* Who can use & Reuse rules */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-white/10">
                    <div className="space-y-2.5">
                      <label className="block text-xs font-semibold text-[#E5E5E5]">
                        Quem pode usar este cupom?
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setEditingCoupon({ ...editingCoupon, audience: 'all', allowedEmail: '' })
                          }
                          className={`h-10 px-3 rounded-xl border text-xs font-bold transition-colors ${
                            editingCoupon.audience === 'all'
                              ? 'bg-white text-black border-white'
                              : 'bg-black text-[#9E9E9E] border-white/15 hover:text-white'
                          }`}
                        >
                          Todos os usuários
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingCoupon({ ...editingCoupon, audience: 'specific' })}
                          className={`h-10 px-3 rounded-xl border text-xs font-bold transition-colors ${
                            editingCoupon.audience === 'specific'
                              ? 'bg-white text-black border-white'
                              : 'bg-black text-[#9E9E9E] border-white/15 hover:text-white'
                          }`}
                        >
                          Usuário específico
                        </button>
                      </div>

                      {editingCoupon.audience === 'specific' && (
                        <div>
                          <label htmlFor="coupon-allowed-email" className="block text-[11px] text-[#9E9E9E] mb-1">
                            E-mail do usuário autorizado *
                          </label>
                          <input
                            id="coupon-allowed-email"
                            type="email"
                            required
                            list="coupon-customer-emails"
                            value={editingCoupon.allowedEmail}
                            onChange={(e) =>
                              setEditingCoupon({ ...editingCoupon, allowedEmail: e.target.value })
                            }
                            placeholder="Ex: ryansouzapereira44@gmail.com"
                            className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                          />
                          <datalist id="coupon-customer-emails">
                            {customers.map((customer) => (
                              <option key={customer.id} value={customer.email}>
                                {customer.name}
                              </option>
                            ))}
                          </datalist>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2.5">
                      <label className="block text-xs font-semibold text-[#E5E5E5]">
                        Pode usar mais de uma vez?
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingCoupon({ ...editingCoupon, allowMultipleUses: true })}
                          className={`h-10 px-3 rounded-xl border text-xs font-bold transition-colors ${
                            editingCoupon.allowMultipleUses
                              ? 'bg-white text-black border-white'
                              : 'bg-black text-[#9E9E9E] border-white/15 hover:text-white'
                          }`}
                        >
                          Sim (várias vezes)
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingCoupon({ ...editingCoupon, allowMultipleUses: false })}
                          className={`h-10 px-3 rounded-xl border text-xs font-bold transition-colors ${
                            !editingCoupon.allowMultipleUses
                              ? 'bg-white text-black border-white'
                              : 'bg-black text-[#9E9E9E] border-white/15 hover:text-white'
                          }`}
                        >
                          Não (apenas 1 vez)
                        </button>
                      </div>
                      <p className="text-[11px] text-[#9E9E9E]">
                        {editingCoupon.allowMultipleUses
                          ? editingCoupon.audience === 'specific'
                            ? 'O usuário escolhido poderá aplicar este cupom em vários pedidos.'
                            : 'Todos os clientes poderão reutilizar este cupom em múltiplos pedidos.'
                          : editingCoupon.audience === 'specific'
                            ? 'Somente este e-mail poderá usar o cupom, e apenas 1 vez.'
                            : 'Cada cliente cadastrado poderá usar este cupom apenas 1 vez.'}
                      </p>
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
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
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
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <span className="px-2 py-0.5 rounded-md bg-white/10 text-[11px] font-semibold text-white">
                          {c.allowedEmail
                            ? `Só: ${c.allowedEmail}`
                            : c.ownerUserId
                              ? `Cliente #${c.ownerUserId}`
                              : 'Todos os usuários'}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-white/10 text-[11px] font-semibold text-[#E5E5E5]">
                          {c.allowMultipleUses ? 'Múltiplos usos' : 'Uso único (1x por usuário)'}
                        </span>
                      </div>
                      <p className="text-xs text-[#9E9E9E] mt-1 tabular-nums">
                        Usos: {c.usageCount}
                        {c.maxUses !== null ? ` / ${c.maxUses}` : ''}
                        {c.expiresAt ? ` · Expira em ${formatDateTimeBR(c.expiresAt)}` : ''}
                      </p>
                    </div>

                    {confirmDeleteCouponId === c.id ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleDeleteCoupon(c.id)}
                          className="h-9 px-3 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-500"
                        >
                          Confirmar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteCouponId(null)}
                          className="h-9 px-2.5 rounded-xl border border-white/15 text-xs text-[#9E9E9E] hover:text-white"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
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
                              audience: c.allowedEmail ? 'specific' : 'all',
                              allowedEmail: c.allowedEmail || '',
                              allowMultipleUses: c.allowMultipleUses,
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
                          onClick={() => setConfirmDeleteCouponId(c.id)}
                          aria-label={`Excluir cupom ${c.code}`}
                          className="w-9 h-9 flex items-center justify-center rounded-xl border border-white/15 text-[#9E9E9E] hover:text-red-400 hover:border-red-500/40 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {coupons.length === 0 && (
                <div className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-10 text-center text-sm text-[#9E9E9E]">
                  Nenhum cupom cadastrado. Adicione um cupom para salvar permanentemente até excluir.
                </div>
              )}
            </div>
          )}

          {/* CAROUSEL TAB */}
          {tab === 'carousel' && (
            <div className="space-y-5">
              <div className="flex justify-between items-center gap-3">
                <div>
                  <h2 className="text-lg font-bold text-white">Carrossel da Página Inicial</h2>
                  <p className="text-xs text-[#9E9E9E]">
                    Personalize os destaques com texto ou escolha fotos direto da galeria do celular.
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
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-white text-black font-bold text-xs sm:text-sm hover:bg-neutral-200 transition-colors whitespace-nowrap shrink-0"
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
                    <div className="sm:col-span-2 space-y-3">
                      <label className="block text-xs font-semibold text-[#E5E5E5]">
                        Foto do slide (opcional — envie direto do celular ou informe uma URL)
                      </label>

                      <input
                        ref={slideFileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={(e) => void handleSlideFileSelected(e)}
                        className="hidden"
                      />

                      <div className="flex flex-col sm:flex-row gap-2.5">
                        <button
                          type="button"
                          disabled={uploadingSlideImage}
                          onClick={() => slideFileInputRef.current?.click()}
                          className="inline-flex items-center justify-center gap-2 min-h-11 px-4 py-2.5 rounded-xl bg-white text-black font-bold text-xs sm:text-sm hover:bg-neutral-200 disabled:opacity-50 transition-colors shrink-0"
                        >
                          <ImagePlus className="w-4 h-4" />
                          {uploadingSlideImage ? 'Enviando foto...' : 'Escolher foto do celular'}
                        </button>

                        <input
                          type="text"
                          value={editingSlide.imageUrl}
                          onChange={(e) => setEditingSlide({ ...editingSlide, imageUrl: e.target.value })}
                          placeholder="Ou cole o link da imagem (opcional)"
                          className="flex-1 h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                        />
                      </div>

                      {editingSlide.imageUrl && (
                        <div className="relative rounded-2xl overflow-hidden border border-white/15 bg-black">
                          <img
                            src={editingSlide.imageUrl}
                            alt="Pré-visualização do slide"
                            className="w-full h-36 sm:h-44 object-cover opacity-75"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end justify-between p-3">
                            <span className="text-[11px] font-semibold text-white/90">
                              Prévia da foto no carrossel
                            </span>
                            <button
                              type="button"
                              onClick={() => setEditingSlide({ ...editingSlide, imageUrl: '' })}
                              className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-black/80 border border-white/25 text-xs font-semibold text-white hover:bg-white hover:text-black transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Remover foto
                            </button>
                          </div>
                        </div>
                      )}
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
                    <div className="flex items-center gap-3.5 min-w-0">
                      {s.imageUrl && (
                        <img
                          src={s.imageUrl}
                          alt={s.title}
                          className="w-16 h-12 rounded-xl object-cover border border-white/15 shrink-0 bg-black"
                        />
                      )}
                      <div className="space-y-1 min-w-0">
                        <p className="text-xs text-[#9E9E9E]">
                          Ordem {s.sortOrder} · {s.active ? 'Ativo' : 'Oculto'} · Botão: {s.ctaText} ({s.targetCategory})
                        </p>
                        <h3 className="text-base font-bold text-white truncate">{s.title}</h3>
                        {s.subtitle && <p className="text-xs text-[#9E9E9E] truncate">{s.subtitle}</p>}
                      </div>
                    </div>

                    {confirmDeleteSlideId === s.id ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleDeleteSlide(s.id)}
                          className="h-9 px-3 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-500"
                        >
                          Confirmar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteSlideId(null)}
                          className="h-9 px-2.5 rounded-xl border border-white/15 text-xs text-[#9E9E9E] hover:text-white"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
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
                          onClick={() => setConfirmDeleteSlideId(s.id)}
                          aria-label={`Excluir slide ${s.title}`}
                          className="w-9 h-9 flex items-center justify-center rounded-xl border border-white/15 text-[#9E9E9E] hover:text-red-400 hover:border-red-500/40 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {slides.length === 0 && (
                  <div className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-10 text-center text-sm text-[#9E9E9E]">
                    Nenhum slide no carrossel. Clique em &ldquo;Novo Slide&rdquo; para adicionar e salvar.
                  </div>
                )}
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
