/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Gift, Lock, Star, X } from 'lucide-react';
import { AdminPanel } from './components/AdminPanel';
import { AuthGate } from './components/AuthGate';
import { BrandLogoSVG } from './components/BrandMark';
import { CartView } from './components/CartView';
import { CatalogSection } from './components/CatalogSection';
import { CheckoutView } from './components/CheckoutView';
import { CourierDeliveryView } from './components/CourierDeliveryView';
import { DeliveryTrackingView } from './components/DeliveryTrackingView';
import { EditorialCarousel } from './components/EditorialCarousel';
import { Header, type AppView } from './components/Header';
import { MyAccountView, type AccountSubTab } from './components/MyAccountView';
import { MyOrdersView } from './components/MyOrdersView';
import { OrderConfirmationModal } from './components/OrderConfirmationModal';
import { RzinAssistant } from './components/RzinAssistant';
import { SuggestionBoxSection } from './components/SuggestionBoxSection';
import { WelcomeCampaignModal } from './components/WelcomeCampaignModal';
import { api } from './lib/api';
import { getMaxQuantityForCartLine, getRemainingAddableForCard } from './lib/stock';
import type {
  CarouselSlide,
  CartItem,
  CheckoutDraft,
  Coupon,
  DeliveryTrackingInfo,
  Order,
  Product,
  RouletteStateResponse,
  StoreSettings,
  User,
} from './types';

const INITIAL_DRAFT: CheckoutDraft = {
  fullName: '',
  whatsapp: '',
  cpf: '',
  deliveryMethod: 'Entrega',
  address: {
    street: '',
    number: '',
    neighborhood: '',
    cep: '',
    complement: '',
  },
  coords: null,
  paymentMethod: '',
  changeFor: '',
  couponCode: '',
  notes: '',
};

