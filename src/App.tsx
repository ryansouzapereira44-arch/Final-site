/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gift, Lock, X } from 'lucide-react';
import { AdminPanel } from './components/AdminPanel';
import { AuthGate } from './components/AuthGate';
import { BrandLogoSVG } from './components/BrandMark';
import { CartView } from './components/CartView';
import { CatalogSection } from './components/CatalogSection';
import { CheckoutView } from './components/CheckoutView';
import { EditorialCarousel } from './components/EditorialCarousel';
import { Header, type AppView } from './components/Header';
import { MyAccountView, type AccountSubTab } from './components/MyAccountView';
import { MyOrdersView } from './components/MyOrdersView';
import { OrderConfirmationModal } from './components/OrderConfirmationModal';
import { api } from './lib/api';
import type {
  CarouselSlide,
  CartItem,
  CheckoutDraft,
  Coupon,
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

  // Auto-restore login session via HttpOnly cookie if already signed in once
  useEffect(() => {
    let active = true;
    async function restoreSession() {
      try {
        const [statusRes, meRes] = await Promise.allSettled([api.getAuthStatus(), api.getMe()]);
        if (!active) return;
        if (statusRes.status === 'fulfilled') {
          setAuthStatus(statusRes.value);
        }
        if (meRes.status === 'fulfilled' && meRes.value.user) {
          const restoredUser = meRes.value.user;
          setUser(restoredUser);
          applyUserProfileToDraft(restoredUser);
          void loadStoreData(null);
        }
      } finally {
        if (active) setAuthChecking(false);
      }
    }
    void restoreSession();
    return () => {
      active = false;
    };
  }, [loadStoreData, applyUserProfileToDraft]);

  // Real-time SSE sync: updates ROLETA chances & order statuses immediately when admin confirms an order
  useEffect(() => {
    if (!user) return;
    void loadRouletteState(token);

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
      void loadMyOrders(token);
    });

    return () => {
      es.close();
    };
  }, [user, token, loadRouletteState, loadMyOrders]);

  function handleAuthenticated(loggedUser: User, authToken: string) {
    setUser(loggedUser);
    setToken(authToken);
    setActiveView('store');
    setConfirmedOrder(null);
    applyUserProfileToDraft(loggedUser, true);
    void loadStoreData(authToken);
    void loadRouletteState(authToken);
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
    setCheckoutDraft(INITIAL_DRAFT);
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

  function handleAddToCart(product: Product, variation: string) {
    setConfirmedOrder(null);
    setCart((prev) => {
      const existingIndex = prev.findIndex(
        (item) => item.productId === product.id && item.variation === variation
      );
      if (existingIndex >= 0) {
        return prev.map((item, idx) =>
          idx === existingIndex ? { ...item, quantity: item.quantity + 1 } : item
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
          quantity: 1,
        },
      ];
    });
  }

  function handleUpdateQuantity(productId: number, variation: string, delta: number) {
    setCart((prev) =>
      prev
        .map((item) =>
          item.productId === productId && item.variation === variation
            ? { ...item, quantity: item.quantity + delta }
            : item
        )
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
    if (view === 'admin' && user?.role !== 'admin') {
      setActiveView('store');
      return;
    }
    if (view === 'orders') {
      void loadMyOrders(token);
    }
    if (view === 'account') {
      void loadRouletteState(token);
    }
    setActiveView(view);
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

  if (authChecking) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-4">
        <BrandLogoSVG size={56} />
        <p className="text-xs font-semibold tracking-[0.2em] text-[#9E9E9E]">R&amp;P TABACARIA</p>
      </div>
    );
  }

  if (!user) {
    return (
      <AuthGate
        adminClaimed={authStatus.adminClaimed}
        adminEmail={authStatus.adminEmail}
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
        onLogout={() => void handleLogout()}
      />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-8">
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
                  onSelectCategory={setSelectedCategory}
                  onAddToCart={handleAddToCart}
                />
              </>
            )}
          </div>
        ) : activeView === 'cart' ? (
          <CartView
            items={cart}
            subtotal={cartSubtotal}
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
          />
        ) : activeView === 'account' ? (
          <MyAccountView
            token={token}
            user={user}
            subTab={accountSubTab}
            onSubTabChange={setAccountSubTab}
            rouletteState={rouletteState}
            onProfileSaved={(updatedUser) => {
              setUser(updatedUser);
              applyUserProfileToDraft(updatedUser, true);
            }}
            onRouletteUpdated={(nextState) => setRouletteState(nextState)}
            onApplyPrizeCoupon={(code) => void handleApplyPrizeCoupon(code)}
          />
        ) : activeView === 'admin' && user.role === 'admin' ? (
          <AdminPanel
            token={token}
            onStoreDataChanged={() => {
              void loadStoreData(token);
            }}
          />
        ) : null}
      </main>

      {activeView !== 'checkout' && (
        <footer className="border-t border-white/10 mt-12 py-8 px-4 sm:px-6 text-center text-xs text-[#9E9E9E]">
          <p className="font-semibold text-white">R&amp;P TABACARIA</p>
          <p className="mt-1">Qualidade · Variedade · Sempre com você</p>
        </footer>
      )}
    </div>
  );
}
