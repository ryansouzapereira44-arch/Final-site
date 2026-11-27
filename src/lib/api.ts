import type {
  CarouselSlide,
  CartItem,
  Coordinates,
  Coupon,
  DeliveryAddress,
  DeliveryMethod,
  Order,
  OrderStatus,
  PaymentMethod,
  Product,
  RoulettePrize,
  RouletteSpin,
  RouletteStateResponse,
  ShippingEstimate,
  StoreSettings,
  User,
} from '../types';

export interface AuthStatusResponse {
  adminClaimed: boolean;
  adminEmail: string;
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

async function request<T>(url: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data && (data.error || data.message)) || 'Erro ao comunicar com o servidor.');
  }
  return data as T;
}

export const api = {
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

  lookupCep(token: string | null, cep: string): Promise<CepLookupResponse> {
    const clean = cep.replace(/\D/g, '');
    return request<CepLookupResponse>(`/api/cep/${clean}`, {}, token);
  },

  getStore(token: string | null): Promise<StoreResponse> {
    return request<StoreResponse>('/api/store', {}, token);
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

  saveSlide(token: string | null, slide: Omit<CarouselSlide, 'id'> & { id?: number }): Promise<{ slide: CarouselSlide }> {
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
    status: OrderStatus
  ): Promise<{ order: Order; chancesGranted?: number }> {
    return request<{ order: Order; chancesGranted?: number }>(
      `/api/admin/orders/${orderId}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      },
      token
    );
  },
};
