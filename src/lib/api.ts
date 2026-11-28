import type {
  CarouselSlide,
  CartItem,
  Coordinates,
  CourierSummary,
  Coupon,
  CustomerSummary,
  DeliveryAddress,
  DeliveryMethod,
  DeliveryTrackingInfo,
  LoyalCustomerDetail,
  LoyalCustomerPeriod,
  LoyalCustomersResponse,
  LoyalCustomerSortBy,
  Order,
  OrderStatus,
  PaymentMethod,
  Product,
  ProductCostBatch,
  ProductCostHistoryEntry,
  ProductSuggestion,
  ProfitOverviewResponse,
  ProfitProductRow,
  RoulettePrize,
  RouletteSpin,
  RouletteStateResponse,
  RzinRecommendation,
  ShippingEstimate,
  StoreSettings,
  User,
} from '../types';

export interface AuthStatusResponse {
  adminClaimed: boolean;
  adminEmail: string;
  user?: User | null;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface StoreResponse {
  products: Product[];
  categories: string[];
  slides: CarouselSlide[];
  settings: StoreSettings;
}

export interface AdminOverviewResponse {
  products: Product[];
  coupons: Coupon[];
  slides: CarouselSlide[];
  orders: Order[];
  couriers: CourierSummary[];
  customers?: CustomerSummary[];
  suggestions?: ProductSuggestion[];
  settings: StoreSettings;
}

export interface AdminRouletteResponse {
  prizes: RoulettePrize[];
  spins: RouletteSpin[];
  totals: {
    available: number;
    used: number;
    expired: number;
  };
}

export interface CouponValidationResponse {
  valid: boolean;
  coupon?: Coupon;
  discountAmount?: number;
  message: string;
}

export interface CepLookupResponse {
  lat: number;
  lng: number;
  street?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

type UnauthorizedHandler = () => void;
type TokenRefreshedHandler = (user: User, token: string) => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;
let tokenRefreshedHandler: TokenRefreshedHandler | null = null;
let pendingRefreshPromise: Promise<AuthResponse | null> | null = null;

async function performSilentRefresh(token?: string | null): Promise<AuthResponse | null> {
  if (pendingRefreshPromise) {
    return pendingRefreshPromise;
  }
  pendingRefreshPromise = (async () => {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers,
      });
      if (!res.ok) return null;
      const data = (await res.json()) as AuthResponse;
      if (data?.user && data?.token && tokenRefreshedHandler) {
        tokenRefreshedHandler(data.user, data.token);
      }
      return data;
    } catch {
      return null;
    } finally {
      pendingRefreshPromise = null;
    }
  })();
  return pendingRefreshPromise;
}

async function request<T>(
  url: string,
  options: RequestInit = {},
  token?: string | null,
  allowRefreshRetry = true
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      credentials: 'include',
      cache: 'no-store',
      headers,
    });
  } catch {
    throw new Error('Sem conexão com a internet. Verifique sua rede e tente novamente.');
  }

  const isAuthEndpoint = url.startsWith('/api/auth/');
  if (res.status === 401 && allowRefreshRetry && !isAuthEndpoint) {
    const refreshed = await performSilentRefresh(token);
    if (refreshed?.token) {
      return request<T>(url, options, refreshed.token, false);
    }
    if (unauthorizedHandler) {
      unauthorizedHandler();
    }
    throw new Error('Sua sessão expirou. Faça login novamente sem fechar o formulário.');
  }

  if (res.status === 401 && !isAuthEndpoint && unauthorizedHandler) {
    unauthorizedHandler();
  }

  if (res.status === 413) {
    throw new Error('Arquivo muito grande para envio. Escolha uma imagem menor.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data && (data.error || data.message)) || 'Erro ao comunicar com o servidor.');
  }
  return data as T;
}