export default function App() {
  const [authChecking, setAuthChecking] = useState(true);
  const [authStatus, setAuthStatus] = useState<{ adminClaimed: boolean; adminEmail: string }>({
    adminClaimed: true,
    adminEmail: 'rptabacaria3@gmail.com',
  });
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [pendingResetToken, setPendingResetToken] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const t = params.get('resetToken');
    if (t) {
      params.delete('resetToken');
      const nextSearch = params.toString();
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', nextUrl);
      return t;
    }
    return null;
  });

  const [activeView, setActiveView] = useState<AppView>('store');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>(['Todos']);
  const [selectedCategory, setSelectedCategory] = useState<string>('Todos');
  const [slides, setSlides] = useState<CarouselSlide[]>([]);
  const [settings, setSettings] = useState<StoreSettings>({
    storeName: 'R&P Tabacaria',
    storeOpen: true,
    closedMessage: 'Estamos fechados no momento. Voltamos em breve!',
    minDeliveryOrder: 0,
    shippingMode: 'per_km',
    shippingPerKm: 1.5,
    freeShippingKm: 1.5,
    shippingFee: null,
    freeShippingThreshold: null,
    storeCep: '01001-000',
    storeLat: -23.55052,
    storeLng: -46.633308,
    storeAddress: '',
    storeHours: '',
    storeWhatsapp: '',
    pickupInstructions: '',
  });
  const [storeLoading, setStoreLoading] = useState(false);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkoutDraft, setCheckoutDraft] = useState<CheckoutDraft>(INITIAL_DRAFT);
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  const [discountAmount, setDiscountAmount] = useState<number>(0);

  const [confirmedOrder, setConfirmedOrder] = useState<Order | null>(null);
  const [myOrders, setMyOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const [accountSubTab, setAccountSubTab] = useState<AccountSubTab>('profile');
  const [rouletteState, setRouletteState] = useState<RouletteStateResponse | null>(null);
  const [liveNotice, setLiveNotice] = useState<string>('');
  const [selectedTrackingOrderId, setSelectedTrackingOrderId] = useState<number | null>(null);
  const [trackingReturnView, setTrackingReturnView] = useState<'account' | 'orders' | 'admin'>('account');
  const [liveTrackingUpdate, setLiveTrackingUpdate] = useState<DeliveryTrackingInfo | null>(null);
  const [liveSyncCounter, setLiveSyncCounter] = useState(0);
  const [rzinOpen, setRzinOpen] = useState(false);
  const [welcomeModalOpen, setWelcomeModalOpen] = useState(false);
  const [sessionExpiredModalOpen, setSessionExpiredModalOpen] = useState(false);
  const [sessionReloginEmail, setSessionReloginEmail] = useState('');
  const [sessionReloginPassword, setSessionReloginPassword] = useState('');
  const [sessionReloginError, setSessionReloginError] = useState('');
  const [sessionReloginLoading, setSessionReloginLoading] = useState(false);
  const welcomeHandledUserIdRef = useRef<number | null>(null);

  const loadStoreData = useCallback(async (authToken: string | null) => {
    setStoreLoading(true);
    try {
      const data = await api.getStore(authToken);
      setProducts(data.products);
      setCategories(data.categories);
      setSlides(data.slides);
      setSettings(data.settings);
    } finally {
      setStoreLoading(false);
    }
  }, []);

  const loadMyOrders = useCallback(async (authToken: string | null) => {
    setOrdersLoading(true);
    try {
      const res = await api.getMyOrders(authToken);
      setMyOrders(res.orders);
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  const loadRouletteState = useCallback(async (authToken: string | null) => {
    try {
      const res = await api.getRoulette(authToken);
      setRouletteState(res);
    } catch {
      // ignore transient errors
    }
  }, []);

  const applyUserProfileToDraft = useCallback((targetUser: User, overwrite = false) => {
    setCheckoutDraft((prev) => ({
      ...prev,
      fullName: overwrite ? targetUser.name : prev.fullName || targetUser.name,
      whatsapp: overwrite ? targetUser.whatsapp : prev.whatsapp || targetUser.whatsapp,
      cpf: overwrite ? targetUser.cpf || '' : prev.cpf || targetUser.cpf || '',
      address: targetUser.savedAddress
        ? {
            street: overwrite
              ? targetUser.savedAddress.street
              : prev.address.street || targetUser.savedAddress.street,
            number: overwrite
              ? targetUser.savedAddress.number
              : prev.address.number || targetUser.savedAddress.number,
            neighborhood: overwrite
              ? targetUser.savedAddress.neighborhood
              : prev.address.neighborhood || targetUser.savedAddress.neighborhood,
            cep: overwrite
              ? targetUser.savedAddress.cep
              : prev.address.cep || targetUser.savedAddress.cep,
            complement: overwrite
              ? targetUser.savedAddress.complement
              : prev.address.complement || targetUser.savedAddress.complement,
          }
        : prev.address,
    }));
  }, []);

  // One-time cleanup of any legacy client storage keys (catalog, couriers, slides must only load from DB)
  useEffect(() => {
    try {
      const legacyKeys = [
        'rp_products',
        'products',
        'rp_couriers',
        'couriers',
        'delivery_drivers',
        'rp_carousel',
        'carousel_slides',
        'rp_slides',
        'rp_store_cache',
      ];
      for (const k of legacyKeys) {
        window.localStorage.removeItem(k);
        window.sessionStorage.removeItem(k);
      }
    } catch {
      // ignore storage access errors
    }
  }, []);

  // Wire global session refresh & in-place re-login modal callbacks (preserves open Admin forms)
  useEffect(() => {
    api.setSessionCallbacks({
      onTokenRefreshed: (refreshedUser, freshToken) => {
        setUser(refreshedUser);
        setToken(freshToken);
      },
      onUnauthorized: () => {
        if (user) {
          setSessionReloginEmail((prev) => prev || user.email);
          setSessionReloginError('');
          setSessionExpiredModalOpen(true);
        }
      },
    });
    return () => {
      api.setSessionCallbacks({});
    };
  }, [user]);

  // Automatic silent token refresh every 15 minutes and when returning to the tab
  useEffect(() => {
    if (!user) return;
    let active = true;
    const runRefresh = () => {
      void api
        .refreshSession(token)
        .then((res) => {
          if (!active) return;
          setUser(res.user);
          setToken(res.token);
        })
        .catch(() => {
          // 401 handler triggers in-place re-login modal automatically
        });
    };

    const intervalId = window.setInterval(runRefresh, 15 * 60 * 1000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        runRefresh();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user?.id, token]);

  // Auto-restore login session via HttpOnly cookie if already signed in once
  useEffect(() => {
    let active = true;
    async function restoreSession() {
      try {
        const statusRes = await api.getAuthStatus();
        if (!active) return;
        setAuthStatus({
          adminClaimed: statusRes.adminClaimed,
          adminEmail: statusRes.adminEmail,
        });
        if (statusRes.user) {
          const restoredUser = statusRes.user;
          setUser(restoredUser);
          applyUserProfileToDraft(restoredUser);
          if (restoredUser.role === 'courier') {
            setActiveView('courier');
          } else {
            void loadStoreData(null);
            void loadMyOrders(null);
          }
        }
      } catch {
        // ignore transient startup network error
      } finally {
        if (active) setAuthChecking(false);
      }
    }
    void restoreSession();
    return () => {
      active = false;
    };
  }, [loadStoreData, loadMyOrders, applyUserProfileToDraft]);

  // First-login welcome campaign modal (controlled via DB user.welcomeCampaignSeen)
  useEffect(() => {
    if (!user || user.role === 'courier') {
      setWelcomeModalOpen(false);
      return;
    }
    if (user.welcomeCampaignSeen === false && welcomeHandledUserIdRef.current !== user.id) {
      welcomeHandledUserIdRef.current = user.id;
      setWelcomeModalOpen(true);
      void api
        .markWelcomeSeen(token)
        .then((res) => {
          if (res.user) {
            setUser(res.user);
          } else {
            setUser((prev) => (prev ? { ...prev, welcomeCampaignSeen: true } : prev));
          }
        })
        .catch(() => {
          welcomeHandledUserIdRef.current = null;
        });
    }
  }, [user, token]);

  // Real-time SSE sync: updates ROLETA chances, order statuses & live delivery tracking
  useEffect(() => {
    if (!user) return;
    if (user.role !== 'courier') {
      void loadRouletteState(token);
    }

    const es = new EventSource('/api/events', { withCredentials: true });
    es.addEventListener('roulette_updated', (event) => {
      void loadRouletteState(token);
      try {
        const payload = JSON.parse((event as MessageEvent).data) as {
          grantedNow?: number;
          orderNumber?: number;
        };
        if (payload.grantedNow && payload.grantedNow > 0) {
          setLiveNotice(
            `Pedido #${payload.orderNumber} confirmado! +${payload.grantedNow} chance(s) liberada(s) na sua ROLETA.`
          );
        }
      } catch {
        // ignore parse error
      }
    });
    es.addEventListener('order_updated', () => {
      if (user.role !== 'courier') {
        void loadMyOrders(token);
      }
      setLiveSyncCounter((c) => c + 1);
    });
    es.addEventListener('tracking_updated', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as DeliveryTrackingInfo;
        setLiveTrackingUpdate(payload);
      } catch {
        // ignore parse error
      }
      if (user.role !== 'courier') {
        void loadMyOrders(token);
      }
      setLiveSyncCounter((c) => c + 1);
    });
    es.addEventListener('products_updated', () => {
      if (user.role !== 'courier') {
        void loadStoreData(token);
      }
      setLiveSyncCounter((c) => c + 1);
    });
    es.addEventListener('store_updated', () => {
      if (user.role !== 'courier') {
        void loadStoreData(token);
      }
      setLiveSyncCounter((c) => c + 1);
    });

    return () => {
      es.close();
    };
  }, [user, token, loadRouletteState, loadMyOrders, loadStoreData]);

  function handleAuthenticated(loggedUser: User, authToken: string) {
    setUser(loggedUser);
    setToken(authToken);
    setConfirmedOrder(null);
    setSelectedTrackingOrderId(null);
    setLiveTrackingUpdate(null);
    applyUserProfileToDraft(loggedUser, true);
    if (loggedUser.role === 'courier') {
      setActiveView('courier');
    } else {
      setActiveView('store');
      void loadStoreData(authToken);
      void loadRouletteState(authToken);
      void loadMyOrders(authToken);
    }
  }

  async function handleLogout() {
    await api.logout().catch(() => {});
    setUser(null);
    setToken(null);
    setCart([]);
    setAppliedCoupon(null);
    setDiscountAmount(0);
    setConfirmedOrder(null);
    setMyOrders([]);
    setRouletteState(null);
    setLiveNotice('');
    setSelectedTrackingOrderId(null);
    setLiveTrackingUpdate(null);
    setCheckoutDraft(INITIAL_DRAFT);
    setRzinOpen(false);
    setWelcomeModalOpen(false);
    welcomeHandledUserIdRef.current = null;
    setActiveView('store');
    api
      .getAuthStatus()
      .then((res) => setAuthStatus(res))
      .catch(() => {});
  }

  const cartSubtotal = useMemo(() => {
    return Math.round(cart.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100;
  }, [cart]);

  const cartCount = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }, [cart]);

  useEffect(() => {
    if (!appliedCoupon) {
      setDiscountAmount(0);
      return;
    }
    if (cartSubtotal < appliedCoupon.minOrderValue || cartSubtotal === 0) {
      setAppliedCoupon(null);
      setDiscountAmount(0);
      return;
    }
    if (appliedCoupon.freeShipping || appliedCoupon.discountType === 'free_shipping') {
      setDiscountAmount(0);
      return;
    }
    const nextDiscount =
      appliedCoupon.discountType === 'percent'
        ? Math.round(((cartSubtotal * appliedCoupon.discountValue) / 100) * 100) / 100
        : Math.round(Math.min(cartSubtotal, appliedCoupon.discountValue) * 100) / 100;
    setDiscountAmount(nextDiscount);
  }, [cartSubtotal, appliedCoupon]);

  function handleAddToCart(
    product: Product,
    variation: string,
    quantity = 1,
    variationDetails?: CartItem['variationDetails']
  ) {
    const safeQuantity = Math.max(1, Math.floor(quantity));
    setConfirmedOrder(null);
    setCart((prev) => {
      const primary = variationDetails?.primaryValue || '';
      const secondary = variationDetails?.secondaryValue || '';
      const { remainingAddable } = getRemainingAddableForCard(product, prev, primary, secondary);
      if (remainingAddable <= 0) {
        return prev;
      }
      const addQty = Math.min(safeQuantity, remainingAddable);

      const existingIndex = prev.findIndex(
        (item) => item.productId === product.id && item.variation === variation
      );
      if (existingIndex >= 0) {
        return prev.map((item, idx) =>
          idx === existingIndex
            ? {
                ...item,
                quantity: item.quantity + addQty,
                ...(variationDetails ? { variationDetails } : {}),
              }
            : item
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          price: product.price,
          imageUrl: product.imageUrl,
          variation,
          ...(variationDetails ? { variationDetails } : {}),
          quantity: addQty,
        },
      ];
    });
  }

  function handleUpdateQuantity(productId: number, variation: string, delta: number) {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.productId !== productId || item.variation !== variation) return item;
          if (delta > 0) {
            const product = products.find((p) => p.id === productId);
            const maxStock = getMaxQuantityForCartLine(product, prev, item);
            return { ...item, quantity: Math.min(maxStock, item.quantity + delta) };
          }
          return { ...item, quantity: item.quantity + delta };
        })
        .filter((item) => item.quantity > 0)
    );
  }

  function handleRemoveItem(productId: number, variation: string) {
    setCart((prev) =>
      prev.filter((item) => !(item.productId === productId && item.variation === variation))
    );
  }

  function handleNavigate(view: AppView) {
    setConfirmedOrder(null);
    if (user?.role === 'courier' && view !== 'courier') {
      setActiveView('courier');
      return;
    }
    if (view === 'admin' && user?.role !== 'admin') {
      setActiveView('store');
      return;
    }
    if (view === 'courier' && user?.role !== 'courier') {
      setActiveView('store');
      return;
    }
    if (view === 'orders') {
      void loadMyOrders(token);
    }
    if (view === 'account') {
      void loadRouletteState(token);
      void loadMyOrders(token);
    }
    setActiveView(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleOpenTracking(orderId: number, fromView: 'account' | 'orders' | 'admin' = 'account') {
    setConfirmedOrder(null);
    setSelectedTrackingOrderId(orderId);
    setTrackingReturnView(fromView);
    setActiveView('tracking');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleSelectCategoryFromCarousel(category: string) {
    setSelectedCategory(category);
    const el = document.getElementById('catalogo-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  }

  function handleOrderCreated(order: Order) {
    setConfirmedOrder(order);
    setCart([]);
    setAppliedCoupon(null);
    setDiscountAmount(0);
    setCheckoutDraft((prev) => ({
      ...prev,
      couponCode: '',
      notes: '',
      changeFor: '',
    }));
    void loadMyOrders(token);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleApplyPrizeCoupon(code: string) {
    setCheckoutDraft((prev) => ({ ...prev, couponCode: code }));
    if (cart.length > 0) {
      try {
        const res = await api.validateCoupon(token, code, cartSubtotal);
        if (res.valid && res.coupon) {
          setAppliedCoupon(res.coupon);
          setDiscountAmount(res.discountAmount || 0);
        }
      } catch {
        // CheckoutView handles error feedback if applicable
      }
      handleNavigate('checkout');
    } else {
      setLiveNotice(`Cupom ${code} selecionado! Adicione itens ao carrinho para usar no checkout.`);
      handleNavigate('store');
    }
  }

  function handleCloseWelcomeModal() {
    setWelcomeModalOpen(false);
    if (user && user.welcomeCampaignSeen === false) {
      void api
        .markWelcomeSeen(token)
        .then((res) => {
          if (res.user) setUser(res.user);
        })
        .catch(() => {});
    }
  }

  function handleStartShoppingFromWelcome() {
    handleCloseWelcomeModal();
    setConfirmedOrder(null);
    setSelectedCategory('Todos');
    setActiveView('store');
    window.setTimeout(() => {
      const el = document.getElementById('catalogo-section');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }, 60);
  }

  if (authChecking) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-4">
        <BrandLogoSVG size={56} />
        <p className="text-xs font-semibold tracking-[0.2em] text-[#9E9E9E]">R&amp;P TABACARIA</p>
      </div>
    );
  }

  if (!user || pendingResetToken) {
    return (
      <AuthGate
        adminClaimed={authStatus.adminClaimed}
        adminEmail={authStatus.adminEmail}
        initialResetToken={pendingResetToken}
        onResetTokenFinished={() => {
          setPendingResetToken(null);
          setUser(null);
          setToken(null);
        }}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">

      <Header
        user={user}
        activeView={activeView}
        cartCount={cartCount}
        cartSubtotal={cartSubtotal}
        rouletteAvailableCount={rouletteState?.chances.available ?? 0}
        onNavigate={handleNavigate}
        onOpenRzin={() => setRzinOpen(true)}
        onLogout={() => void handleLogout()}
      />

      <main className="flex-1 w-full max-w-[1400px] mx-auto px-3 sm:px-6 py-6 sm:py-8">
        {liveNotice && (
          <div className="mb-6 p-4 rounded-2xl bg-[#111111] border border-white/25 text-xs sm:text-sm text-white flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setLiveNotice('');
                setAccountSubTab('roulette');
                handleNavigate('account');
              }}
              className="flex items-center gap-2.5 text-left hover:underline"
            >
              <Gift className="w-4 h-4 shrink-0 text-white" />
              <span className="font-semibold">{liveNotice}</span>
            </button>
            <button
              type="button"
              onClick={() => setLiveNotice('')}
              aria-label="Fechar aviso"
              className="p-1 rounded-lg text-[#9E9E9E] hover:text-white shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {!settings.storeOpen && activeView === 'store' && (
          <div className="mb-6 p-4 rounded-2xl bg-red-950/50 border border-red-500/40 text-xs sm:text-sm text-red-200 flex items-start gap-3">
            <Lock className="w-4 h-4 shrink-0 mt-0.5 text-red-300" />
            <div>
              <p className="font-bold text-white">Loja fechada no momento</p>
              <p className="mt-0.5">
                {settings.closedMessage} · Horário: {settings.storeHours}
              </p>
            </div>
          </div>
        )}

        {confirmedOrder ? (
          <OrderConfirmationModal
            order={confirmedOrder}
            storeWhatsapp={settings.storeWhatsapp}
            onViewOrders={() => handleNavigate('orders')}
            onBackToStore={() => handleNavigate('store')}
          />
        ) : activeView === 'store' ? (
          <div className="space-y-10">
            {storeLoading && products.length === 0 ? (
              <div className="rounded-3xl border border-white/10 bg-[#0A0A0A] p-14 text-center text-sm text-[#9E9E9E]">
                Carregando catálogo R&amp;P Tabacaria...
              </div>
            ) : (
              <>
                <EditorialCarousel
                  slides={slides}
                  onSelectCategory={handleSelectCategoryFromCarousel}
                />
                <CatalogSection
                  products={products}
                  categories={categories}
                  selectedCategory={selectedCategory}
                  cart={cart}
                  onSelectCategory={setSelectedCategory}
                  onAddToCart={handleAddToCart}
                  onOpenRzin={() => setRzinOpen(true)}
                />
                <SuggestionBoxSection
                  token={token}
                  userName={user.name}
                  userEmail={user.email}
                />
              </>
            )}
          </div>
        ) : activeView === 'cart' ? (
          <CartView
            items={cart}
            products={products}
            subtotal={cartSubtotal}
            discountAmount={discountAmount}
            settings={settings}
            onUpdateQuantity={handleUpdateQuantity}
            onRemoveItem={handleRemoveItem}
            onBackToStore={() => handleNavigate('store')}
            onContinueToCheckout={() => {
              if (cart.length > 0 && settings.storeOpen) handleNavigate('checkout');
            }}
          />
        ) : activeView === 'checkout' ? (
          <CheckoutView
            token={token}
            items={cart}
            subtotal={cartSubtotal}
            settings={settings}
            draft={checkoutDraft}
            appliedCoupon={appliedCoupon}
            discountAmount={discountAmount}
            onUpdateDraft={setCheckoutDraft}
            onApplyCouponState={(coupon, amount) => {
              setAppliedCoupon(coupon);
              setDiscountAmount(amount);
            }}
            onBackToCart={() => handleNavigate('cart')}
            onOrderCreated={handleOrderCreated}
          />
        ) : activeView === 'orders' ? (
          <MyOrdersView
            orders={myOrders}
            loading={ordersLoading}
            onBackToStore={() => handleNavigate('store')}
            onTrackDelivery={(orderId) => handleOpenTracking(orderId, 'orders')}
          />
        ) : activeView === 'account' ? (
          <MyAccountView
            token={token}
            user={user}
            subTab={accountSubTab}
            onSubTabChange={setAccountSubTab}
            orders={myOrders}
            ordersLoading={ordersLoading}
            onTrackDelivery={(orderId) => handleOpenTracking(orderId, 'account')}
            rouletteState={rouletteState}
            onProfileSaved={(updatedUser) => {
              setUser(updatedUser);
              applyUserProfileToDraft(updatedUser, true);
            }}
            onRouletteUpdated={(nextState) => setRouletteState(nextState)}
            onApplyPrizeCoupon={(code) => void handleApplyPrizeCoupon(code)}
          />
        ) : activeView === 'tracking' && selectedTrackingOrderId !== null ? (
          <DeliveryTrackingView
            token={token}
            orderId={selectedTrackingOrderId}
            liveTrackingUpdate={liveTrackingUpdate}
            onBack={() => handleNavigate(trackingReturnView)}
          />
        ) : activeView === 'courier' && user.role === 'courier' ? (
          <CourierDeliveryView
            token={token}
            user={user}
            liveSyncTrigger={liveSyncCounter}
          />
        ) : activeView === 'admin' && user.role === 'admin' ? (
          <AdminPanel
            token={token}
            liveSyncTrigger={liveSyncCounter}
            onStoreDataChanged={() => {
              void loadStoreData(token);
            }}
            onOpenTracking={(orderId) => handleOpenTracking(orderId, 'admin')}
          />
        ) : null}
      </main>

      {activeView !== 'checkout' && (
        <footer className="border-t border-white/10 mt-12 py-8 px-4 sm:px-6 text-center text-xs text-[#9E9E9E] space-y-4">
          <div>
            <p className="font-semibold text-white">R&amp;P TABACARIA</p>
            <p className="mt-1">Qualidade · Variedade · Sempre com você</p>
          </div>
          <div>
            <a
              href="https://share.google/Wvlt5sHGVC4AsvTdz"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-xl border border-white/20 bg-[#0C0C0C] text-xs font-bold text-white hover:bg-white hover:text-black transition-colors"
            >
              <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
              <span>Avaliar atendimento no Google</span>
              <ExternalLink className="w-3.5 h-3.5 opacity-70" />
            </a>
          </div>
        </footer>
      )}

      {user.role !== 'courier' && (
        <RzinAssistant
          token={token}
          products={products}
          isOpen={rzinOpen}
          hideFloatingTrigger={activeView === 'checkout' || welcomeModalOpen}
          onOpen={() => setRzinOpen(true)}
          onClose={() => setRzinOpen(false)}
          onAddToCart={handleAddToCart}
        />
      )}

      {user.role !== 'courier' && (
        <WelcomeCampaignModal
          isOpen={welcomeModalOpen}
          customerName={user.name}
          onClose={handleCloseWelcomeModal}
          onStartShopping={handleStartShoppingFromWelcome}
        />
      )}

      {sessionExpiredModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="relogin-title"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSessionReloginError('');
              setSessionReloginLoading(true);
              try {
                const res = await api.login({
                  email: (sessionReloginEmail || user.email).trim(),
                  password: sessionReloginPassword,
                });
                setUser(res.user);
                setToken(res.token);
                setSessionReloginPassword('');
                setSessionExpiredModalOpen(false);
                setLiveNotice('Sessão renovada! Seus dados digitados foram mantidos; clique em Salvar novamente.');
              } catch (err) {
                setSessionReloginError(
                  err instanceof Error ? err.message : 'E-mail ou senha inválidos.'
                );
              } finally {
                setSessionReloginLoading(false);
              }
            }}
            className="w-full max-w-md rounded-3xl border border-white/20 bg-[#111111] p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="relogin-title" className="text-lg font-extrabold text-white">
                  Sessão expirada — entrar novamente
                </h2>
                <p className="text-xs text-[#9E9E9E] mt-1">
                  O que você já digitou continua aberto atrás desta janela. Confirme sua senha para continuar e salvar.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSessionExpiredModalOpen(false)}
                aria-label="Fechar aviso de sessão"
                className="p-1.5 rounded-lg text-[#9E9E9E] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {sessionReloginError && (
              <div role="alert" className="p-3 rounded-xl bg-red-950/70 border border-red-500/40 text-xs text-red-200">
                {sessionReloginError}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">E-mail</label>
              <input
                type="email"
                required
                value={sessionReloginEmail || user.email}
                onChange={(e) => setSessionReloginEmail(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Senha *</label>
              <input
                type="password"
                required
                autoFocus
                value={sessionReloginPassword}
                onChange={(e) => setSessionReloginPassword(e.target.value)}
                placeholder="Digite sua senha para restaurar a sessão"
                className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="h-10 px-4 rounded-xl border border-white/15 text-xs font-semibold text-[#9E9E9E] hover:text-white"
              >
                Trocar conta
              </button>
              <button
                type="submit"
                disabled={sessionReloginLoading}
                className="h-10 px-5 rounded-xl bg-white text-black text-xs sm:text-sm font-extrabold hover:bg-neutral-200 disabled:opacity-50"
              >
                {sessionReloginLoading ? 'Entrando...' : 'Restaurar sessão'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
