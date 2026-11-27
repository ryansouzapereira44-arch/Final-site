export type UserRole = 'admin' | 'customer' | 'courier';

export interface DeliveryAddress {
  street: string;
  number: string;
  neighborhood: string;
  cep: string;
  complement: string;
}

export interface User {
  id: number;
  name: string;
  email: string;
  whatsapp: string;
  cpf: string;
  savedAddress: DeliveryAddress | null;
  role: UserRole;
  active?: boolean;
  createdAt: string;
}

export interface CourierSummary {
  id: number;
  name: string;
  email: string;
  whatsapp: string;
  active: boolean;
  createdAt: string;
}

export interface Product {
  id: number;
  name: string;
  category: string;
  description: string;
  price: number;
  imageUrl: string;
  variations: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Coupon {
  id: number;
  code: string;
  discountType: 'percent' | 'fixed' | 'free_shipping';
  discountValue: number;
  minOrderValue: number;
  freeShipping: boolean;
  ownerUserId: number | null;
  maxUses: number | null;
  expiresAt: string | null;
  active: boolean;
  usageCount: number;
  createdAt: string;
}

export interface CarouselSlide {
  id: number;
  tag: string;
  title: string;
  subtitle: string;
  ctaText: string;
  targetCategory: string;
  imageUrl: string;
  sortOrder: number;
  active: boolean;
}

export type ShippingMode = 'per_km' | 'fixed' | 'to_confirm';

export interface StoreSettings {
  storeName: string;
  storeOpen: boolean;
  closedMessage: string;
  minDeliveryOrder: number;
  shippingMode: ShippingMode;
  shippingPerKm: number;
  freeShippingKm: number;
  shippingFee: number | null;
  freeShippingThreshold: number | null;
  storeCep: string;
  storeLat: number;
  storeLng: number;
  storeAddress: string;
  storeHours: string;
  storeWhatsapp: string;
  pickupInstructions: string;
}

export interface CartItem {
  productId: number;
  name: string;
  price: number;
  imageUrl: string;
  variation: string;
  quantity: number;
}

export type DeliveryMethod = 'Entrega' | 'Retirada na loja';
export type PaymentMethod = 'PIX' | 'Cartão de crédito' | 'Cartão de débito' | 'Dinheiro';
export type OrderStatus =
  | 'Pendente'
  | 'Confirmado'
  | 'Em preparo'
  | 'Saiu para entrega'
  | 'Entregue'
  | 'Pronto para retirada'
  | 'Concluído'
  | 'Cancelado';

export type CourierGpsStatus = 'waiting' | 'active' | 'unavailable' | 'ended';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface CheckoutDraft {
  fullName: string;
  whatsapp: string;
  cpf: string;
  deliveryMethod: DeliveryMethod;
  address: DeliveryAddress;
  coords: Coordinates | null;
  paymentMethod: PaymentMethod | '';
  changeFor: string;
  couponCode: string;
  notes: string;
}

export interface ShippingEstimate {
  distanceKm: number | null;
  shippingFee: number | null;
  shippingLabel: string;
  addressHint?: {
    street?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
  };
}

export interface Order {
  id: number;
  orderNumber: number;
  userId: number;
  customerName: string;
  customerWhatsapp: string;
  customerCpf: string;
  deliveryMethod: DeliveryMethod;
  address: DeliveryAddress | null;
  distanceKm: number | null;
  paymentMethod: PaymentMethod;
  changeFor: string;
  items: CartItem[];
  subtotal: number;
  discountAmount: number;
  couponCode: string | null;
  shippingFee: number | null;
  shippingLabel: string;
  total: number;
  status: OrderStatus;
  rouletteGranted: boolean;
  notes: string;
  createdAt: string;
  assignedCourierId: number | null;
  assignedCourierName: string;
  destCoords: Coordinates | null;
  trackingActive: boolean;
  courierGpsStatus: CourierGpsStatus;
  lastLocationAt: string | null;
  deliveredAt: string | null;
}

export interface DeliveryTrackingInfo {
  orderId: number;
  orderNumber: number;
  status: OrderStatus;
  deliveryMethod: DeliveryMethod;
  customerName: string;
  address: DeliveryAddress | null;
  destCoords: Coordinates | null;
  storeCoords: Coordinates;
  storeAddress: string;
  assignedCourierId: number | null;
  assignedCourierName: string;
  trackingActive: boolean;
  courierCoords: Coordinates | null;
  courierAccuracy: number | null;
  courierHeading: number | null;
  courierSpeed: number | null;
  courierGpsStatus: CourierGpsStatus;
  lastLocationAt: string | null;
  deliveredAt: string | null;
}

export type RoulettePrizeType = 'free_shipping' | 'percent' | 'none';

export interface RoulettePrize {
  id: number;
  label: string;
  shortLabel: string;
  prizeType: RoulettePrizeType;
  discountValue: number;
  weight: number;
  color: string;
  active: boolean;
  sortOrder: number;
}

export interface RouletteChance {
  id: number;
  userId: number;
  orderId: number;
  orderNumber: number;
  status: 'available' | 'used' | 'expired';
  grantedAt: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface RouletteSpin {
  id: number;
  userId: number;
  userName: string;
  chanceId: number;
  prizeId: number;
  prizeLabel: string;
  prizeType: RoulettePrizeType;
  couponCode: string | null;
  couponExpiresAt: string | null;
  createdAt: string;
}

export interface RouletteStateResponse {
  prizes: RoulettePrize[];
  chances: {
    available: number;
    used: number;
    expired: number;
    activeList: RouletteChance[];
  };
  spins: RouletteSpin[];
}