export const api = {
  setSessionCallbacks(handlers: {
    onUnauthorized?: UnauthorizedHandler | null;
    onTokenRefreshed?: TokenRefreshedHandler | null;
  }) {
    unauthorizedHandler = handlers.onUnauthorized ?? null;
    tokenRefreshedHandler = handlers.onTokenRefreshed ?? null;
  },

  refreshSession(token?: string | null): Promise<AuthResponse> {
    return request<AuthResponse>(
      '/api/auth/refresh',
      {
        method: 'POST',
      },
      token,
      false
    );
  },

  getAuthStatus(): Promise<AuthStatusResponse> {
    return request<AuthStatusResponse>('/api/auth/status');
  },

  getMe(): Promise<{ user: User }> {
    return request<{ user: User }>('/api/auth/me');
  },

  register(payload: { name: string; email: string; whatsapp: string; password: string }): Promise<AuthResponse> {
    return request<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  login(payload: { email: string; password: string }): Promise<AuthResponse> {
    return request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  forgotPassword(email: string): Promise<{ ok: boolean; message: string }> {
    return request<{ ok: boolean; message: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  validateResetToken(token: string): Promise<{ valid: boolean; emailHint?: string }> {
    return request<{ valid: boolean; emailHint?: string }>(
      `/api/auth/reset-password/validate?token=${encodeURIComponent(token)}`
    );
  },

  resetPassword(payload: {
    token: string;
    password: string;
    confirmPassword: string;
  }): Promise<{ ok: boolean; message: string }> {
    return request<{ ok: boolean; message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  logout(): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>('/api/auth/logout', {
      method: 'POST',
    });
  },

  updateProfile(
    token: string | null,
    payload: {
      name: string;
      whatsapp: string;
      cpf: string;
      savedAddress: DeliveryAddress | null;
    }
  ): Promise<{ user: User }> {
    return request<{ user: User }>(
      '/api/account/profile',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  markWelcomeSeen(token: string | null): Promise<{ user: User }> {
    return request<{ user: User }>(
      '/api/account/welcome-seen',
      {
        method: 'POST',
      },
      token
    );
  },

  lookupCep(token: string | null, cep: string): Promise<CepLookupResponse> {
    const clean = cep.replace(/\D/g, '');
    return request<CepLookupResponse>(`/api/cep/${clean}`, {}, token);
  },

  getStore(token: string | null): Promise<StoreResponse> {
    return request<StoreResponse>('/api/store', {}, token);
  },

  submitSuggestion(token: string | null, suggestion: string): Promise<{ suggestion: ProductSuggestion }> {
    return request<{ suggestion: ProductSuggestion }>(
      '/api/suggestions',
      {
        method: 'POST',
        body: JSON.stringify({ suggestion }),
      },
      token
    );
  },

  estimateShipping(
    token: string | null,
    payload: {
      cep: string;
      subtotalAfterDiscount: number;
      deliveryMethod: DeliveryMethod;
      coords: Coordinates | null;
      freeShippingByCoupon?: boolean;
    }
  ): Promise<ShippingEstimate> {
    return request<ShippingEstimate>(
      '/api/shipping/estimate',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  validateCoupon(token: string | null, code: string, subtotal: number): Promise<CouponValidationResponse> {
    return request<CouponValidationResponse>(
      '/api/coupons/validate',
      {
        method: 'POST',
        body: JSON.stringify({ code, subtotal }),
      },
      token
    );
  },

  chatWithRzin(
    token: string | null,
    messages: { role: 'user' | 'model'; text: string }[]
  ): Promise<{ reply: string; recommendations: RzinRecommendation[] }> {
    return request<{ reply: string; recommendations: RzinRecommendation[] }>(
      '/api/rzin/chat',
      {
        method: 'POST',
        body: JSON.stringify({ messages }),
      },
      token
    );
  },

  createOrder(
    token: string | null,
    payload: {
      customerName: string;
      customerWhatsapp: string;
      customerCpf: string;
      deliveryMethod: DeliveryMethod;
      address: DeliveryAddress | null;
      coords: Coordinates | null;
      paymentMethod: PaymentMethod;
      changeFor: string;
      couponCode: string;
      notes: string;
      items: CartItem[];
    }
  ): Promise<{ order: Order }> {
    return request<{ order: Order }>(
      '/api/orders',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  getMyOrders(token: string | null): Promise<{ orders: Order[] }> {
    return request<{ orders: Order[] }>('/api/orders/mine', {}, token);
  },

  getOrderTracking(token: string | null, orderId: number): Promise<{ tracking: DeliveryTrackingInfo }> {
    return request<{ tracking: DeliveryTrackingInfo }>(`/api/orders/${orderId}/tracking`, {}, token);
  },

  // Courier (Motoboy)
  getCourierOrders(token: string | null): Promise<{ orders: Order[] }> {
    return request<{ orders: Order[] }>('/api/courier/orders', {}, token);
  },

  startCourierTracking(
    token: string | null,
    orderId: number
  ): Promise<{ tracking: DeliveryTrackingInfo }> {
    return request<{ tracking: DeliveryTrackingInfo }>(
      `/api/courier/orders/${orderId}/tracking/start`,
      { method: 'POST' },
      token
    );
  },

  sendCourierLocation(
    token: string | null,
    orderId: number,
    payload:
      | { lat: number; lng: number; accuracy?: number | null; heading?: number | null; speed?: number | null }
      | { gpsStatus: 'unavailable' }
  ): Promise<{ tracking: DeliveryTrackingInfo }> {
    return request<{ tracking: DeliveryTrackingInfo }>(
      `/api/courier/orders/${orderId}/location`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  stopCourierTracking(
    token: string | null,
    orderId: number,
    markDelivered: boolean
  ): Promise<{ order: Order; tracking: DeliveryTrackingInfo }> {
    return request<{ order: Order; tracking: DeliveryTrackingInfo }>(
      `/api/courier/orders/${orderId}/tracking/stop`,
      {
        method: 'POST',
        body: JSON.stringify({ markDelivered }),
      },
      token
    );
  },

  // Roulette
  getRoulette(token: string | null): Promise<RouletteStateResponse> {
    return request<RouletteStateResponse>('/api/roulette', {}, token);
  },

  spinRoulette(
    token: string | null
  ): Promise<{
    prize: RoulettePrize;
    prizeIndex: number;
    couponCode: string | null;
    couponExpiresAt: string | null;
    spin: RouletteSpin;
    state: RouletteStateResponse;
  }> {
    return request(
      '/api/roulette/spin',
      {
        method: 'POST',
      },
      token
    );
  },

  // Admin
  getAdminOverview(token: string | null): Promise<AdminOverviewResponse> {
    return request<AdminOverviewResponse>('/api/admin/overview', {}, token);
  },

  getAdminRoulette(token: string | null): Promise<AdminRouletteResponse> {
    return request<AdminRouletteResponse>('/api/admin/roulette', {}, token);
  },

  updateAdminRoulettePrize(
    token: string | null,
    prizeId: number,
    payload: {
      label: string;
      shortLabel: string;
      discountValue: number;
      weight: number;
      active: boolean;
    }
  ): Promise<{ prize: RoulettePrize }> {
    return request<{ prize: RoulettePrize }>(
      `/api/admin/roulette/prizes/${prizeId}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  toggleStoreStatus(
    token: string | null,
    storeOpen: boolean,
    closedMessage?: string
  ): Promise<{ settings: StoreSettings }> {
    return request<{ settings: StoreSettings }>(
      '/api/admin/store-status',
      {
        method: 'PATCH',
        body: JSON.stringify({ storeOpen, closedMessage }),
      },
      token
    );
  },

  saveProduct(
    token: string | null,
    product: Omit<Product, 'id' | 'createdAt' | 'updatedAt'> & { id?: number }
  ): Promise<{ product: Product }> {
    const isEdit = typeof product.id === 'number';
    return request<{ product: Product }>(
      isEdit ? `/api/admin/products/${product.id}` : '/api/admin/products',
      {
        method: isEdit ? 'PUT' : 'POST',
        body: JSON.stringify(product),
      },
      token
    );
  },

  deleteProduct(token: string | null, id: number): Promise<{ deleted: boolean }> {
    return request<{ deleted: boolean }>(`/api/admin/products/${id}`, { method: 'DELETE' }, token);
  },

  saveCoupon(
    token: string | null,
    coupon: Omit<
      Coupon,
      'id' | 'usageCount' | 'createdAt' | 'freeShipping' | 'ownerUserId' | 'maxUses' | 'expiresAt'
    > & {
      id?: number;
    }
  ): Promise<{ coupon: Coupon }> {
    const isEdit = typeof coupon.id === 'number';
    return request<{ coupon: Coupon }>(
      isEdit ? `/api/admin/coupons/${coupon.id}` : '/api/admin/coupons',
      {
        method: isEdit ? 'PUT' : 'POST',
        body: JSON.stringify(coupon),
      },
      token
    );
  },

  deleteCoupon(token: string | null, id: number): Promise<{ deleted: boolean }> {
    return request<{ deleted: boolean }>(`/api/admin/coupons/${id}`, { method: 'DELETE' }, token);
  },

  uploadAdminImage(
    token: string | null,
    dataUrl: string,
    folder: 'carousel' | 'products' = 'carousel'
  ): Promise<{ imageUrl: string; storagePath?: string }> {
    return request<{ imageUrl: string; storagePath?: string }>(
      '/api/admin/upload-image',
      {
        method: 'POST',
        body: JSON.stringify({ dataUrl, folder }),
      },
      token
    );
  },

  saveSlide(
    token: string | null,
    slide: Omit<CarouselSlide, 'id' | 'createdAt' | 'updatedAt'> & { id?: number }
  ): Promise<{ slide: CarouselSlide }> {
    const isEdit = typeof slide.id === 'number';
    return request<{ slide: CarouselSlide }>(
      isEdit ? `/api/admin/carousel/${slide.id}` : '/api/admin/carousel',
      {
        method: isEdit ? 'PUT' : 'POST',
        body: JSON.stringify(slide),
      },
      token
    );
  },

  deleteSlide(token: string | null, id: number): Promise<{ deleted: boolean }> {
    return request<{ deleted: boolean }>(`/api/admin/carousel/${id}`, { method: 'DELETE' }, token);
  },

  saveSettings(token: string | null, settings: StoreSettings): Promise<{ settings: StoreSettings }> {
    return request<{ settings: StoreSettings }>(
      '/api/admin/settings',
      {
        method: 'PUT',
        body: JSON.stringify(settings),
      },
      token
    );
  },

  updateOrderStatus(
    token: string | null,
    orderId: number,
    status: OrderStatus,
    assignedCourierId?: number | null
  ): Promise<{ order: Order; chancesGranted?: number }> {
    return request<{ order: Order; chancesGranted?: number }>(
      `/api/admin/orders/${orderId}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status, assignedCourierId }),
      },
      token
    );
  },

  getAdminCouriers(token: string | null): Promise<{ couriers: CourierSummary[] }> {
    return request<{ couriers: CourierSummary[] }>('/api/admin/couriers', {}, token);
  },

  createAdminCourier(
    token: string | null,
    payload: { name: string; email: string; whatsapp: string; password: string }
  ): Promise<{ courier: CourierSummary }> {
    return request<{ courier: CourierSummary }>(
      '/api/admin/couriers',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  toggleCourierActive(
    token: string | null,
    courierId: number,
    active: boolean
  ): Promise<{ courier: CourierSummary }> {
    return request<{ courier: CourierSummary }>(
      `/api/admin/couriers/${courierId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ active }),
      },
      token
    );
  },

  updateAdminCourier(
    token: string | null,
    courierId: number,
    payload: { name: string; email: string; whatsapp: string; active: boolean; password?: string }
  ): Promise<{ courier: CourierSummary }> {
    return request<{ courier: CourierSummary }>(
      `/api/admin/couriers/${courierId}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  deleteAdminCourier(token: string | null, courierId: number): Promise<{ deleted: boolean }> {
    return request<{ deleted: boolean }>(
      `/api/admin/couriers/${courierId}`,
      {
        method: 'DELETE',
      },
      token
    );
  },

  assignOrderCourier(
    token: string | null,
    orderId: number,
    courierId: number | null
  ): Promise<{ order: Order }> {
    return request<{ order: Order }>(
      `/api/admin/orders/${orderId}/assign-courier`,
      {
        method: 'PATCH',
        body: JSON.stringify({ courierId }),
      },
      token
    );
  },

  deleteAdminSuggestion(token: string | null, id: number): Promise<{ deleted: boolean }> {
    return request<{ deleted: boolean }>(`/api/admin/suggestions/${id}`, { method: 'DELETE' }, token);
  },

  // R&P Profit Manager (Admin only)
  getProfitOverview(token: string | null): Promise<ProfitOverviewResponse> {
    return request<ProfitOverviewResponse>('/api/admin/profit/overview', {}, token);
  },

  getProfitProductDetail(
    token: string | null,
    productId: number
  ): Promise<{
    product: ProfitProductRow;
    batches: ProductCostBatch[];
    history: ProductCostHistoryEntry[];
  }> {
    return request(`/api/admin/profit/products/${productId}`, {}, token);
  },

  updateProfitProduct(
    token: string | null,
    productId: number,
    payload: {
      sku?: string;
      price?: number;
      costPrice?: number;
      freightCostUnit?: number;
      packagingCostUnit?: number;
      otherCostUnit?: number;
      purchasedQuantity?: number;
      stockQuantity?: number;
      note?: string;
    }
  ): Promise<{ product: ProfitProductRow }> {
    return request<{ product: ProfitProductRow }>(
      `/api/admin/profit/products/${productId}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  createProfitBatch(
    token: string | null,
    productId: number,
    payload: {
      quantityPurchased: number;
      unitPurchaseCost: number;
      freightCostUnit?: number;
      packagingCostUnit?: number;
      otherCostUnit?: number;
      supplierNote?: string;
      purchasedAt?: string;
    }
  ): Promise<{ product: ProfitProductRow; batch: ProductCostBatch }> {
    return request<{ product: ProfitProductRow; batch: ProductCostBatch }>(
      `/api/admin/profit/products/${productId}/batches`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  // Clientes Mais Fiéis (Admin only)
  getLoyalCustomers(
    token: string | null,
    params: {
      period: LoyalCustomerPeriod;
      startDate?: string;
      endDate?: string;
      sortBy: LoyalCustomerSortBy;
      search?: string;
      neighborhood?: string;
      inactiveOnly?: boolean;
      page?: number;
      pageSize?: number;
    }
  ): Promise<LoyalCustomersResponse> {
    const qs = new URLSearchParams();
    qs.set('period', params.period);
    qs.set('sortBy', params.sortBy);
    if (params.startDate) qs.set('startDate', params.startDate);
    if (params.endDate) qs.set('endDate', params.endDate);
    if (params.search) qs.set('search', params.search);
    if (params.neighborhood) qs.set('neighborhood', params.neighborhood);
    if (params.inactiveOnly) qs.set('inactiveOnly', 'true');
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    return request<LoyalCustomersResponse>(`/api/admin/loyal-customers?${qs.toString()}`, {}, token);
  },

  getLoyalCustomerDetail(token: string | null, userId: number): Promise<LoyalCustomerDetail> {
    return request<LoyalCustomerDetail>(`/api/admin/loyal-customers/${userId}`, {}, token);
  },

  async exportLoyalCustomersCsv(
    token: string | null,
    params: {
      period: LoyalCustomerPeriod;
      startDate?: string;
      endDate?: string;
      sortBy: LoyalCustomerSortBy;
      search?: string;
      neighborhood?: string;
      inactiveOnly?: boolean;
    }
  ): Promise<{ blob: Blob; filename: string }> {
    const qs = new URLSearchParams();
    qs.set('period', params.period);
    qs.set('sortBy', params.sortBy);
    if (params.startDate) qs.set('startDate', params.startDate);
    if (params.endDate) qs.set('endDate', params.endDate);
    if (params.search) qs.set('search', params.search);
    if (params.neighborhood) qs.set('neighborhood', params.neighborhood);
    if (params.inactiveOnly) qs.set('inactiveOnly', 'true');

    const url = `/api/admin/loyal-customers/export?${qs.toString()}`;
    const doFetch = async (bearer?: string | null) => {
      try {
        return await fetch(url, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
          },
        });
      } catch {
        throw new Error('Sem conexão com a internet. Verifique sua rede e tente novamente.');
      }
    };

    let res = await doFetch(token);
    if (res.status === 401) {
      const refreshed = await performSilentRefresh(token);
      if (refreshed?.token) {
        res = await doFetch(refreshed.token);
      } else {
        if (unauthorizedHandler) unauthorizedHandler();
        throw new Error('Sua sessão expirou. Faça login novamente para exportar.');
      }
    }
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error((errData && (errData.error || errData.message)) || 'Erro ao exportar CSV.');
    }

    const blob = await res.blob();
    const disp = res.headers.get('content-disposition') || '';
    const match = /filename="?([^"]+)"?/i.exec(disp);
    const filename = match?.[1] || `clientes-mais-fieis-${new Date().toISOString().slice(0, 10)}.csv`;
    return { blob, filename };
  },
};
