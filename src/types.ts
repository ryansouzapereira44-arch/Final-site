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
  welcomeCampaignSeen?: boolean;
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
  sku?: string;
  name: string;
  category: string;
  description: string;
  badgeLabel?: string;
  price: number;
  costPrice?: number;
  freightCostUnit?: number;
  packagingCostUnit?: number;
  otherCostUnit?: number;
  purchasedQuantity?: number;
  stockQuantity?: number;
  archived?: boolean;
  archivedAt?: string | null;
  imageUrl: string;
  variationLabel?: string;
  variations: string[];
  secondaryVariationLabel?: string;
  secondaryVariations?: string[];
  variationStock?: Record<string, number>;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerSummary {
  id: number;
  name: string;
  email: string;
}

export interface ProductSuggestion {
  id: number;
  userId: number;
  customerName: string;
  customerEmail: string;
  suggestion: string;
  createdAt: string;
}

export interface Coupon {
  id: number;
  code: string;
  discountType: 'percent' | 'fixed' | 'free_shipping';
  discountValue: number;
  minOrderValue: number;
  freeShipping: boolean;
  ownerUserId: number | null;
  allowedEmail: string | null;
  allowMultipleUses: boolean;
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
  linkUrl?: string;
  imageUrl: string;
  storagePath?: string;
  sortOrder: number;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
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
  variationDetails?: {
    primaryLabel?: string;
    primaryValue?: string;
    secondaryLabel?: string;
    secondaryValue?: string;
  };
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
  stockDeducted?: boolean;
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

export interface RzinRecommendation {
  productId: number;
  name: string;
  brandOrLine: string;
  category: string;
  variation: string;
  flavorDescription: string;
  matchReason: string;
  price: number;
  imageUrl: string;
  available: boolean;
}

export interface RzinChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  recommendations?: RzinRecommendation[];
}

export type ProfitSortOption =
  | 'highest_profit_unit'
  | 'highest_margin'
  | 'highest_potential_profit'
  | 'lowest_margin';

export interface ProfitProductRow {
  id: number;
  sku: string;
  name: string;
  category: string;
  description: string;
  imageUrl: string;
  variations: string[];
  active: boolean;
  price: number;
  costPrice: number;
  freightCostUnit: number;
  packagingCostUnit: number;
  otherCostUnit: number;
  totalAdditionalCostUnit: number;
  totalUnitCost: number;
  purchasedQuantity: number;
  stockQuantity: number;
  profitPerUnit: number;
  marginPercent: number;
  markupPercent: number;
  potentialCost: number;
  potentialRevenue: number;
  potentialProfit: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProfitCategorySummary {
  category: string;
  productCount: number;
  totalUnits: number;
  totalInvested: number;
  potentialRevenue: number;
  potentialProfit: number;
  avgMarginPercent: number;
}

export interface ProfitIndicators {
  totalInvested: number;
  potentialRevenue: number;
  potentialGrossProfit: number;
  averageMarginPercent: number;
  totalStockUnits: number;
  totalPurchasedUnits: number;
  activeProductCount: number;
  configuredCostCount: number;
  mostProfitableProduct: ProfitProductRow | null;
  lowestMarginProduct: ProfitProductRow | null;
}

export interface ProductCostBatch {
  id: number;
  productId: number;
  productName: string;
  productSku: string;
  productArchived: boolean;
  quantityPurchased: number;
  remainingQuantity: number;
  unitPurchaseCost: number;
  freightCostUnit: number;
  packagingCostUnit: number;
  otherCostUnit: number;
  totalUnitCost: number;
  supplierNote: string;
  purchasedAt: string;
  createdAt: string;
}

export type ProductCostEventType =
  | 'initial'
  | 'manual_edit'
  | 'batch_entry'
  | 'price_change'
  | 'archived';

export interface ProductCostHistoryEntry {
  id: number;
  productId: number;
  productNameSnapshot: string;
  productArchived: boolean;
  eventType: ProductCostEventType;
  unitPurchaseCost: number;
  freightCostUnit: number;
  packagingCostUnit: number;
  otherCostUnit: number;
  totalUnitCost: number;
  salePrice: number;
  purchasedQuantity: number;
  stockQuantity: number;
  note: string;
  recordedAt: string;
}

export interface HistoricalSaleProfitSummary {
  ordersAnalyzed: number;
  unitsSold: number;
  totalSalesRevenue: number;
  totalHistoricalCost: number;
  totalHistoricalGrossProfit: number;
  recentOrders: {
    orderId: number;
    orderNumber: number;
    createdAt: string;
    status: OrderStatus;
    itemsRevenue: number;
    historicalCost: number;
    historicalGrossProfit: number;
    marginPercent: number;
  }[];
}

export interface ProfitOverviewResponse {
  products: ProfitProductRow[];
  indicators: ProfitIndicators;
  categories: ProfitCategorySummary[];
  batches: ProductCostBatch[];
  history: ProductCostHistoryEntry[];
  historicalSales: HistoricalSaleProfitSummary;
  costingMethodNote: string;
}

export type LoyalCustomerPeriod = 'today' | '7d' | '30d' | 'current_month' | 'all' | 'custom';
export type LoyalCustomerSortBy = 'total_spent' | 'orders_count' | 'avg_ticket' | 'last_order_at';

export interface LoyalCustomerRow {
  rank: number;
  userId: number;
  name: string;
  email: string;
  whatsapp: string;
  mainNeighborhood: string;
  ordersCount: number;
  totalSpent: number;
  avgTicket: number;
  lastOrderAt: string;
  topProduct: string;
  isInactive30d: boolean;
}

export interface LoyalCustomersSummary {
  totalCustomers: number;
  recurringCustomers: number;
  overallAvgTicket: number;
  top10Revenue: number;
}

export interface LoyalCustomersResponse {
  customers: LoyalCustomerRow[];
  summary: LoyalCustomersSummary;
  neighborhoods: string[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
}

export interface LoyalCustomerDetail {
  customer: {
    userId: number;
    name: string;
    email: string;
    whatsapp: string;
    cpf: string;
    mainNeighborhood: string;
    ordersCount: number;
    totalSpent: number;
    avgTicket: number;
    lastOrderAt: string;
    isInactive30d: boolean;
  };
  addresses: DeliveryAddress[];
  favoriteProducts: {
    productName: string;
    variation: string;
    totalQuantity: number;
    totalSpent: number;
  }[];
  orders: Order[];
}


