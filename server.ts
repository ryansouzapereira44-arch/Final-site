import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import {
  createUserRecord,
  db,
  formatProductSku,
  getUserByEmail,
  getUserById,
  hasAdminUser,
  hasUserUsedCoupon,
  listCouriers,
  listCustomers,
  mapChanceRow,
  mapCouponRow,
  mapDeliveryTrackingInfo,
  mapOrderRow,
  mapPrizeRow,
  mapProductRow,
  mapPublicProductRow,
  mapSettingsRow,
  mapSlideRow,
  mapSpinRow,
  mapSuggestionRow,
  markUserWelcomeSeen,
  recordCouponUsage,
} from './server/db.ts';
import {
  type AuthenticatedRequest,
  clearSessionCookie,
  getAdminEmail,
  getConfiguredAdminPassword,
  getOptionalAuthUser,
  hashPassword,
  isAdminClaimed,
  requireAdmin,
  requireAuth,
  requireCourier,
  setSessionCookie,
  signSessionToken,
  verifyEnvAdminPassword,
  verifyPassword,
} from './server/auth.ts';
import { sendPasswordResetEmail } from './server/mailer.ts';
import {
  ROULETTE_COUPON_VALIDITY_MS,
  startCouponReminderScheduler,
} from './server/couponReminders.ts';
import {
  getProductProfitDetail,
  getProfitOverview,
  recordProductCostSnapshot,
  registerProductBatch,
  updateProductProfitData,
} from './server/profit.ts';
import {
  createDriverPersistent,
  createProductPersistent,
  createSlidePersistent,
  deleteDriverPersistent,
  deleteProductPersistent,
  deleteSlidePersistent,
  isSupabaseConfigured,
  listDriversPersistent,
  listProductsPersistent,
  listSlidesPersistent,
  syncOrderToSupabase,
  syncProductProfitToSupabase,
  syncProductStockToSupabase,
  updateDriverPersistent,
  updateProductPersistent,
  updateSlidePersistent,
  uploadImageToSupabaseStorage,
} from './server/supabaseStore.ts';
import {
  buildLoyalCustomersCsv,
  getAllFilteredLoyalCustomersForExport,
  getLoyalCustomerDetail,
  getLoyalCustomersOverview,
} from './server/loyalty.ts';
import { runRzinChat, type RzinInputMessage } from './server/rzin.ts';
import { computeTotalUnitCost } from './src/lib/profitMath.ts';
import {
  resolveVariationStockInfo,
  sanitizeVariationStockMap,
  splitVariationString,
} from './src/lib/stock.ts';
import { validateGpsCoordinates } from './src/lib/tracking.ts';
import type {
  CartItem,
  Coordinates,
  Coupon,
  DeliveryAddress,
  OrderStatus,
  PaymentMethod,
  RoulettePrize,
  RouletteStateResponse,
  User,
} from './src/types.ts';

const VALID_PAYMENTS: PaymentMethod[] = ['PIX', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro'];
const VALID_ORDER_STATUSES: OrderStatus[] = [
  'Pendente',
  'Confirmado',
  'Em preparo',
  'Saiu para entrega',
  'Entregue',
  'Pronto para retirada',
  'Concluído',
  'Cancelado',
];

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isSafeImageUrl(url: string): boolean {
  if (!url) return true;
  if (url.startsWith('/')) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// SSE client registry per userId for real-time roulette, order & delivery tracking updates
const sseClients = new Map<number, Set<Response>>();
const sseAdminUserIds = new Set<number>();

function pushUserEvent(userId: number, eventName: string, payload: unknown): void {
  const clients = sseClients.get(userId);
  if (!clients || clients.size === 0) return;
  const serialized = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(serialized);
    } catch {
      clients.delete(res);
    }
  }
}

function pushAdminEvent(eventName: string, payload: unknown): void {
  for (const adminId of sseAdminUserIds) {
    pushUserEvent(adminId, eventName, payload);
  }
}

function pushBroadcastEvent(eventName: string, payload: unknown): void {
  for (const userId of sseClients.keys()) {
    pushUserEvent(userId, eventName, payload);
  }
}

interface CepLookupResult {
  lat: number;
  lng: number;
  street?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

const cepMemoryCache = new Map<string, CepLookupResult>();

async function lookupBrazilianCep(rawCep: string): Promise<CepLookupResult | null> {
  const cleanCep = rawCep.replace(/\D/g, '');
  if (!/^\d{8}$/.test(cleanCep)) return null;

  const cached = cepMemoryCache.get(cleanCep);
  if (cached) return cached;

  let street = '';
  let neighborhood = '';
  let city = '';
  let state = '';
  let lat = 0;
  let lng = 0;

  // 1. AwesomeAPI (returns street, district, city, state, lat, lng)
  try {
    const res = await fetch(`https://cep.awesomeapi.com.br/json/${cleanCep}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      street = typeof data.address === 'string' ? data.address : '';
      neighborhood = typeof data.district === 'string' ? data.district : '';
      city = typeof data.city === 'string' ? data.city : '';
      state = typeof data.state === 'string' ? data.state : '';
      const parsedLat = Number(data.lat);
      const parsedLng = Number(data.lng);
      if (Number.isFinite(parsedLat) && Number.isFinite(parsedLng) && parsedLat !== 0 && parsedLng !== 0) {
        lat = parsedLat;
        lng = parsedLng;
      }
    }
  } catch {
    // fallback below
  }

  // 2. BrasilAPI fallback if missing coords or address
  if (!street || (lat === 0 && lng === 0)) {
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${cleanCep}`, {
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          street?: string;
          neighborhood?: string;
          city?: string;
          state?: string;
          location?: { coordinates?: { latitude?: string; longitude?: string } };
        };
        if (!street && data.street) street = data.street;
        if (!neighborhood && data.neighborhood) neighborhood = data.neighborhood;
        if (!city && data.city) city = data.city;
        if (!state && data.state) state = data.state;
        const parsedLat = Number(data.location?.coordinates?.latitude);
        const parsedLng = Number(data.location?.coordinates?.longitude);
        if (lat === 0 && lng === 0 && Number.isFinite(parsedLat) && Number.isFinite(parsedLng)) {
          lat = parsedLat;
          lng = parsedLng;
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. ViaCEP fallback for address auto-fill
  if (!street || !neighborhood) {
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`, {
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          erro?: boolean;
          logradouro?: string;
          bairro?: string;
          localidade?: string;
          uf?: string;
        };
        if (!data.erro) {
          if (!street && data.logradouro) street = data.logradouro;
          if (!neighborhood && data.bairro) neighborhood = data.bairro;
          if (!city && data.localidade) city = data.localidade;
          if (!state && data.uf) state = data.uf;
        }
      }
    } catch {
      // ignore
    }
  }

  if (!street && !neighborhood && !city && lat === 0 && lng === 0) {
    return null;
  }

  const result: CepLookupResult = {
    lat,
    lng,
    street: street || undefined,
    neighborhood: neighborhood || undefined,
    city: city || undefined,
    state: state || undefined,
  };
  if (lat !== 0 && lng !== 0) {
    cepMemoryCache.set(cleanCep, result);
  }
  return result;
}

async function geocodeDeliveryAddress(
  address: DeliveryAddress | null,
  fallbackCoords: Coordinates | null = null
): Promise<Coordinates | null> {
  if (address) {
    const cepResult = address.cep ? await lookupBrazilianCep(address.cep) : null;
    const parts = [
      address.street || cepResult?.street || '',
      address.number || '',
      address.neighborhood || cepResult?.neighborhood || '',
      cepResult?.city || '',
      cepResult?.state || '',
      address.cep || '',
      'Brasil',
    ]
      .map((s) => s.trim())
      .filter(Boolean);

    // Free OpenStreetMap Nominatim geocoding (no API key or billing required)
    if (parts.length > 0) {
      try {
        const url = new URL('https://nominatim.openstreetmap.org/search');
        url.searchParams.set('format', 'jsonv2');
        url.searchParams.set('countrycodes', 'br');
        url.searchParams.set('limit', '1');
        url.searchParams.set('q', parts.join(', '));
        const geoRes = await fetch(url.toString(), {
          headers: {
            'Accept-Language': 'pt-BR',
            'User-Agent': 'RPTabacaria-DeliveryTracker/1.0',
          },
          signal: AbortSignal.timeout(4500),
        });
        if (geoRes.ok) {
          const data = (await geoRes.json()) as Array<{ lat?: string; lon?: string }>;
          const first = data[0];
          const valid = validateGpsCoordinates(Number(first?.lat), Number(first?.lon));
          if (valid) {
            return valid;
          }
        }
      } catch {
        // fallback below
      }
    }

    if (cepResult && cepResult.lat !== 0 && cepResult.lng !== 0) {
      const valid = validateGpsCoordinates(cepResult.lat, cepResult.lng);
      if (valid) return valid;
    }
  }

  return fallbackCoords ? validateGpsCoordinates(fallbackCoords.lat, fallbackCoords.lng) : null;
}

function haversineDistanceKm(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Math.round(R * c * 1.2 * 10) / 10;
}

async function computeShipping(
  subtotalAfterDiscount: number,
  deliveryMethod: 'Entrega' | 'Retirada na loja',
  settings: ReturnType<typeof mapSettingsRow>,
  cep: string,
  clientCoords: Coordinates | null,
  freeShippingByCoupon = false
): Promise<{
  distanceKm: number | null;
  shippingFee: number | null;
  shippingLabel: string;
  addressHint?: { street?: string; neighborhood?: string; city?: string; state?: string };
}> {
  if (deliveryMethod === 'Retirada na loja') {
    return { distanceKm: null, shippingFee: 0, shippingLabel: 'Grátis (Retirada)' };
  }

  if (freeShippingByCoupon) {
    return { distanceKm: null, shippingFee: 0, shippingLabel: 'Grátis (Cupom Roleta)' };
  }

  if (
    settings.freeShippingThreshold !== null &&
    settings.freeShippingThreshold > 0 &&
    subtotalAfterDiscount >= settings.freeShippingThreshold
  ) {
    return { distanceKm: null, shippingFee: 0, shippingLabel: 'Grátis' };
  }

  if (settings.shippingMode === 'per_km') {
    let destCoords: Coordinates | null = null;
    let addressHint: CepLookupResult | null = null;

    if (cep && cep.replace(/\D/g, '').length === 8) {
      addressHint = await lookupBrazilianCep(cep);
      if (addressHint && addressHint.lat !== 0 && addressHint.lng !== 0) {
        destCoords = { lat: addressHint.lat, lng: addressHint.lng };
      }
    }
    if (
      !destCoords &&
      clientCoords &&
      Number.isFinite(clientCoords.lat) &&
      Number.isFinite(clientCoords.lng)
    ) {
      destCoords = clientCoords;
    }

    if (!destCoords) {
      return {
        distanceKm: null,
        shippingFee: null,
        shippingLabel: 'A confirmar',
        addressHint: addressHint
          ? {
              street: addressHint.street,
              neighborhood: addressHint.neighborhood,
              city: addressHint.city,
              state: addressHint.state,
            }
          : undefined,
      };
    }

    const distanceKm = haversineDistanceKm(
      { lat: settings.storeLat, lng: settings.storeLng },
      destCoords
    );
    const kmText = distanceKm.toFixed(1).replace('.', ',');

    if (distanceKm <= settings.freeShippingKm) {
      return {
        distanceKm,
        shippingFee: 0,
        shippingLabel: `Grátis (${kmText} km)`,
        addressHint: addressHint
          ? {
              street: addressHint.street,
              neighborhood: addressHint.neighborhood,
              city: addressHint.city,
              state: addressHint.state,
            }
          : undefined,
      };
    }

    const fee = roundMoney(distanceKm * settings.shippingPerKm);
    return {
      distanceKm,
      shippingFee: fee,
      shippingLabel: `R$ ${fee.toFixed(2).replace('.', ',')} (${kmText} km)`,
      addressHint: addressHint
        ? {
            street: addressHint.street,
            neighborhood: addressHint.neighborhood,
            city: addressHint.city,
            state: addressHint.state,
          }
        : undefined,
    };
  }

  if (settings.shippingMode === 'fixed' && settings.shippingFee !== null && settings.shippingFee >= 0) {
    return {
      distanceKm: null,
      shippingFee: roundMoney(settings.shippingFee),
      shippingLabel: `R$ ${roundMoney(settings.shippingFee).toFixed(2).replace('.', ',')}`,
    };
  }

  return { distanceKm: null, shippingFee: null, shippingLabel: 'A confirmar' };
}

function expireOldChances(userId?: number): void {
  const now = new Date().toISOString();
  if (typeof userId === 'number') {
    db.prepare(
      "UPDATE roulette_chances SET status = 'expired' WHERE userId = ? AND status = 'available' AND expiresAt <= ?"
    ).run(userId, now);
  } else {
    db.prepare(
      "UPDATE roulette_chances SET status = 'expired' WHERE status = 'available' AND expiresAt <= ?"
    ).run(now);
  }
}

function expireOldCoupons(): void {
  const now = new Date().toISOString();
  db.prepare('UPDATE coupons SET active = 0 WHERE expiresAt IS NOT NULL AND expiresAt <= ? AND active = 1').run(
    now
  );
}

function evaluateCouponForUser(
  coupon: Coupon,
  user: User,
  subtotal: number,
  nowIso: string
):
  | { ok: true; discountAmount: number; freeShipping: boolean; message: string }
  | { ok: false; status: number; message: string } {
  const normalizedUserEmail = user.email.trim().toLowerCase();

  if (coupon.ownerUserId !== null && coupon.ownerUserId !== user.id) {
    return { ok: false, status: 403, message: 'Este cupom pertence a outro cliente.' };
  }
  if (coupon.allowedEmail !== null && normalizedUserEmail !== coupon.allowedEmail.trim().toLowerCase()) {
    return { ok: false, status: 403, message: 'Este cupom é exclusivo para outro usuário.' };
  }
  if (coupon.expiresAt && coupon.expiresAt <= nowIso) {
    return { ok: false, status: 400, message: 'Este cupom expirou.' };
  }
  if (!coupon.active) {
    return { ok: false, status: 400, message: 'Este cupom está inativo.' };
  }
  if (coupon.maxUses !== null && coupon.usageCount >= coupon.maxUses) {
    return { ok: false, status: 400, message: 'Este cupom já atingiu o limite de usos.' };
  }
  if (!coupon.allowMultipleUses && hasUserUsedCoupon(coupon.id, user.id)) {
    return { ok: false, status: 400, message: 'Você já utilizou este cupom. Ele só pode ser usado uma vez.' };
  }
  if (subtotal < coupon.minOrderValue) {
    return {
      ok: false,
      status: 400,
      message: `Pedido mínimo de R$ ${coupon.minOrderValue.toFixed(2).replace('.', ',')} para usar este cupom.`,
    };
  }

  let discountAmount = 0;
  let freeShipping = false;
  let message = '';
  if (coupon.freeShipping || coupon.discountType === 'free_shipping') {
    freeShipping = true;
    message = `Cupom ${coupon.code} aplicado (Frete Grátis).`;
  } else if (coupon.discountType === 'percent') {
    discountAmount = roundMoney((subtotal * coupon.discountValue) / 100);
    message = `Cupom ${coupon.code} aplicado (${coupon.discountValue}% OFF).`;
  } else {
    discountAmount = roundMoney(Math.min(subtotal, coupon.discountValue));
    message = `Cupom ${coupon.code} aplicado (R$ ${coupon.discountValue.toFixed(2).replace('.', ',')} OFF).`;
  }

  return { ok: true, discountAmount, freeShipping, message };
}

function validateOrderItemsStock(
  items: CartItem[]
): { ok: true } | { ok: false; error: string } {
  const totalByProduct = new Map<number, { name: string; requested: number; available: number }>();
  const totalByVariation = new Map<
    string,
    { productId: number; name: string; variationLabel: string; requested: number; available: number }
  >();

  for (const item of items) {
    const productRow = db
      .prepare('SELECT * FROM products WHERE id = ? AND active = 1 AND archived = 0')
      .get(item.productId) as Record<string, unknown> | undefined;
    if (!productRow) {
      return { ok: false, error: `O produto "${item.name}" não está mais disponível.` };
    }
    const product = mapProductRow(productRow);
    const productAvailable = Math.max(0, Math.round(Number(product.stockQuantity ?? 0)));

    const prevProd = totalByProduct.get(product.id);
    totalByProduct.set(product.id, {
      name: product.name,
      requested: (prevProd?.requested || 0) + item.quantity,
      available: productAvailable,
    });

    const { stockKey, available: optionAvailable, usesOptionStock } = resolveVariationStockInfo(
      product,
      item.variation
    );
    if (usesOptionStock && stockKey) {
      const mapKey = `${product.id}__${stockKey}`;
      const prevVar = totalByVariation.get(mapKey);
      totalByVariation.set(mapKey, {
        productId: product.id,
        name: product.name,
        variationLabel: stockKey,
        requested: (prevVar?.requested || 0) + item.quantity,
        available: optionAvailable,
      });
    }
  }

  for (const entry of totalByVariation.values()) {
    if (entry.available <= 0) {
      return {
        ok: false,
        error: `A opção "${entry.variationLabel}" de ${entry.name} está esgotada.`,
      };
    }
    if (entry.requested > entry.available) {
      return {
        ok: false,
        error: `Estoque insuficiente para ${entry.name} (${entry.variationLabel}). Máximo disponível: ${entry.available}.`,
      };
    }
  }

  for (const entry of totalByProduct.values()) {
    if (entry.available <= 0) {
      return {
        ok: false,
        error: `O produto "${entry.name}" está esgotado no momento.`,
      };
    }
    if (entry.requested > entry.available) {
      return {
        ok: false,
        error: `Estoque insuficiente para ${entry.name}. Máximo disponível: ${entry.available}.`,
      };
    }
  }

  return { ok: true };
}

function adjustInventoryForOrderItems(items: CartItem[], direction: 'deduct' | 'restore'): void {
  const now = new Date().toISOString();
  for (const item of items) {
    const productRow = db
      .prepare('SELECT * FROM products WHERE id = ?')
      .get(item.productId) as Record<string, unknown> | undefined;
    if (!productRow) continue;
    const product = mapProductRow(productRow);
    const currentStock = Math.max(0, Math.round(Number(product.stockQuantity ?? 0)));
    const nextStock =
      direction === 'deduct'
        ? Math.max(0, currentStock - item.quantity)
        : currentStock + item.quantity;

    const varStock = { ...(product.variationStock || {}) };
    const { stockKey, usesOptionStock } = resolveVariationStockInfo(product, item.variation);
    if (usesOptionStock && stockKey && Object.prototype.hasOwnProperty.call(varStock, stockKey)) {
      const currentOpt = Math.max(0, Math.round(Number(varStock[stockKey] ?? 0)));
      varStock[stockKey] =
        direction === 'deduct'
          ? Math.max(0, currentOpt - item.quantity)
          : currentOpt + item.quantity;
    }

    db.prepare('UPDATE products SET stockQuantity = ?, variationStockJson = ?, updatedAt = ? WHERE id = ?').run(
      nextStock,
      JSON.stringify(varStock),
      now,
      product.id
    );
  }
}

function getUserRouletteState(userId: number): RouletteStateResponse {
  expireOldChances(userId);
  const prizeRows = db
    .prepare('SELECT * FROM roulette_prizes WHERE active = 1 ORDER BY sortOrder ASC, id ASC')
    .all() as Record<string, unknown>[];
  const chanceRows = db
    .prepare('SELECT * FROM roulette_chances WHERE userId = ? ORDER BY expiresAt ASC, id ASC')
    .all(userId) as Record<string, unknown>[];
  const spinRows = db
    .prepare('SELECT * FROM roulette_spins WHERE userId = ? ORDER BY id DESC LIMIT 50')
    .all(userId) as Record<string, unknown>[];

  const chances = chanceRows.map(mapChanceRow);
  const activeList = chances.filter((c) => c.status === 'available');
  const used = chances.filter((c) => c.status === 'used').length;
  const expired = chances.filter((c) => c.status === 'expired').length;

  return {
    prizes: prizeRows.map(mapPrizeRow),
    chances: {
      available: activeList.length,
      used,
      expired,
      activeList,
    },
    spins: spinRows.map(mapSpinRow),
  };
}

function pickWeightedPrize(prizes: RoulettePrize[]): { prize: RoulettePrize; index: number } {
  const weighted = prizes.map((p, idx) => ({ prize: p, index: idx, weight: Math.max(0, Math.round(p.weight)) }));
  const totalWeight = weighted.reduce((acc, item) => acc + item.weight, 0);
  if (totalWeight <= 0) {
    return { prize: prizes[0], index: 0 };
  }
  const roll = crypto.randomInt(0, totalWeight);
  let cursor = 0;
  for (const item of weighted) {
    cursor += item.weight;
    if (roll < cursor) {
      return { prize: item.prize, index: item.index };
    }
  }
  return { prize: prizes[0], index: 0 };
}

function generatePrizeCouponCode(prize: RoulettePrize): string {
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  if (prize.prizeType === 'free_shipping') {
    return `RP-FG-${suffix}`;
  }
  return `RP-${Math.round(prize.discountValue)}-${suffix}`;
}

async function startServer(): Promise<void> {
  const app = express();
  const httpServer = http.createServer(app);
  app.set('trust proxy', 1);

  // Disable HTTP caching on API endpoints so store & admin never show stale data
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  // Legacy read-only fallback for any pre-existing files in data/uploads
  const legacyUploadsDir = path.resolve(process.cwd(), 'data', 'uploads');
  if (fs.existsSync(legacyUploadsDir)) {
    app.use('/uploads', express.static(legacyUploadsDir, { maxAge: '1h' }));
  }

  // Serve media stored in SQLite (when Supabase Storage env vars are not configured yet)
  app.get('/api/media/:filename', (req, res) => {
    const filename = String(req.params.filename || '').trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
      res.status(400).json({ error: 'Arquivo inválido.' });
      return;
    }
    const row = db
      .prepare('SELECT mimeType, data FROM uploaded_media WHERE filename = ?')
      .get(filename) as { mimeType: string; data: Uint8Array } | undefined;
    if (!row) {
      res.status(404).json({ error: 'Imagem não encontrada.' });
      return;
    }
    res.setHeader('Content-Type', row.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(row.data));
  });

  // Admin image upload (uploads to Supabase Storage when configured, otherwise SQLite uploaded_media — never ephemeral disk)
  app.post(
    '/api/admin/upload-image',
    express.json({ limit: '6mb' }),
    requireAuth,
    requireAdmin,
    async (req, res) => {
      const dataUrl = typeof req.body?.dataUrl === 'string' ? req.body.dataUrl.trim() : '';
      const folder = req.body?.folder === 'products' ? 'products' : 'carousel';
      const match = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (!match) {
        res.status(400).json({ error: 'Formato de imagem inválido. Envie JPG, PNG ou WebP.' });
        return;
      }

      const declaredType = match[1].toLowerCase();
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length < 16 || buffer.length > 4 * 1024 * 1024) {
        res.status(400).json({ error: 'A imagem deve ter no máximo 4 MB após otimização.' });
        return;
      }

      const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
      const isPng =
        buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
      const isWebp =
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP';

      let ext: 'jpg' | 'png' | 'webp' | null = null;
      let mimeType: string | null = null;
      if ((declaredType === 'jpeg' || declaredType === 'jpg') && isJpeg) {
        ext = 'jpg';
        mimeType = 'image/jpeg';
      } else if (declaredType === 'png' && isPng) {
        ext = 'png';
        mimeType = 'image/png';
      } else if (declaredType === 'webp' && isWebp) {
        ext = 'webp';
        mimeType = 'image/webp';
      }

      if (!ext || !mimeType) {
        res.status(400).json({ error: 'Arquivo de imagem corrompido ou não suportado.' });
        return;
      }

      try {
        if (isSupabaseConfigured()) {
          const uploaded = await uploadImageToSupabaseStorage({ buffer, mimeType, ext, folder });
          res.status(201).json(uploaded);
          return;
        }

        const filename = `${folder}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
        db.prepare(
          'INSERT INTO uploaded_media (filename, mimeType, data, sizeBytes, createdAt) VALUES (?, ?, ?, ?, ?)'
        ).run(filename, mimeType, buffer, buffer.length, new Date().toISOString());
        res.status(201).json({ imageUrl: `/api/media/${filename}`, storagePath: '' });
      } catch (err) {
        console.error('Upload image error:', err);
        res.status(500).json({
          error:
            err instanceof Error
              ? err.message
              : 'Falha ao enviar imagem para o armazenamento permanente.',
        });
      }
    }
  );

  app.use(express.json({ limit: '1mb' }));

  // Auth status (public)
  app.get('/api/auth/status', (req, res) => {
    res.json({
      adminClaimed: isAdminClaimed(),
      adminEmail: getAdminEmail(),
      user: getOptionalAuthUser(req),
    });
  });

  // Register account (Customer or one-time Admin claim for rptabacaria3@gmail.com)
  app.post('/api/auth/register', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const whatsapp = typeof req.body?.whatsapp === 'string' ? req.body.whatsapp.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (name.length < 2) {
      res.status(400).json({ error: 'Informe seu nome completo (mínimo 2 caracteres).' });
      return;
    }
    if (!email || !email.includes('@') || email.length > 160) {
      res.status(400).json({ error: 'Informe um e-mail válido.' });
      return;
    }
    if (password.length < 6 || password.length > 128) {
      res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
      return;
    }

    const existing = getUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: 'Este e-mail já está cadastrado. Faça login.' });
      return;
    }

    const adminEmail = getAdminEmail();
    let role: 'admin' | 'customer' = 'customer';

    if (email === adminEmail) {
      if (getConfiguredAdminPassword() || hasAdminUser()) {
        res.status(409).json({
          error: 'O acesso administrativo já foi configurado. Entre pela aba Login.',
        });
        return;
      }
      role = 'admin';
    }

    const passwordHash = hashPassword(password);
    const user = createUserRecord({ name, email, whatsapp, passwordHash, role });
    const token = signSessionToken(user);
    setSessionCookie(res, token);
    res.status(201).json({ user, token });
  });

  // Login
  app.post('/api/auth/login', (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !password) {
      res.status(400).json({ error: 'Informe e-mail e senha.' });
      return;
    }

    const adminEmail = getAdminEmail();

    if (email === adminEmail && getConfiguredAdminPassword()) {
      if (!verifyEnvAdminPassword(password)) {
        res.status(401).json({ error: 'E-mail ou senha incorretos.' });
        return;
      }
      let adminUser = getUserByEmail(adminEmail);
      if (!adminUser) {
        const created = createUserRecord({
          name: 'Administrador R&P',
          email: adminEmail,
          whatsapp: '',
          passwordHash: hashPassword(password),
          role: 'admin',
        });
        const token = signSessionToken(created);
        setSessionCookie(res, token);
        res.json({ user: created, token });
        return;
      }
      const { passwordHash: _ph, ...safeUser } = adminUser;
      const token = signSessionToken(safeUser);
      setSessionCookie(res, token);
      res.json({ user: safeUser, token });
      return;
    }

    const record = getUserByEmail(email);
    if (!record || !verifyPassword(password, record.passwordHash)) {
      res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      return;
    }
    if (record.active === false) {
      res.status(403).json({ error: 'Sua conta foi desativada pelo administrador.' });
      return;
    }

    const { passwordHash: _ph, ...user } = record;
    const token = signSessionToken(user);
    setSessionCookie(res, token);
    res.json({ user, token });
  });

  // Password recovery rate limiter (per IP & email, max 5 requests per 15 min)
  const forgotRateMap = new Map<string, number[]>();
  function isForgotRateLimited(key: string): boolean {
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    const recent = (forgotRateMap.get(key) || []).filter((ts) => now - ts < windowMs);
    if (recent.length >= 5) {
      forgotRateMap.set(key, recent);
      return true;
    }
    recent.push(now);
    forgotRateMap.set(key, recent);
    return false;
  }

  function hashResetToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  function maskEmailHint(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return '***';
    const prefix = local.slice(0, 2);
    return `${prefix}${'*'.repeat(Math.max(2, local.length - 2))}@${domain}`;
  }

  function getPublicAppOrigin(req: express.Request): string {
    const envUrl = (process.env.APP_URL || '').trim();
    if (envUrl && /^https?:\/\//i.test(envUrl) && !envUrl.includes('MY_APP_URL')) {
      return envUrl.replace(/\/+$/, '');
    }
    const rawHost = (req.get('x-forwarded-host') || req.get('host') || 'localhost:3000')
      .split(',')[0]
      .trim()
      .replace(/[^a-zA-Z0-9.:-]/g, '');
    const rawProto = (req.get('x-forwarded-proto') || req.protocol || 'https')
      .split(',')[0]
      .trim();
    const proto = rawProto === 'http' ? 'http' : 'https';
    return `${proto}://${rawHost || 'localhost:3000'}`;
  }

  // Request password recovery link
  app.post('/api/auth/forgot-password', async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
      res.status(400).json({ error: 'Informe um e-mail válido.' });
      return;
    }

    const clientIp = (req.ip || 'unknown').slice(0, 64);
    if (isForgotRateLimited(`ip:${clientIp}`) || isForgotRateLimited(`email:${email}`)) {
      res.status(429).json({
        error: 'Muitas solicitações recentes. Aguarde alguns minutos antes de tentar novamente.',
      });
      return;
    }

    const neutralResponse = {
      ok: true,
      message:
        'Se o e-mail informado estiver cadastrado, enviaremos um link de recuperação para a sua caixa de entrada.',
    };

    const record = getUserByEmail(email);
    const isEnvLockedAdmin = email === getAdminEmail() && Boolean(getConfiguredAdminPassword());
    if (!record || record.active === false || isEnvLockedAdmin) {
      res.json(neutralResponse);
      return;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashResetToken(rawToken);
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    db.exec('BEGIN');
    try {
      db.prepare('UPDATE password_reset_tokens SET usedAt = ? WHERE userId = ? AND usedAt IS NULL').run(
        nowIso,
        record.id
      );
      db.prepare(
        'INSERT INTO password_reset_tokens (userId, tokenHash, expiresAt, createdAt) VALUES (?, ?, ?, ?)'
      ).run(record.id, tokenHash, expiresAt, nowIso);
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      console.error('Forgot password token storage error:', err);
      res.status(500).json({ error: 'Erro ao gerar solicitação de recuperação.' });
      return;
    }

    const resetUrl = `${getPublicAppOrigin(req)}/?resetToken=${encodeURIComponent(rawToken)}`;
    await sendPasswordResetEmail({
      toEmail: record.email,
      recipientName: record.name,
      resetUrl,
    });

    res.json(neutralResponse);
  });

  // Validate password recovery token before showing new-password form
  app.get('/api/auth/reset-password/validate', (req, res) => {
    const rawToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    if (!/^[a-f0-9]{64}$/i.test(rawToken)) {
      res.status(400).json({
        valid: false,
        error: 'Link de recuperação inválido ou expirado. Solicite um novo link.',
      });
      return;
    }

    const tokenHash = hashResetToken(rawToken);
    const nowIso = new Date().toISOString();
    const row = db
      .prepare(
        `SELECT t.id, t.expiresAt, t.usedAt, u.email, u.active
         FROM password_reset_tokens t
         JOIN users u ON u.id = t.userId
         WHERE t.tokenHash = ?`
      )
      .get(tokenHash) as
      | { id: number; expiresAt: string; usedAt: string | null; email: string; active: number }
      | undefined;

    if (!row || row.usedAt !== null || row.expiresAt <= nowIso || row.active === 0) {
      res.status(400).json({
        valid: false,
        error: 'Link de recuperação inválido ou expirado. Solicite um novo link.',
      });
      return;
    }

    res.json({ valid: true, emailHint: maskEmailHint(row.email) });
  });

  // Reset password using validated single-use token
  app.post('/api/auth/reset-password', (req, res) => {
    const rawToken = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const confirmPassword =
      typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';

    if (!/^[a-f0-9]{64}$/i.test(rawToken)) {
      res.status(400).json({
        error: 'Link de recuperação inválido ou expirado. Solicite um novo link.',
      });
      return;
    }
    if (password.length < 6 || password.length > 128) {
      res.status(400).json({ error: 'A nova senha deve ter entre 6 e 128 caracteres.' });
      return;
    }
    if (password !== confirmPassword) {
      res.status(400).json({ error: 'A confirmação de senha não confere.' });
      return;
    }

    const tokenHash = hashResetToken(rawToken);
    const nowIso = new Date().toISOString();

    db.exec('BEGIN');
    try {
      const row = db
        .prepare(
          `SELECT t.id, t.userId, t.expiresAt, t.usedAt, u.active
           FROM password_reset_tokens t
           JOIN users u ON u.id = t.userId
           WHERE t.tokenHash = ?`
        )
        .get(tokenHash) as
        | { id: number; userId: number; expiresAt: string; usedAt: string | null; active: number }
        | undefined;

      if (!row || row.usedAt !== null || row.expiresAt <= nowIso || row.active === 0) {
        db.exec('ROLLBACK');
        res.status(400).json({
          error: 'Link de recuperação inválido ou expirado. Solicite um novo link.',
        });
        return;
      }

      const newHash = hashPassword(password);
      db.prepare('UPDATE users SET passwordHash = ? WHERE id = ?').run(newHash, row.userId);
      db.prepare('UPDATE password_reset_tokens SET usedAt = ? WHERE userId = ? AND usedAt IS NULL').run(
        nowIso,
        row.userId
      );
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      console.error('Reset password error:', err);
      res.status(500).json({ error: 'Erro ao redefinir a senha. Tente novamente.' });
      return;
    }

    clearSessionCookie(res);
    res.json({
      ok: true,
      message: 'Senha alterada com sucesso! Agora você já pode entrar com a nova senha.',
    });
  });

  // Logout
  app.post('/api/auth/logout', (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // Current user
  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    res.json({ user: req.authUser });
  });

  // Silent session renewal (keeps admin and customer sessions active across long edits)
  app.post('/api/auth/refresh', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const freshToken = signSessionToken(user);
    setSessionCookie(res, freshToken);
    res.json({ user, token: freshToken });
  });

  // Real-time SSE notifications for automatic roulette, order status & delivery tracking sync
  app.get('/api/events', requireAuth, (req: AuthenticatedRequest, res) => {
    const authUser = req.authUser!;
    const userId = authUser.id;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    if (!sseClients.has(userId)) {
      sseClients.set(userId, new Set());
    }
    sseClients.get(userId)!.add(res);
    if (authUser.role === 'admin') {
      sseAdminUserIds.add(userId);
    }

    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);

    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(keepAlive);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.get(userId)?.delete(res);
      if ((sseClients.get(userId)?.size ?? 0) === 0 && authUser.role === 'admin') {
        sseAdminUserIds.delete(userId);
      }
    });
  });

  // Update customer profile (name, phone/whatsapp, cpf, savedAddress)
  app.put('/api/account/profile', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : user.name;
    const whatsapp = typeof req.body?.whatsapp === 'string' ? req.body.whatsapp.trim() : '';
    const cpf = typeof req.body?.cpf === 'string' ? req.body.cpf.trim() : '';
    const addr = req.body?.savedAddress;

    if (name.length < 2) {
      res.status(400).json({ error: 'Informe seu nome completo.' });
      return;
    }

    let addressJson: string | null = null;
    if (addr && typeof addr === 'object') {
      const cleanAddress: DeliveryAddress = {
        street: typeof addr.street === 'string' ? addr.street.trim() : '',
        number: typeof addr.number === 'string' ? addr.number.trim() : '',
        neighborhood: typeof addr.neighborhood === 'string' ? addr.neighborhood.trim() : '',
        cep: typeof addr.cep === 'string' ? addr.cep.trim() : '',
        complement: typeof addr.complement === 'string' ? addr.complement.trim() : '',
      };
      if (
        cleanAddress.cep ||
        cleanAddress.street ||
        cleanAddress.number ||
        cleanAddress.neighborhood ||
        cleanAddress.complement
      ) {
        addressJson = JSON.stringify(cleanAddress);
      }
    }

    db.prepare('UPDATE users SET name = ?, whatsapp = ?, cpf = ?, addressJson = ? WHERE id = ?').run(
      name,
      whatsapp,
      cpf,
      addressJson,
      user.id
    );

    const updated = getUserById(user.id);
    res.json({ user: updated });
  });

  // Mark welcome first-purchase campaign as seen for the authenticated user
  app.post('/api/account/welcome-seen', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const updated = markUserWelcomeSeen(user.id);
    res.json({ user: updated });
  });

  // CEP lookup for instant address auto-fill
  app.get('/api/cep/:cep', requireAuth, async (req, res) => {
    const rawCep = String(req.params.cep || '');
    const cleanCep = rawCep.replace(/\D/g, '');
    if (!/^\d{8}$/.test(cleanCep)) {
      res.status(400).json({ error: 'CEP inválido.' });
      return;
    }
    const result = await lookupBrazilianCep(cleanCep);
    if (!result) {
      res.status(404).json({ error: 'CEP não encontrado.' });
      return;
    }
    res.json(result);
  });

  // Storefront Data (always dynamic from Supabase when configured, never cached)
  app.get('/api/store', requireAuth, async (_req, res) => {
    try {
      const [allProducts, slides] = await Promise.all([
        listProductsPersistent(true),
        listSlidesPersistent(true),
      ]);
      const settingsRow = db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;

      const products = allProducts.map((p) => {
        const {
          costPrice: _c,
          freightCostUnit: _f,
          packagingCostUnit: _pk,
          otherCostUnit: _o,
          purchasedQuantity: _pq,
          archived: _ar,
          archivedAt: _aa,
          ...publicProd
        } = p;
        return publicProd;
      });
      const categories = ['Todos', ...Array.from(new Set(products.map((p) => p.category)))];

      res.json({
        products,
        categories,
        slides,
        settings: mapSettingsRow(settingsRow),
      });
    } catch (err) {
      console.error('Load storefront error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Erro ao carregar produtos da loja.',
      });
    }
  });

  // Customer product suggestion box (verified server-side user identity)
  app.post('/api/suggestions', requireAuth, (req: AuthenticatedRequest, res) => {
    const authUser = req.authUser!;
    const rawSuggestion = typeof req.body?.suggestion === 'string' ? req.body.suggestion.trim() : '';
    if (rawSuggestion.length < 3 || rawSuggestion.length > 500) {
      res.status(400).json({
        error: 'Escreva uma sugestão com pelo menos 3 caracteres (máximo 500).',
      });
      return;
    }

    const now = new Date().toISOString();
    const result = db
      .prepare(
        `INSERT INTO product_suggestions (userId, customerName, customerEmail, suggestion, createdAt)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(authUser.id, authUser.name, authUser.email, rawSuggestion, now);

    const row = db
      .prepare('SELECT * FROM product_suggestions WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as Record<string, unknown>;
    const suggestion = mapSuggestionRow(row);
    pushAdminEvent('store_updated', { entity: 'suggestions', action: 'created', suggestionId: suggestion.id });
    res.status(201).json({ suggestion });
  });

  // Shipping distance & price estimation
  app.post('/api/shipping/estimate', requireAuth, async (req, res) => {
    const cep = typeof req.body?.cep === 'string' ? req.body.cep.trim() : '';
    const subtotalAfterDiscount = Math.max(0, Number(req.body?.subtotalAfterDiscount || 0));
    const deliveryMethod =
      req.body?.deliveryMethod === 'Retirada na loja' ? 'Retirada na loja' : 'Entrega';
    const freeShippingByCoupon = Boolean(req.body?.freeShippingByCoupon);
    const rawCoords = req.body?.coords;
    const coords: Coordinates | null =
      rawCoords && Number.isFinite(Number(rawCoords.lat)) && Number.isFinite(Number(rawCoords.lng))
        ? { lat: Number(rawCoords.lat), lng: Number(rawCoords.lng) }
        : null;

    const settingsRow = db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;
    const settings = mapSettingsRow(settingsRow);

    const estimate = await computeShipping(
      subtotalAfterDiscount,
      deliveryMethod,
      settings,
      cep,
      coords,
      freeShippingByCoupon
    );
    res.json(estimate);
  });

  // RZIN AI Essence Consultant chat
  app.post('/api/rzin/chat', requireAuth, async (req: AuthenticatedRequest, res) => {
    const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const cleaned: RzinInputMessage[] = rawMessages
      .slice(-20)
      .map((m: unknown) => {
        const obj = (m && typeof m === 'object' ? m : {}) as { role?: unknown; text?: unknown };
        const role: 'user' | 'model' = obj.role === 'model' ? 'model' : 'user';
        const text = typeof obj.text === 'string' ? obj.text.trim().slice(0, 2000) : '';
        return { role, text };
      })
      .filter((m: RzinInputMessage) => m.text.length > 0);

    if (cleaned.length === 0 || cleaned[cleaned.length - 1].role !== 'user') {
      res.status(400).json({ error: 'Envie uma mensagem para conversar com o RZIN.' });
      return;
    }

    try {
      const result = await runRzinChat(cleaned);
      res.json(result);
    } catch (err: unknown) {
      console.error('RZIN chat error:', err);
      const message =
        err instanceof Error ? err.message : 'Erro ao consultar o assistente RZIN.';
      const status =
        message.includes('GEMINI_API_KEY')
          ? 503
          : typeof err === 'object' && err !== null && 'status' in err && Number((err as { status?: unknown }).status) === 429
            ? 429
            : 500;
      res.status(status).json({ error: message });
    }
  });

  // Validate discount / free-shipping coupon
  app.post('/api/coupons/validate', requireAuth, (req: AuthenticatedRequest, res) => {
    expireOldCoupons();
    const user = req.authUser!;
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    const subtotal = Number(req.body?.subtotal || 0);

    if (!code) {
      res.status(400).json({ valid: false, message: 'Informe um código de cupom.' });
      return;
    }

    const row = db.prepare('SELECT * FROM coupons WHERE upper(code) = ?').get(code) as
      | Record<string, unknown>
      | undefined;

    if (!row) {
      res.status(404).json({ valid: false, message: 'Cupom não encontrado.' });
      return;
    }

    const coupon = mapCouponRow(row);
    const evaluation = evaluateCouponForUser(coupon, user, subtotal, new Date().toISOString());
    if (evaluation.ok === false) {
      res.status(evaluation.status).json({ valid: false, message: evaluation.message });
      return;
    }

    res.json({
      valid: true,
      coupon,
      discountAmount: evaluation.discountAmount,
      message: evaluation.message,
    });
  });

  // Create order
  app.post('/api/orders', requireAuth, async (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const settingsRow = db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;
    const settings = mapSettingsRow(settingsRow);

    if (!settings.storeOpen) {
      res.status(400).json({
        error: settings.closedMessage || 'A loja está fechada no momento e não está recebendo pedidos.',
      });
      return;
    }

    const customerName = typeof req.body?.customerName === 'string' ? req.body.customerName.trim() : '';
    const customerWhatsapp =
      typeof req.body?.customerWhatsapp === 'string' ? req.body.customerWhatsapp.trim() : '';
    const customerCpf = typeof req.body?.customerCpf === 'string' ? req.body.customerCpf.trim() : '';
    const deliveryMethod =
      req.body?.deliveryMethod === 'Retirada na loja' ? 'Retirada na loja' : 'Entrega';
    const paymentMethod = req.body?.paymentMethod as PaymentMethod;
    const changeFor = typeof req.body?.changeFor === 'string' ? req.body.changeFor.trim() : '';
    const couponCodeInput =
      typeof req.body?.couponCode === 'string' ? req.body.couponCode.trim().toUpperCase() : '';
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim().slice(0, 500) : '';
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const rawCoords = req.body?.coords;
    const coords: Coordinates | null =
      rawCoords && Number.isFinite(Number(rawCoords.lat)) && Number.isFinite(Number(rawCoords.lng))
        ? { lat: Number(rawCoords.lat), lng: Number(rawCoords.lng) }
        : null;

    if (rawItems.length === 0) {
      res.status(400).json({ error: 'Seu carrinho está vazio.' });
      return;
    }
    if (customerName.length < 3) {
      res.status(400).json({ error: 'Informe seu nome completo.' });
      return;
    }
    const whatsappDigits = customerWhatsapp.replace(/\D/g, '');
    if (whatsappDigits.length < 10 || whatsappDigits.length > 13) {
      res.status(400).json({ error: 'Informe um WhatsApp válido com DDD.' });
      return;
    }
    if (!VALID_PAYMENTS.includes(paymentMethod)) {
      res.status(400).json({ error: 'Selecione uma forma de pagamento.' });
      return;
    }

    let address: DeliveryAddress | null = null;
    if (deliveryMethod === 'Entrega') {
      const addr = req.body?.address || {};
      const street = typeof addr.street === 'string' ? addr.street.trim() : '';
      const number = typeof addr.number === 'string' ? addr.number.trim() : '';
      const neighborhood = typeof addr.neighborhood === 'string' ? addr.neighborhood.trim() : '';
      const cep = typeof addr.cep === 'string' ? addr.cep.trim() : '';
      const complement = typeof addr.complement === 'string' ? addr.complement.trim() : '';

      if (!street || !number || !neighborhood || cep.replace(/\D/g, '').length < 8) {
        res.status(400).json({ error: 'Preencha Rua, Número, Bairro e CEP válido para entrega.' });
        return;
      }
      address = { street, number, neighborhood, cep, complement };
    }

    const verifiedItems: CartItem[] = [];
    let subtotal = 0;

    for (const item of rawItems) {
      const productId = Number(item?.productId);
      const quantity = Math.floor(Number(item?.quantity));
      const variation = typeof item?.variation === 'string' ? item.variation.trim() : '';
      if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        res.status(400).json({ error: 'Item inválido no carrinho.' });
        return;
      }

      const productRow = db
        .prepare('SELECT * FROM products WHERE id = ? AND active = 1 AND archived = 0')
        .get(productId) as
        | Record<string, unknown>
        | undefined;
      if (!productRow) {
        res.status(400).json({ error: 'Um dos produtos do carrinho não está mais disponível.' });
        return;
      }
      const product = mapProductRow(productRow);

      if (product.variations.length > 0 && (!variation || variation === 'Padrão')) {
        res.status(400).json({ error: `Escolha uma opção obrigatória para "${product.name}".` });
        return;
      }
      const { primary: primaryPart, secondary: secondaryPart } = splitVariationString(variation);
      if (product.variations.length > 0 && !product.variations.includes(primaryPart)) {
        res.status(400).json({ error: `Opção inválida selecionada para "${product.name}".` });
        return;
      }
      if ((product.secondaryVariations || []).length > 0) {
        if (!secondaryPart || !(product.secondaryVariations || []).includes(secondaryPart)) {
          res.status(400).json({ error: `Escolha a 2ª opção obrigatória para "${product.name}".` });
          return;
        }
      }

      const lineTotal = roundMoney(product.price * quantity);
      subtotal = roundMoney(subtotal + lineTotal);

      const defaultVariation =
        [product.variations[0], product.secondaryVariations?.[0]].filter(Boolean).join(' · ') || 'Padrão';

      const sanitizedDetails =
        item?.variationDetails && typeof item.variationDetails === 'object'
          ? {
              primaryLabel:
                typeof item.variationDetails.primaryLabel === 'string'
                  ? item.variationDetails.primaryLabel.trim().slice(0, 60)
                  : undefined,
              primaryValue:
                typeof item.variationDetails.primaryValue === 'string'
                  ? item.variationDetails.primaryValue.trim().slice(0, 80)
                  : undefined,
              secondaryLabel:
                typeof item.variationDetails.secondaryLabel === 'string'
                  ? item.variationDetails.secondaryLabel.trim().slice(0, 60)
                  : undefined,
              secondaryValue:
                typeof item.variationDetails.secondaryValue === 'string'
                  ? item.variationDetails.secondaryValue.trim().slice(0, 80)
                  : undefined,
            }
          : undefined;

      verifiedItems.push({
        productId: product.id,
        name: product.name,
        price: product.price,
        imageUrl: product.imageUrl,
        variation: variation || defaultVariation,
        ...(sanitizedDetails ? { variationDetails: sanitizedDetails } : {}),
        quantity,
      });
    }

    if (deliveryMethod === 'Entrega' && settings.minDeliveryOrder > 0 && subtotal < settings.minDeliveryOrder) {
      res.status(400).json({
        error: `Pedido mínimo para entrega é de R$ ${settings.minDeliveryOrder.toFixed(2).replace('.', ',')}.`,
      });
      return;
    }

    const preStockCheck = validateOrderItemsStock(verifiedItems);
    if (preStockCheck.ok === false) {
      res.status(400).json({ error: preStockCheck.error });
      return;
    }

    let discountAmount = 0;
    let appliedCouponId: number | null = null;
    let appliedCouponCode: string | null = null;
    let freeShippingByCoupon = false;

    if (couponCodeInput) {
      expireOldCoupons();
      const nowOrderIso = new Date().toISOString();
      const couponRow = db.prepare('SELECT * FROM coupons WHERE upper(code) = ?').get(couponCodeInput) as
        | Record<string, unknown>
        | undefined;
      if (!couponRow) {
        res.status(400).json({ error: 'O cupom informado não existe mais.' });
        return;
      }
      const coupon = mapCouponRow(couponRow);
      const evaluation = evaluateCouponForUser(coupon, user, subtotal, nowOrderIso);
      if (evaluation.ok === false) {
        res.status(evaluation.status).json({ error: evaluation.message });
        return;
      }
      appliedCouponId = coupon.id;
      appliedCouponCode = coupon.code;
      discountAmount = evaluation.discountAmount;
      freeShippingByCoupon = evaluation.freeShipping;
    }

    const subtotalAfterDiscount = Math.max(0, roundMoney(subtotal - discountAmount));
    const { distanceKm, shippingFee, shippingLabel } = await computeShipping(
      subtotalAfterDiscount,
      deliveryMethod,
      settings,
      address?.cep || '',
      coords,
      freeShippingByCoupon
    );
    const total = roundMoney(subtotalAfterDiscount + (shippingFee ?? 0));
    const destCoords =
      deliveryMethod === 'Entrega' ? await geocodeDeliveryAddress(address, coords) : null;

    let createdRow: Record<string, unknown>;
    db.exec('BEGIN IMMEDIATE');
    try {
      const txStockCheck = validateOrderItemsStock(verifiedItems);
      if (txStockCheck.ok === false) {
        db.exec('ROLLBACK');
        res.status(400).json({ error: txStockCheck.error });
        return;
      }

      const now = new Date().toISOString();
      if (appliedCouponId !== null) {
        const freshRow = db.prepare('SELECT * FROM coupons WHERE id = ?').get(appliedCouponId) as
          | Record<string, unknown>
          | undefined;
        if (!freshRow) {
          db.exec('ROLLBACK');
          res.status(400).json({ error: 'O cupom informado não está mais disponível.' });
          return;
        }
        const freshCoupon = mapCouponRow(freshRow);
        const freshEval = evaluateCouponForUser(freshCoupon, user, subtotal, now);
        if (freshEval.ok === false) {
          db.exec('ROLLBACK');
          res.status(freshEval.status).json({ error: freshEval.message });
          return;
        }
        db.prepare('UPDATE coupons SET usageCount = usageCount + 1 WHERE id = ?').run(freshCoupon.id);
        if (freshCoupon.maxUses !== null && freshCoupon.usageCount + 1 >= freshCoupon.maxUses) {
          db.prepare('UPDATE coupons SET active = 0 WHERE id = ?').run(freshCoupon.id);
        }
      }

      const maxOrderRow = db.prepare('SELECT COALESCE(MAX(orderNumber), 1000) as maxNum FROM orders').get() as {
        maxNum: number;
      };
      const nextOrderNumber = Number(maxOrderRow.maxNum) + 1;

      const insertResult = db
        .prepare(`
          INSERT INTO orders (
            orderNumber, userId, customerName, customerWhatsapp, customerCpf,
            deliveryMethod, addressJson, distanceKm, destLat, destLng, paymentMethod, changeFor, itemsJson,
            subtotal, discountAmount, couponCode, shippingFee, shippingLabel, total,
            status, rouletteGranted, notes, createdAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendente', 0, ?, ?)
        `)
        .run(
          nextOrderNumber,
          user.id,
          customerName,
          customerWhatsapp,
          customerCpf,
          deliveryMethod,
          address ? JSON.stringify(address) : null,
          distanceKm,
          destCoords ? destCoords.lat : null,
          destCoords ? destCoords.lng : null,
          paymentMethod,
          paymentMethod === 'Dinheiro' ? changeFor : '',
          JSON.stringify(verifiedItems),
          subtotal,
          discountAmount,
          appliedCouponCode,
          shippingFee,
          shippingLabel,
          total,
          notes,
          now
        );

      const newOrderId = Number(insertResult.lastInsertRowid);
      if (appliedCouponId !== null) {
        recordCouponUsage(appliedCouponId, user.id, newOrderId, now);
      }

      createdRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(newOrderId) as Record<string, unknown>;
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore rollback failure
      }
      throw err;
    }

    const createdOrder = mapOrderRow(createdRow);
    void syncOrderToSupabase(createdOrder, user.email);
    pushAdminEvent('order_updated', {
      orderId: createdOrder.id,
      orderNumber: createdOrder.orderNumber,
      status: createdOrder.status,
    });

    res.status(201).json({ order: createdOrder });
  });

  // Customer's own orders
  app.get('/api/orders/mine', requireAuth, (req: AuthenticatedRequest, res) => {
    const rows = db
      .prepare('SELECT * FROM orders WHERE userId = ? ORDER BY id DESC')
      .all(req.authUser!.id) as Record<string, unknown>[];
    res.json({ orders: rows.map(mapOrderRow) });
  });

  // Real-time delivery tracking info (strictly restricted to order owner, assigned courier, or admin)
  app.get('/api/orders/:id/tracking', requireAuth, async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Pedido inválido.' });
      return;
    }

    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Pedido não encontrado.' });
      return;
    }

    const order = mapOrderRow(row);
    const authUser = req.authUser!;
    const isOwner = order.userId === authUser.id;
    const isAdmin = authUser.role === 'admin';
    const isAssignedCourier = authUser.role === 'courier' && order.assignedCourierId === authUser.id;

    if (!isOwner && !isAdmin && !isAssignedCourier) {
      res.status(403).json({ error: 'Você não tem permissão para acompanhar este pedido.' });
      return;
    }

    if (order.deliveryMethod !== 'Entrega') {
      res.status(400).json({ error: 'Rastreamento disponível apenas para pedidos de entrega.' });
      return;
    }

    let currentRow = row;
    if (!order.destCoords && order.address) {
      const geocoded = await geocodeDeliveryAddress(order.address);
      if (geocoded) {
        db.prepare('UPDATE orders SET destLat = ?, destLng = ? WHERE id = ?').run(
          geocoded.lat,
          geocoded.lng,
          id
        );
        currentRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Record<string, unknown>;
      }
    }

    const settingsRow = db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;
    const settings = mapSettingsRow(settingsRow);
    res.json({ tracking: mapDeliveryTrackingInfo(currentRow, settings) });
  });

  // ================= COURIER (MOTOBOY) DELIVERY TRACKING ROUTES =================

  app.get('/api/courier/orders', requireAuth, requireCourier, (req: AuthenticatedRequest, res) => {
    const courierId = req.authUser!.id;
    const rows = db
      .prepare(
        `SELECT * FROM orders
         WHERE assignedCourierId = ? AND deliveryMethod = 'Entrega'
         ORDER BY CASE WHEN status = 'Saiu para entrega' THEN 0 ELSE 1 END, id DESC`
      )
      .all(courierId) as Record<string, unknown>[];
    res.json({ orders: rows.map(mapOrderRow) });
  });

  app.post('/api/courier/orders/:id/tracking/start', requireAuth, requireCourier, async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Pedido inválido.' });
      return;
    }

    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Pedido não encontrado.' });
      return;
    }

    const order = mapOrderRow(row);
    if (order.assignedCourierId !== req.authUser!.id) {
      res.status(403).json({ error: 'Esta entrega não está atribuída a você.' });
      return;
    }
    if (order.deliveryMethod !== 'Entrega' || order.status !== 'Saiu para entrega') {
      res.status(400).json({
        error: 'O compartilhamento só pode ser iniciado quando o pedido estiver com status "Saiu para entrega".',
      });
      return;
    }

    if (!order.destCoords && order.address) {
      const geocoded = await geocodeDeliveryAddress(order.address);
      if (geocoded) {
        db.prepare('UPDATE orders SET destLat = ?, destLng = ? WHERE id = ?').run(
          geocoded.lat,
          geocoded.lng,
          id
        );
      }
    }

    const nextGpsStatus = order.courierGpsStatus === 'active' ? 'active' : 'waiting';
    db.prepare('UPDATE orders SET trackingActive = 1, courierGpsStatus = ? WHERE id = ?').run(nextGpsStatus, id);

    const updatedRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Record<string, unknown>;
    const settingsRow = db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;
    const tracking = mapDeliveryTrackingInfo(updatedRow, mapSettingsRow(settingsRow));

    pushUserEvent(order.userId, 'tracking_updated', tracking);
    pushUserEvent(req.authUser!.id, 'tracking_updated', tracking);
    pushAdminEvent('tracking_updated', tracking);

    res.json({ tracking });
  });

  app.post('/api/courier/orders/:id/location', requireAuth, requireCourier, (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Pedido inválido.' });
      return;
    }

    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Pedido não encontrado.' });
      return;
    }

    const order = mapOrderRow(row);
    if (order.assignedCourierId !== req.authUser!.id) {
      res.status(403).json({ error: 'Você só pode enviar localização para entregas atribuídas a você.' });
      return;
    }
    if (order.deliveryMethod !== 'Entrega' || order.status !== 'Saiu para entrega') {
      res.status(400).json({ error: 'Rastreamento encerrado ou pedido ainda não saiu para entrega.' });
      return;
    }

    const requestedStatus = typeof req.body?.gpsStatus === 'string' ? req.body.gpsStatus : '';
    if (requestedStatus === 'unavailable') {
      db.prepare("UPDATE orders SET trackingActive = 1, courierGpsStatus = 'unavailable' WHERE id = ?").run(id);
      const updatedRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Record<string, unknown>;
      const settingsRow = db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;
      const tracking = mapDeliveryTrackingInfo(updatedRow, mapSettingsRow(settingsRow));

      pushUserEvent(order.userId, 'tracking_updated', tracking);
      pushUserEvent(req.authUser!.id, 'tracking_updated', tracking);
      pushAdminEvent('tracking_updated', tracking);

      res.json({ tracking });
      return;
    }

    const coords = validateGpsCoordinates(req.body?.lat, req.body?.lng);
    if (!coords) {
      res.status(400).json({ error: 'Coordenadas de GPS inválidas.' });
      return;
    }

    const accuracy = Number.isFinite(Number(req.body?.accuracy)) ? Math.max(0, Number(req.body.accuracy)) : null;
    const heading = Number.isFinite(Number(req.body?.heading)) ? Number(req.body.heading) : null;
    const speed = Number.isFinite(Number(req.body?.speed)) ? Math.max(0, Number(req.body.speed)) : null;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE orders SET
        trackingActive = 1,
        courierLat = ?,
        courierLng = ?,
        courierAccuracy = ?,
        courierHeading = ?,
        courierSpeed = ?,
        courierGpsStatus = 'active',
        lastLocationAt = ?
      WHERE id = ?
    `).run(coords.lat, coords.lng, accuracy, heading, speed, now, id);

    db.prepare(`
      INSERT INTO delivery_tracking_points (orderId, courierId, lat, lng, accuracy, heading, speed, recordedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.authUser!.id, coords.lat, coords.lng, accuracy, heading, speed, now);

    const updatedRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Record<string, unknown>;
    const settingsRow = db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;
    const tracking = mapDeliveryTrackingInfo(updatedRow, mapSettingsRow(settingsRow));

    pushUserEvent(order.userId, 'tracking_updated', tracking);
    pushUserEvent(req.authUser!.id, 'tracking_updated', tracking);
    pushAdminEvent('tracking_updated', tracking);

    res.json({ tracking });
  });

  app.post('/api/courier/orders/:id/tracking/stop', requireAuth, requireCourier, (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Pedido inválido.' });
      return;
    }

    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Pedido não encontrado.' });
      return;
    }

    const order = mapOrderRow(row);
    if (order.assignedCourierId !== req.authUser!.id) {
      res.status(403).json({ error: 'Esta entrega não está atribuída a você.' });
      return;
    }

    const markDelivered = Boolean(req.body?.markDelivered);
    const now = new Date().toISOString();

    if (markDelivered) {
      db.prepare(`
        UPDATE orders SET
          status = 'Entregue',
          trackingActive = 0,
          courierGpsStatus = 'ended',
          deliveredAt = COALESCE(deliveredAt, ?)
        WHERE id = ?
      `).run(now, id);
    } else {
      db.prepare("UPDATE orders SET courierGpsStatus = 'unavailable' WHERE id = ?").run(id);
    }

    const updatedRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Record<string, unknown>;
    const updatedOrder = mapOrderRow(updatedRow);
    const settingsRow = db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;
    const tracking = mapDeliveryTrackingInfo(updatedRow, mapSettingsRow(settingsRow));

    if (markDelivered) {
      const statusPayload = {
        orderId: updatedOrder.id,
        orderNumber: updatedOrder.orderNumber,
        status: updatedOrder.status,
      };
      pushUserEvent(updatedOrder.userId, 'order_updated', statusPayload);
      pushUserEvent(req.authUser!.id, 'order_updated', statusPayload);
      pushAdminEvent('order_updated', statusPayload);
    }

    pushUserEvent(updatedOrder.userId, 'tracking_updated', tracking);
    pushUserEvent(req.authUser!.id, 'tracking_updated', tracking);
    pushAdminEvent('tracking_updated', tracking);

    res.json({ order: updatedOrder, tracking });
  });

  // ================= CUSTOMER ROULETTE ROUTES =================

  app.get('/api/roulette', requireAuth, (req: AuthenticatedRequest, res) => {
    res.json(getUserRouletteState(req.authUser!.id));
  });

  app.post('/api/roulette/spin', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const nowIso = new Date().toISOString();

    db.exec('BEGIN IMMEDIATE');
    try {
      expireOldChances(user.id);

      const availableChanceRow = db
        .prepare(
          "SELECT * FROM roulette_chances WHERE userId = ? AND status = 'available' AND expiresAt > ? ORDER BY expiresAt ASC, id ASC LIMIT 1"
        )
        .get(user.id, nowIso) as Record<string, unknown> | undefined;

      if (!availableChanceRow) {
        db.exec('ROLLBACK');
        res.status(400).json({ error: 'Você não possui chances disponíveis para girar a roleta.' });
        return;
      }

      const chanceId = Number(availableChanceRow.id);
      const consumeResult = db
        .prepare(
          "UPDATE roulette_chances SET status = 'used', usedAt = ? WHERE id = ? AND status = 'available'"
        )
        .run(nowIso, chanceId);

      if (consumeResult.changes !== 1) {
        db.exec('ROLLBACK');
        res.status(409).json({ error: 'Esta chance já foi utilizada.' });
        return;
      }

      const prizeRows = db
        .prepare('SELECT * FROM roulette_prizes WHERE active = 1 ORDER BY sortOrder ASC, id ASC')
        .all() as Record<string, unknown>[];
      const prizes = prizeRows.map(mapPrizeRow);
      if (prizes.length === 0) {
        db.exec('ROLLBACK');
        res.status(500).json({ error: 'Nenhum prêmio ativo configurado na roleta.' });
        return;
      }

      const { prize, index } = pickWeightedPrize(prizes);
      let generatedCouponCode: string | null = null;
      let couponExpiresAt: string | null = null;

      if (prize.prizeType === 'free_shipping' || prize.prizeType === 'percent') {
        let candidate = generatePrizeCouponCode(prize);
        while (db.prepare('SELECT id FROM coupons WHERE upper(code) = ?').get(candidate)) {
          candidate = generatePrizeCouponCode(prize);
        }
        generatedCouponCode = candidate;
        couponExpiresAt = new Date(Date.now() + ROULETTE_COUPON_VALIDITY_MS).toISOString();
        const discountType = prize.prizeType === 'free_shipping' ? 'free_shipping' : 'percent';
        const discountValue = prize.prizeType === 'free_shipping' ? 0 : prize.discountValue;
        const freeShipping = prize.prizeType === 'free_shipping' ? 1 : 0;

        db.prepare(`
          INSERT INTO coupons (
            code, discountType, discountValue, minOrderValue, freeShipping,
            ownerUserId, allowMultipleUses, maxUses, expiresAt, active, usageCount, createdAt
          ) VALUES (?, ?, ?, 0, ?, ?, 0, 1, ?, 1, 0, ?)
        `).run(generatedCouponCode, discountType, discountValue, freeShipping, user.id, couponExpiresAt, nowIso);
      }

      const spinInsert = db
        .prepare(`
          INSERT INTO roulette_spins (userId, userName, chanceId, prizeId, prizeLabel, prizeType, couponCode, couponExpiresAt, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          user.id,
          user.name,
          chanceId,
          prize.id,
          prize.label,
          prize.prizeType,
          generatedCouponCode,
          couponExpiresAt,
          nowIso
        );

      const spinRow = db
        .prepare('SELECT * FROM roulette_spins WHERE id = ?')
        .get(Number(spinInsert.lastInsertRowid)) as Record<string, unknown>;

      db.exec('COMMIT');

      const state = getUserRouletteState(user.id);
      res.json({
        prize,
        prizeIndex: index,
        couponCode: generatedCouponCode,
        couponExpiresAt,
        spin: mapSpinRow(spinRow),
        state,
      });
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      console.error('Roulette spin error:', err);
      res.status(500).json({ error: 'Erro ao processar giro da roleta.' });
    }
  });

  // ================= ADMIN ROUTES =================

  app.get('/api/admin/overview', requireAuth, requireAdmin, async (_req, res) => {
    try {
      expireOldCoupons();
      const [products, slides, couriers] = await Promise.all([
        listProductsPersistent(false),
        listSlidesPersistent(false),
        listDriversPersistent(),
      ]);
      const coupons = (db.prepare('SELECT * FROM coupons ORDER BY id DESC').all() as Record<string, unknown>[]).map(
        mapCouponRow
      );
      const orders = (db.prepare('SELECT * FROM orders ORDER BY id DESC').all() as Record<string, unknown>[]).map(
        mapOrderRow
      );
      const settingsRow = db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;
      const customers = listCustomers();
      const suggestions = (
        db.prepare('SELECT * FROM product_suggestions ORDER BY id DESC LIMIT 300').all() as Record<string, unknown>[]
      ).map(mapSuggestionRow);

      res.json({
        products,
        coupons,
        slides,
        orders,
        couriers,
        customers,
        suggestions,
        settings: mapSettingsRow(settingsRow),
      });
    } catch (err) {
      console.error('Admin overview error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Erro ao carregar dados do painel administrativo.',
      });
    }
  });

  app.get('/api/admin/suggestions', requireAuth, requireAdmin, (_req, res) => {
    const suggestions = (
      db.prepare('SELECT * FROM product_suggestions ORDER BY id DESC LIMIT 300').all() as Record<string, unknown>[]
    ).map(mapSuggestionRow);
    res.json({ suggestions });
  });

  app.delete('/api/admin/suggestions/:id', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    const existing = db.prepare('SELECT id FROM product_suggestions WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Sugestão não encontrada.' });
      return;
    }
    db.prepare('DELETE FROM product_suggestions WHERE id = ?').run(id);
    pushAdminEvent('store_updated', { entity: 'suggestions', action: 'deleted', suggestionId: id });
    res.json({ deleted: true });
  });

  // Clientes Mais Fiéis (Admin-only server-side ranking, details & CSV export)
  app.get('/api/admin/loyal-customers', requireAuth, requireAdmin, (req, res) => {
    const rawPeriod = typeof req.query.period === 'string' ? req.query.period : 'all';
    const validPeriods = new Set(['today', '7d', '30d', 'current_month', 'all', 'custom']);
    const period = (validPeriods.has(rawPeriod) ? rawPeriod : 'all') as
      | 'today'
      | '7d'
      | '30d'
      | 'current_month'
      | 'all'
      | 'custom';

    const rawSort = typeof req.query.sortBy === 'string' ? req.query.sortBy : 'total_spent';
    const validSorts = new Set(['total_spent', 'orders_count', 'avg_ticket', 'last_order_at']);
    const sortBy = (validSorts.has(rawSort) ? rawSort : 'total_spent') as
      | 'total_spent'
      | 'orders_count'
      | 'avg_ticket'
      | 'last_order_at';

    const startDate = typeof req.query.startDate === 'string' ? req.query.startDate.trim() : undefined;
    const endDate = typeof req.query.endDate === 'string' ? req.query.endDate.trim() : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const neighborhood =
      typeof req.query.neighborhood === 'string' ? req.query.neighborhood.trim() : '';
    const inactiveOnly = req.query.inactiveOnly === 'true' || req.query.inactiveOnly === '1';
    const page = Math.max(1, Math.round(Number(req.query.page || 1) || 1));
    const pageSize = Math.min(100, Math.max(5, Math.round(Number(req.query.pageSize || 15) || 15)));

    const result = getLoyalCustomersOverview({
      period,
      startDate,
      endDate,
      sortBy,
      search,
      neighborhood,
      inactiveOnly,
      page,
      pageSize,
    });
    res.json(result);
  });

  app.get('/api/admin/loyal-customers/export', requireAuth, requireAdmin, (req, res) => {
    const rawPeriod = typeof req.query.period === 'string' ? req.query.period : 'all';
    const validPeriods = new Set(['today', '7d', '30d', 'current_month', 'all', 'custom']);
    const period = (validPeriods.has(rawPeriod) ? rawPeriod : 'all') as
      | 'today'
      | '7d'
      | '30d'
      | 'current_month'
      | 'all'
      | 'custom';

    const rawSort = typeof req.query.sortBy === 'string' ? req.query.sortBy : 'total_spent';
    const validSorts = new Set(['total_spent', 'orders_count', 'avg_ticket', 'last_order_at']);
    const sortBy = (validSorts.has(rawSort) ? rawSort : 'total_spent') as
      | 'total_spent'
      | 'orders_count'
      | 'avg_ticket'
      | 'last_order_at';

    const rows = getAllFilteredLoyalCustomersForExport({
      period,
      startDate: typeof req.query.startDate === 'string' ? req.query.startDate.trim() : undefined,
      endDate: typeof req.query.endDate === 'string' ? req.query.endDate.trim() : undefined,
      sortBy,
      search: typeof req.query.search === 'string' ? req.query.search.trim() : '',
      neighborhood:
        typeof req.query.neighborhood === 'string' ? req.query.neighborhood.trim() : '',
      inactiveOnly: req.query.inactiveOnly === 'true' || req.query.inactiveOnly === '1',
    });

    const csv = buildLoyalCustomersCsv(rows);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="clientes-mais-fieis-${stamp}.csv"`);
    res.send(csv);
  });

  app.get('/api/admin/loyal-customers/:userId', requireAuth, requireAdmin, (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      res.status(400).json({ error: 'ID de cliente inválido.' });
      return;
    }
    const detail = getLoyalCustomerDetail(userId);
    if (!detail) {
      res.status(404).json({ error: 'Cliente não encontrado.' });
      return;
    }
    res.json(detail);
  });

  // Admin Courier Accounts & Delivery Assignment
  app.get('/api/admin/couriers', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const couriers = await listDriversPersistent();
      res.json({ couriers });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Erro ao carregar motoboys.',
      });
    }
  });

  app.post('/api/admin/couriers', requireAuth, requireAdmin, async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const whatsapp = typeof req.body?.whatsapp === 'string' ? req.body.whatsapp.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (name.length < 2) {
      res.status(400).json({ error: 'Informe o nome do motoboy (mínimo 2 caracteres).' });
      return;
    }
    if (!email || !email.includes('@') || email.length > 160) {
      res.status(400).json({ error: 'Informe um e-mail válido para o motoboy.' });
      return;
    }
    if (password.length < 6 || password.length > 128) {
      res.status(400).json({ error: 'A senha do motoboy deve ter pelo menos 6 caracteres.' });
      return;
    }

    const existing = getUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: 'Já existe uma conta cadastrada com este e-mail.' });
      return;
    }

    const passwordHash = hashPassword(password);

    try {
      if (isSupabaseConfigured()) {
        const createdDriver = await createDriverPersistent({
          name,
          email,
          whatsapp,
          passwordHash,
        });
        pushAdminEvent('store_updated', { entity: 'couriers', action: 'created', courierId: createdDriver.id });
        res.status(201).json({ courier: createdDriver });
        return;
      }

      const created = createUserRecord({
        name,
        email,
        whatsapp,
        passwordHash,
        role: 'courier',
      });

      const courier = {
        id: created.id,
        name: created.name,
        email: created.email,
        whatsapp: created.whatsapp,
        active: created.active !== false,
        createdAt: created.createdAt,
      };
      pushAdminEvent('store_updated', { entity: 'couriers', action: 'created', courierId: courier.id });
      res.status(201).json({ courier });
    } catch (err) {
      console.error('Create courier error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Erro ao cadastrar motoboy no banco.',
      });
    }
  });

  app.patch('/api/admin/couriers/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    const existing = getUserById(id);
    if (!existing || existing.role !== 'courier') {
      res.status(404).json({ error: 'Motoboy não encontrado.' });
      return;
    }

    const active = req.body?.active !== false ? 1 : 0;
    try {
      if (isSupabaseConfigured()) {
        await updateDriverPersistent(existing.email, { active: active === 1 });
      }
      db.prepare("UPDATE users SET active = ? WHERE id = ? AND role = 'courier' AND COALESCE(archived, 0) = 0").run(
        active,
        id
      );
      const updated = getUserById(id)!;
      pushAdminEvent('store_updated', { entity: 'couriers', action: 'toggled', courierId: id });
      res.json({
        courier: {
          id: updated.id,
          name: updated.name,
          email: updated.email,
          whatsapp: updated.whatsapp,
          active: updated.active !== false,
          createdAt: updated.createdAt,
        },
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Erro ao atualizar motoboy.',
      });
    }
  });

  app.put('/api/admin/couriers/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    const existing = getUserById(id);
    if (!existing || existing.role !== 'courier') {
      res.status(404).json({ error: 'Motoboy não encontrado.' });
      return;
    }

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const whatsapp = typeof req.body?.whatsapp === 'string' ? req.body.whatsapp.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const active = req.body?.active !== false ? 1 : 0;

    if (name.length < 2) {
      res.status(400).json({ error: 'Informe o nome do motoboy (mínimo 2 caracteres).' });
      return;
    }
    if (!email || !email.includes('@') || email.length > 160) {
      res.status(400).json({ error: 'Informe um e-mail válido para o motoboy.' });
      return;
    }
    if (password && (password.length < 6 || password.length > 128)) {
      res.status(400).json({ error: 'A nova senha do motoboy deve ter pelo menos 6 caracteres.' });
      return;
    }

    const duplicate = getUserByEmail(email);
    if (duplicate && duplicate.id !== id) {
      res.status(409).json({ error: 'Já existe outra conta cadastrada com este e-mail.' });
      return;
    }

    const nextHash = password ? hashPassword(password) : undefined;

    try {
      if (isSupabaseConfigured()) {
        await updateDriverPersistent(existing.email, {
          name,
          email,
          whatsapp,
          active: active === 1,
          passwordHash: nextHash,
        });
      }

      if (nextHash) {
        db.prepare(
          "UPDATE users SET name = ?, email = ?, whatsapp = ?, active = ?, passwordHash = ? WHERE id = ? AND role = 'courier'"
        ).run(name, email, whatsapp, active, nextHash, id);
      } else {
        db.prepare(
          "UPDATE users SET name = ?, email = ?, whatsapp = ?, active = ? WHERE id = ? AND role = 'courier'"
        ).run(name, email, whatsapp, active, id);
      }

      db.prepare(
        "UPDATE orders SET assignedCourierName = ? WHERE assignedCourierId = ? AND status NOT IN ('Entregue', 'Concluído', 'Cancelado')"
      ).run(name, id);

      const updated = getUserById(id)!;
      pushAdminEvent('store_updated', { entity: 'couriers', action: 'updated', courierId: id });
      res.json({
        courier: {
          id: updated.id,
          name: updated.name,
          email: updated.email,
          whatsapp: updated.whatsapp,
          active: updated.active !== false,
          createdAt: updated.createdAt,
        },
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Erro ao atualizar motoboy no banco.',
      });
    }
  });

  app.delete('/api/admin/couriers/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    const existing = getUserById(id);
    if (!existing || existing.role !== 'courier') {
      res.status(404).json({ error: 'Motoboy não encontrado.' });
      return;
    }

    const now = new Date().toISOString();
    const orderRef = db
      .prepare('SELECT 1 FROM orders WHERE assignedCourierId = ? LIMIT 1')
      .get(id);
    const trackingRef = db
      .prepare('SELECT 1 FROM delivery_tracking_points WHERE courierId = ? LIMIT 1')
      .get(id);
    const hasHistory = Boolean(orderRef || trackingRef);

    try {
      if (isSupabaseConfigured()) {
        await deleteDriverPersistent(existing.email, hasHistory);
      }

      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(
          "UPDATE orders SET assignedCourierId = NULL, assignedCourierName = '', trackingActive = 0 WHERE assignedCourierId = ? AND status NOT IN ('Entregue', 'Concluído', 'Cancelado')"
        ).run(id);

        if (hasHistory) {
          const archivedEmail = `archived_${id}_${Date.now()}_${existing.email}`;
          db.prepare(
            "UPDATE users SET archived = 1, active = 0, archivedAt = ?, email = ? WHERE id = ? AND role = 'courier'"
          ).run(now, archivedEmail, id);
        } else {
          db.prepare("DELETE FROM users WHERE id = ? AND role = 'courier'").run(id);
        }
        db.exec('COMMIT');
      } catch (innerErr) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // ignore
        }
        throw innerErr;
      }

      pushUserEvent(id, 'order_updated', { action: 'courier_removed' });
      pushAdminEvent('store_updated', { entity: 'couriers', action: 'deleted', courierId: id });
      res.json({ deleted: true, softDeleted: hasHistory });
    } catch (err) {
      console.error('Delete courier error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Erro ao excluir motoboy.',
      });
    }
  });

  app.patch('/api/admin/orders/:id/assign-courier', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Pedido inválido.' });
      return;
    }

    const existingRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existingRow) {
      res.status(404).json({ error: 'Pedido não encontrado.' });
      return;
    }

    const existingOrder = mapOrderRow(existingRow);
    const rawCourierId = req.body?.courierId;
    let assignedCourierId: number | null = null;
    let assignedCourierName = '';

    if (rawCourierId !== null && rawCourierId !== undefined && rawCourierId !== '') {
      const courierId = Number(rawCourierId);
      if (!Number.isInteger(courierId)) {
        res.status(400).json({ error: 'Motoboy inválido.' });
        return;
      }
      const courier = getUserById(courierId);
      if (!courier || courier.role !== 'courier' || courier.active === false) {
        res.status(400).json({ error: 'Motoboy não encontrado ou desativado.' });
        return;
      }
      assignedCourierId = courier.id;
      assignedCourierName = courier.name;
    }

    db.prepare('UPDATE orders SET assignedCourierId = ?, assignedCourierName = ? WHERE id = ?').run(
      assignedCourierId,
      assignedCourierName,
      id
    );

    const updatedRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Record<string, unknown>;
    const updatedOrder = mapOrderRow(updatedRow);
    const settingsRow = db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;
    const tracking = mapDeliveryTrackingInfo(updatedRow, mapSettingsRow(settingsRow));

    pushUserEvent(updatedOrder.userId, 'order_updated', {
      orderId: updatedOrder.id,
      orderNumber: updatedOrder.orderNumber,
      status: updatedOrder.status,
    });
    pushUserEvent(updatedOrder.userId, 'tracking_updated', tracking);
    if (existingOrder.assignedCourierId && existingOrder.assignedCourierId !== assignedCourierId) {
      pushUserEvent(existingOrder.assignedCourierId, 'order_updated', { orderId: updatedOrder.id });
    }
    if (assignedCourierId) {
      pushUserEvent(assignedCourierId, 'order_updated', { orderId: updatedOrder.id });
      pushUserEvent(assignedCourierId, 'tracking_updated', tracking);
    }
    pushAdminEvent('tracking_updated', tracking);

    res.json({ order: updatedOrder });
  });

  // Admin Roulette Overview & Prize Management
  app.get('/api/admin/roulette', requireAuth, requireAdmin, (_req, res) => {
    expireOldChances();
    const prizes = (
      db.prepare('SELECT * FROM roulette_prizes ORDER BY sortOrder ASC, id ASC').all() as Record<string, unknown>[]
    ).map(mapPrizeRow);
    const spins = (
      db.prepare('SELECT * FROM roulette_spins ORDER BY id DESC LIMIT 100').all() as Record<string, unknown>[]
    ).map(mapSpinRow);
    const counts = db
      .prepare(
        `SELECT
          SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as availableCount,
          SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) as usedCount,
          SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expiredCount
        FROM roulette_chances`
      )
      .get() as { availableCount: number | null; usedCount: number | null; expiredCount: number | null };

    res.json({
      prizes,
      spins,
      totals: {
        available: Number(counts?.availableCount || 0),
        used: Number(counts?.usedCount || 0),
        expired: Number(counts?.expiredCount || 0),
      },
    });
  });

  app.put('/api/admin/roulette/prizes/:id', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    const existing = db.prepare('SELECT * FROM roulette_prizes WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Prêmio não encontrado.' });
      return;
    }

    const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
    const shortLabel = typeof req.body?.shortLabel === 'string' ? req.body.shortLabel.trim() : '';
    const weight = Math.max(0, Math.round(Number(req.body?.weight ?? 0)));
    const discountValue = Math.max(0, Number(req.body?.discountValue ?? 0));
    const active = req.body?.active !== false ? 1 : 0;

    if (!label || !shortLabel) {
      res.status(400).json({ error: 'Nome e rótulo curto do prêmio são obrigatórios.' });
      return;
    }

    db.prepare(
      'UPDATE roulette_prizes SET label = ?, shortLabel = ?, discountValue = ?, weight = ?, active = ? WHERE id = ?'
    ).run(label, shortLabel, discountValue, weight, active, id);

    const row = db.prepare('SELECT * FROM roulette_prizes WHERE id = ?').get(id) as Record<string, unknown>;
    pushBroadcastEvent('store_updated', { entity: 'roulette', action: 'updated', prizeId: id });
    res.json({ prize: mapPrizeRow(row) });
  });

  // Quick open/close store toggle
  app.patch('/api/admin/store-status', requireAuth, requireAdmin, (req, res) => {
    const storeOpen = req.body?.storeOpen ? 1 : 0;
    const closedMessage =
      typeof req.body?.closedMessage === 'string' && req.body.closedMessage.trim()
        ? req.body.closedMessage.trim()
        : undefined;

    if (closedMessage !== undefined) {
      db.prepare('UPDATE store_settings SET storeOpen = ?, closedMessage = ? WHERE id = 1').run(
        storeOpen,
        closedMessage
      );
    } else {
      db.prepare('UPDATE store_settings SET storeOpen = ? WHERE id = 1').run(storeOpen);
    }

    const row = db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;
    pushBroadcastEvent('store_updated', { entity: 'store_status' });
    res.json({ settings: mapSettingsRow(row) });
  });

  // Admin Products CRUD (persisted in Supabase when configured + synced with R&P Profit Manager)
  app.post('/api/admin/products', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const rawSku = typeof req.body?.sku === 'string' ? req.body.sku.trim().toUpperCase().slice(0, 40) : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    const badgeLabel = typeof req.body?.badgeLabel === 'string' ? req.body.badgeLabel.trim().slice(0, 40) : '';
    const price = Number(req.body?.price);
    const costPrice = roundMoney(Math.max(0, Number(req.body?.costPrice || 0)));
    const freightCostUnit = roundMoney(Math.max(0, Number(req.body?.freightCostUnit || 0)));
    const packagingCostUnit = roundMoney(Math.max(0, Number(req.body?.packagingCostUnit || 0)));
    const otherCostUnit = roundMoney(Math.max(0, Number(req.body?.otherCostUnit || 0)));
    const purchasedQuantity = Math.max(0, Math.round(Number(req.body?.purchasedQuantity || 0)));
    const stockQuantity = Math.max(0, Math.round(Number(req.body?.stockQuantity ?? purchasedQuantity)));
    const imageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl.trim() : '';
    const storagePath = typeof req.body?.storagePath === 'string' ? req.body.storagePath.trim() : '';
    const variationLabel =
      typeof req.body?.variationLabel === 'string' ? req.body.variationLabel.trim().slice(0, 60) : '';
    const variations = Array.isArray(req.body?.variations)
      ? req.body.variations.map((v: unknown) => String(v).trim()).filter(Boolean)
      : [];
    const secondaryVariationLabel =
      typeof req.body?.secondaryVariationLabel === 'string'
        ? req.body.secondaryVariationLabel.trim().slice(0, 60)
        : '';
    const secondaryVariations = Array.isArray(req.body?.secondaryVariations)
      ? req.body.secondaryVariations.map((v: unknown) => String(v).trim()).filter(Boolean)
      : [];
    const variationStock = sanitizeVariationStockMap(req.body?.variationStock);
    const active = req.body?.active !== false ? 1 : 0;

    if (!name || !category || !Number.isFinite(price) || price <= 0) {
      res.status(400).json({ error: 'Nome, categoria e preço positivo são obrigatórios.' });
      return;
    }
    if (!isSafeImageUrl(imageUrl)) {
      res.status(400).json({ error: 'URL de imagem inválida.' });
      return;
    }

    const now = new Date().toISOString();

    if (isSupabaseConfigured()) {
      try {
        const created = await createProductPersistent({
          sku: rawSku,
          name,
          category,
          description,
          badgeLabel,
          price: roundMoney(price),
          costPrice,
          freightCostUnit,
          packagingCostUnit,
          otherCostUnit,
          purchasedQuantity,
          stockQuantity,
          imageUrl,
          storagePath,
          variationLabel: variationLabel || 'Sabor / Variação',
          variations,
          secondaryVariationLabel,
          secondaryVariations,
          variationStock,
          active: active === 1,
        });

        recordProductCostSnapshot({
          productId: created.id,
          productNameSnapshot: name,
          eventType: 'initial',
          unitPurchaseCost: costPrice,
          freightCostUnit,
          packagingCostUnit,
          otherCostUnit,
          salePrice: roundMoney(price),
          purchasedQuantity,
          stockQuantity,
          note: 'Produto cadastrado e salvo permanentemente',
          recordedAt: now,
        });

        pushBroadcastEvent('products_updated', { action: 'created', productId: created.id });
        res.status(201).json({ product: created });
        return;
      } catch (err) {
        console.error('Supabase create product error:', err);
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao salvar produto no Supabase.',
        });
        return;
      }
    }

    let newId = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = db
        .prepare(
          `INSERT INTO products (
            sku, name, category, description, badgeLabel, price,
            costPrice, freightCostUnit, packagingCostUnit, otherCostUnit,
            purchasedQuantity, stockQuantity, archived,
            imageUrl, variationLabel, variationsJson, secondaryVariationLabel, secondaryVariationsJson, variationStockJson,
            active, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          rawSku,
          name,
          category,
          description,
          badgeLabel,
          roundMoney(price),
          costPrice,
          freightCostUnit,
          packagingCostUnit,
          otherCostUnit,
          purchasedQuantity,
          stockQuantity,
          imageUrl,
          variationLabel,
          JSON.stringify(variations),
          secondaryVariationLabel,
          JSON.stringify(secondaryVariations),
          JSON.stringify(variationStock),
          active,
          now,
          now
        );

      newId = Number(result.lastInsertRowid);
      const finalSku = formatProductSku(newId, rawSku);
      if (!rawSku) {
        db.prepare('UPDATE products SET sku = ? WHERE id = ?').run(finalSku, newId);
      }

      if (purchasedQuantity > 0 && (costPrice > 0 || freightCostUnit > 0 || packagingCostUnit > 0 || otherCostUnit > 0)) {
        const totalUnitCost = computeTotalUnitCost({
          costPrice,
          freightCostUnit,
          packagingCostUnit,
          otherCostUnit,
        });
        db.prepare(`
          INSERT INTO product_cost_batches (
            productId, quantityPurchased, remainingQuantity, unitPurchaseCost,
            freightCostUnit, packagingCostUnit, otherCostUnit, totalUnitCost,
            supplierNote, purchasedAt, createdAt, createdByAdminId
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          newId,
          purchasedQuantity,
          stockQuantity,
          costPrice,
          freightCostUnit,
          packagingCostUnit,
          otherCostUnit,
          totalUnitCost,
          'Cadastro inicial do produto',
          now,
          now,
          req.authUser?.id ?? null
        );
      }

      recordProductCostSnapshot({
        productId: newId,
        productNameSnapshot: name,
        eventType: 'initial',
        unitPurchaseCost: costPrice,
        freightCostUnit,
        packagingCostUnit,
        otherCostUnit,
        salePrice: roundMoney(price),
        purchasedQuantity,
        stockQuantity,
        note: 'Produto cadastrado e sincronizado no R&P Profit Manager',
        recordedAt: now,
      });

      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      console.error('Create product error:', err);
      res.status(500).json({ error: 'Erro ao cadastrar produto.' });
      return;
    }

    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(newId) as Record<string, unknown>;
    const product = mapProductRow(row);
    pushBroadcastEvent('products_updated', { action: 'created', productId: product.id });
    res.status(201).json({ product });
  });

  app.put('/api/admin/products/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    const existingRow = db
      .prepare('SELECT * FROM products WHERE id = ? AND archived = 0')
      .get(id) as Record<string, unknown> | undefined;
    if (!existingRow && !isSupabaseConfigured()) {
      res.status(404).json({ error: 'Produto não encontrado.' });
      return;
    }

    const existing = existingRow ? mapProductRow(existingRow) : null;
    const sku =
      typeof req.body?.sku === 'string' && req.body.sku.trim()
        ? req.body.sku.trim().toUpperCase().slice(0, 40)
        : formatProductSku(id, existing?.sku);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    const badgeLabel =
      req.body?.badgeLabel !== undefined
        ? typeof req.body.badgeLabel === 'string'
          ? req.body.badgeLabel.trim().slice(0, 40)
          : ''
        : existing?.badgeLabel || '';
    const price = Number(req.body?.price);
    const imageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl.trim() : '';
    const storagePath = typeof req.body?.storagePath === 'string' ? req.body.storagePath.trim() : undefined;
    const variationLabel =
      req.body?.variationLabel !== undefined
        ? typeof req.body.variationLabel === 'string'
          ? req.body.variationLabel.trim().slice(0, 60)
          : ''
        : existing?.variationLabel || '';
    const variations = Array.isArray(req.body?.variations)
      ? req.body.variations.map((v: unknown) => String(v).trim()).filter(Boolean)
      : [];
    const secondaryVariationLabel =
      req.body?.secondaryVariationLabel !== undefined
        ? typeof req.body.secondaryVariationLabel === 'string'
          ? req.body.secondaryVariationLabel.trim().slice(0, 60)
          : ''
        : existing?.secondaryVariationLabel || '';
    const secondaryVariations =
      req.body?.secondaryVariations !== undefined
        ? Array.isArray(req.body.secondaryVariations)
          ? req.body.secondaryVariations.map((v: unknown) => String(v).trim()).filter(Boolean)
          : []
        : existing?.secondaryVariations || [];
    const variationStock =
      req.body?.variationStock !== undefined
        ? sanitizeVariationStockMap(req.body.variationStock)
        : existing?.variationStock || {};
    const active = req.body?.active !== false ? 1 : 0;

    const nextCostPrice =
      req.body?.costPrice !== undefined
        ? roundMoney(Math.max(0, Number(req.body.costPrice)))
        : roundMoney(existing?.costPrice || 0);
    const nextFreightCost =
      req.body?.freightCostUnit !== undefined
        ? roundMoney(Math.max(0, Number(req.body.freightCostUnit)))
        : roundMoney(existing?.freightCostUnit || 0);
    const nextPackagingCost =
      req.body?.packagingCostUnit !== undefined
        ? roundMoney(Math.max(0, Number(req.body.packagingCostUnit)))
        : roundMoney(existing?.packagingCostUnit || 0);
    const nextOtherCost =
      req.body?.otherCostUnit !== undefined
        ? roundMoney(Math.max(0, Number(req.body.otherCostUnit)))
        : roundMoney(existing?.otherCostUnit || 0);
    const nextPurchasedQty =
      req.body?.purchasedQuantity !== undefined
        ? Math.max(0, Math.round(Number(req.body.purchasedQuantity)))
        : Math.max(0, Math.round(Number(existing?.purchasedQuantity || 0)));
    const nextStockQty =
      req.body?.stockQuantity !== undefined
        ? Math.max(0, Math.round(Number(req.body.stockQuantity)))
        : Math.max(0, Math.round(Number(existing?.stockQuantity || 0)));

    if (!name || !category || !Number.isFinite(price) || price <= 0) {
      res.status(400).json({ error: 'Nome, categoria e preço positivo são obrigatórios.' });
      return;
    }
    if (!isSafeImageUrl(imageUrl)) {
      res.status(400).json({ error: 'URL de imagem inválida.' });
      return;
    }

    const roundedPrice = roundMoney(price);
    const now = new Date().toISOString();

    if (isSupabaseConfigured()) {
      try {
        const updated = await updateProductPersistent(id, {
          sku,
          name,
          category,
          description,
          badgeLabel,
          price: roundedPrice,
          costPrice: nextCostPrice,
          freightCostUnit: nextFreightCost,
          packagingCostUnit: nextPackagingCost,
          otherCostUnit: nextOtherCost,
          purchasedQuantity: nextPurchasedQty,
          stockQuantity: nextStockQty,
          imageUrl,
          storagePath,
          variationLabel,
          variations,
          secondaryVariationLabel,
          secondaryVariations,
          variationStock,
          active: active === 1,
        });
        pushBroadcastEvent('products_updated', { action: 'updated', productId: updated.id });
        res.json({ product: updated });
        return;
      } catch (err) {
        console.error('Supabase update product error:', err);
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao atualizar produto no Supabase.',
        });
        return;
      }
    }

    if (!existing) {
      res.status(404).json({ error: 'Produto não encontrado.' });
      return;
    }

    const priceChanged = roundedPrice !== roundMoney(existing.price);
    const costChanged =
      nextCostPrice !== roundMoney(existing.costPrice || 0) ||
      nextFreightCost !== roundMoney(existing.freightCostUnit || 0) ||
      nextPackagingCost !== roundMoney(existing.packagingCostUnit || 0) ||
      nextOtherCost !== roundMoney(existing.otherCostUnit || 0) ||
      nextPurchasedQty !== Math.round(Number(existing.purchasedQuantity || 0)) ||
      nextStockQty !== Math.round(Number(existing.stockQuantity || 0));

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `UPDATE products SET
          sku = ?, name = ?, category = ?, description = ?, badgeLabel = ?, price = ?,
          costPrice = ?, freightCostUnit = ?, packagingCostUnit = ?, otherCostUnit = ?,
          purchasedQuantity = ?, stockQuantity = ?,
          imageUrl = ?, variationLabel = ?, variationsJson = ?, secondaryVariationLabel = ?, secondaryVariationsJson = ?, variationStockJson = ?,
          active = ?, updatedAt = ?
        WHERE id = ?`
      ).run(
        sku,
        name,
        category,
        description,
        badgeLabel,
        roundedPrice,
        nextCostPrice,
        nextFreightCost,
        nextPackagingCost,
        nextOtherCost,
        nextPurchasedQty,
        nextStockQty,
        imageUrl,
        variationLabel,
        JSON.stringify(variations),
        secondaryVariationLabel,
        JSON.stringify(secondaryVariations),
        JSON.stringify(variationStock),
        active,
        now,
        id
      );

      if (priceChanged || costChanged) {
        recordProductCostSnapshot({
          productId: id,
          productNameSnapshot: name,
          eventType: priceChanged && !costChanged ? 'price_change' : 'manual_edit',
          unitPurchaseCost: nextCostPrice,
          freightCostUnit: nextFreightCost,
          packagingCostUnit: nextPackagingCost,
          otherCostUnit: nextOtherCost,
          salePrice: roundedPrice,
          purchasedQuantity: nextPurchasedQty,
          stockQuantity: nextStockQty,
          note:
            priceChanged && !costChanged
              ? 'Preço de venda atualizado no cadastro principal (custo preservado)'
              : 'Produto e informações financeiras atualizados no cadastro principal',
          recordedAt: now,
        });
      }

      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      console.error('Update product error:', err);
      res.status(500).json({ error: 'Erro ao atualizar produto.' });
      return;
    }

    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Record<string, unknown>;
    const product = mapProductRow(row);
    pushBroadcastEvent('products_updated', { action: 'updated', productId: product.id });
    res.json({ product });
  });

  app.delete('/api/admin/products/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    const existingRow = db
      .prepare('SELECT * FROM products WHERE id = ? AND archived = 0')
      .get(id) as Record<string, unknown> | undefined;
    if (!existingRow && !isSupabaseConfigured()) {
      res.status(404).json({ error: 'Produto não encontrado.' });
      return;
    }

    const existing = existingRow ? mapProductRow(existingRow) : null;
    const now = new Date().toISOString();

    // Check if any existing order references this product ID (preserve historical order records)
    const orderRows = db.prepare('SELECT itemsJson FROM orders').all() as { itemsJson: string }[];
    const hasOrderRef = orderRows.some((o) => {
      try {
        const parsed = JSON.parse(o.itemsJson) as { productId?: number }[];
        return Array.isArray(parsed) && parsed.some((item) => Number(item.productId) === id);
      } catch {
        return false;
      }
    });

    try {
      if (isSupabaseConfigured()) {
        await deleteProductPersistent(id, hasOrderRef);
      }

      if (existing) {
        db.exec('BEGIN IMMEDIATE');
        try {
          if (hasOrderRef) {
            db.prepare('UPDATE products SET archived = 1, active = 0, archivedAt = ?, updatedAt = ? WHERE id = ?').run(
              now,
              now,
              id
            );
            recordProductCostSnapshot({
              productId: id,
              productNameSnapshot: existing.name,
              eventType: 'archived',
              unitPurchaseCost: Number(existing.costPrice || 0),
              freightCostUnit: Number(existing.freightCostUnit || 0),
              packagingCostUnit: Number(existing.packagingCostUnit || 0),
              otherCostUnit: Number(existing.otherCostUnit || 0),
              salePrice: existing.price,
              purchasedQuantity: Number(existing.purchasedQuantity || 0),
              stockQuantity: Number(existing.stockQuantity || 0),
              note: 'Produto removido do catálogo ativo (pedidos antigos preservados)',
              recordedAt: now,
            });
          } else {
            db.prepare('DELETE FROM product_cost_batches WHERE productId = ?').run(id);
            db.prepare('DELETE FROM product_cost_history WHERE productId = ?').run(id);
            db.prepare('DELETE FROM products WHERE id = ?').run(id);
            if (existing.imageUrl?.startsWith('/api/media/')) {
              const fname = existing.imageUrl.replace('/api/media/', '');
              db.prepare('DELETE FROM uploaded_media WHERE filename = ?').run(fname);
            }
          }
          db.exec('COMMIT');
        } catch (innerErr) {
          try {
            db.exec('ROLLBACK');
          } catch {
            // ignore
          }
          throw innerErr;
        }
      }

      pushBroadcastEvent('products_updated', { action: 'archived', productId: id });
      res.json({ deleted: true, softDeleted: hasOrderRef });
    } catch (err) {
      console.error('Delete product error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Erro ao excluir produto.',
      });
    }
  });

  // ================= R&P PROFIT MANAGER (ADMIN ONLY) =================

  app.get('/api/admin/profit/overview', requireAuth, requireAdmin, (_req, res) => {
    try {
      res.json(getProfitOverview());
    } catch (err) {
      console.error('Profit overview error:', err);
      res.status(500).json({ error: 'Erro ao carregar dados de rentabilidade.' });
    }
  });

  app.get('/api/admin/profit/products/:id', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID de produto inválido.' });
      return;
    }
    const detail = getProductProfitDetail(id);
    if (!detail) {
      res.status(404).json({ error: 'Produto não encontrado.' });
      return;
    }
    res.json(detail);
  });

  app.put('/api/admin/profit/products/:id', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID de produto inválido.' });
      return;
    }
    try {
      const updated = updateProductProfitData(id, {
        sku: typeof req.body?.sku === 'string' ? req.body.sku : undefined,
        price: req.body?.price !== undefined ? Number(req.body.price) : undefined,
        costPrice: req.body?.costPrice !== undefined ? Number(req.body.costPrice) : undefined,
        freightCostUnit:
          req.body?.freightCostUnit !== undefined ? Number(req.body.freightCostUnit) : undefined,
        packagingCostUnit:
          req.body?.packagingCostUnit !== undefined ? Number(req.body.packagingCostUnit) : undefined,
        otherCostUnit: req.body?.otherCostUnit !== undefined ? Number(req.body.otherCostUnit) : undefined,
        purchasedQuantity:
          req.body?.purchasedQuantity !== undefined ? Number(req.body.purchasedQuantity) : undefined,
        stockQuantity: req.body?.stockQuantity !== undefined ? Number(req.body.stockQuantity) : undefined,
        note: typeof req.body?.note === 'string' ? req.body.note : undefined,
      });
        pushBroadcastEvent('products_updated', { action: 'profit_updated', productId: id });
        void syncProductProfitToSupabase(updated);
        res.json({ product: updated });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Erro ao atualizar dados de rentabilidade do produto.',
        });
      }
    });

  app.post(
    '/api/admin/profit/products/:id/batches',
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        res.status(400).json({ error: 'ID de produto inválido.' });
        return;
      }
      try {
        const result = registerProductBatch(
          id,
          {
            quantityPurchased: Number(req.body?.quantityPurchased),
            unitPurchaseCost: Number(req.body?.unitPurchaseCost),
            freightCostUnit:
              req.body?.freightCostUnit !== undefined ? Number(req.body.freightCostUnit) : 0,
            packagingCostUnit:
              req.body?.packagingCostUnit !== undefined ? Number(req.body.packagingCostUnit) : 0,
            otherCostUnit: req.body?.otherCostUnit !== undefined ? Number(req.body.otherCostUnit) : 0,
            supplierNote: typeof req.body?.supplierNote === 'string' ? req.body.supplierNote : '',
            purchasedAt: typeof req.body?.purchasedAt === 'string' ? req.body.purchasedAt : undefined,
          },
          req.authUser?.id
        );
        pushBroadcastEvent('products_updated', { action: 'batch_registered', productId: id });
        void syncProductProfitToSupabase(result.product);
        res.status(201).json(result);
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Erro ao registrar lote de compra.',
        });
      }
    }
  );

  // Admin Coupons CRUD
  app.post('/api/admin/coupons', requireAuth, requireAdmin, (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase().replace(/\s+/g, '') : '';
    const rawType = String(req.body?.discountType || 'percent');
    const discountType = rawType === 'fixed' ? 'fixed' : rawType === 'free_shipping' ? 'free_shipping' : 'percent';
    const discountValue = discountType === 'free_shipping' ? 0 : Number(req.body?.discountValue);
    const minOrderValue = Number(req.body?.minOrderValue || 0);
    const freeShipping = discountType === 'free_shipping' ? 1 : 0;
    const active = req.body?.active !== false ? 1 : 0;
    const rawAllowedEmail =
      typeof req.body?.allowedEmail === 'string' ? req.body.allowedEmail.trim().toLowerCase() : '';
    const allowedEmail = rawAllowedEmail ? rawAllowedEmail : null;
    const allowMultipleUses = req.body?.allowMultipleUses !== false ? 1 : 0;

    if (!code || code.length < 2 || (discountType !== 'free_shipping' && (!Number.isFinite(discountValue) || discountValue <= 0))) {
      res.status(400).json({ error: 'Código e valor de desconto válidos são obrigatórios.' });
      return;
    }
    if (discountType === 'percent' && discountValue > 100) {
      res.status(400).json({ error: 'Desconto percentual não pode exceder 100%.' });
      return;
    }
    if (allowedEmail && (!allowedEmail.includes('@') || !allowedEmail.includes('.') || allowedEmail.length > 160)) {
      res.status(400).json({ error: 'Informe um e-mail válido para restringir o cupom.' });
      return;
    }

    const exists = db.prepare('SELECT id FROM coupons WHERE upper(code) = ?').get(code);
    if (exists) {
      res.status(409).json({ error: 'Já existe um cupom com este código.' });
      return;
    }

    const now = new Date().toISOString();
    const result = db
      .prepare(
        'INSERT INTO coupons (code, discountType, discountValue, minOrderValue, freeShipping, allowedEmail, allowMultipleUses, active, usageCount, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)'
      )
      .run(
        code,
        discountType,
        roundMoney(discountValue),
        Math.max(0, roundMoney(minOrderValue)),
        freeShipping,
        allowedEmail,
        allowMultipleUses,
        active,
        now
      );

    const row = db.prepare('SELECT * FROM coupons WHERE id = ?').get(Number(result.lastInsertRowid)) as Record<
      string,
      unknown
    >;
    pushAdminEvent('store_updated', { entity: 'coupons', action: 'created' });
    res.status(201).json({ coupon: mapCouponRow(row) });
  });

  app.put('/api/admin/coupons/:id', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    const existing = db.prepare('SELECT * FROM coupons WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Cupom não encontrado.' });
      return;
    }

    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase().replace(/\s+/g, '') : '';
    const rawType = String(req.body?.discountType || 'percent');
    const discountType = rawType === 'fixed' ? 'fixed' : rawType === 'free_shipping' ? 'free_shipping' : 'percent';
    const discountValue = discountType === 'free_shipping' ? 0 : Number(req.body?.discountValue);
    const minOrderValue = Number(req.body?.minOrderValue || 0);
    const freeShipping = discountType === 'free_shipping' ? 1 : 0;
    const active = req.body?.active !== false ? 1 : 0;
    const rawAllowedEmail =
      typeof req.body?.allowedEmail === 'string' ? req.body.allowedEmail.trim().toLowerCase() : '';
    const allowedEmail = rawAllowedEmail ? rawAllowedEmail : null;
    const allowMultipleUses = req.body?.allowMultipleUses !== false ? 1 : 0;

    if (!code || (discountType !== 'free_shipping' && (!Number.isFinite(discountValue) || discountValue <= 0))) {
      res.status(400).json({ error: 'Código e valor de desconto válidos são obrigatórios.' });
      return;
    }
    if (discountType === 'percent' && discountValue > 100) {
      res.status(400).json({ error: 'Desconto percentual não pode exceder 100%.' });
      return;
    }
    if (allowedEmail && (!allowedEmail.includes('@') || !allowedEmail.includes('.') || allowedEmail.length > 160)) {
      res.status(400).json({ error: 'Informe um e-mail válido para restringir o cupom.' });
      return;
    }

    const duplicate = db.prepare('SELECT id FROM coupons WHERE upper(code) = ? AND id != ?').get(code, id);
    if (duplicate) {
      res.status(409).json({ error: 'Já existe outro cupom com este código.' });
      return;
    }

    const existingCoupon = mapCouponRow(existing);
    const nextMaxUses =
      existingCoupon.ownerUserId === null && allowMultipleUses === 1 && existingCoupon.maxUses === 1
        ? null
        : existingCoupon.maxUses;

    db.prepare(
      'UPDATE coupons SET code = ?, discountType = ?, discountValue = ?, minOrderValue = ?, freeShipping = ?, allowedEmail = ?, allowMultipleUses = ?, maxUses = ?, active = ? WHERE id = ?'
    ).run(
      code,
      discountType,
      roundMoney(discountValue),
      Math.max(0, roundMoney(minOrderValue)),
      freeShipping,
      allowedEmail,
      allowMultipleUses,
      nextMaxUses,
      active,
      id
    );

    const row = db.prepare('SELECT * FROM coupons WHERE id = ?').get(id) as Record<string, unknown>;
    pushAdminEvent('store_updated', { entity: 'coupons', action: 'updated', couponId: id });
    res.json({ coupon: mapCouponRow(row) });
  });

  app.delete('/api/admin/coupons/:id', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    db.prepare('DELETE FROM coupon_usages WHERE couponId = ?').run(id);
    db.prepare('DELETE FROM coupons WHERE id = ?').run(id);
    pushAdminEvent('store_updated', { entity: 'coupons', action: 'deleted', couponId: id });
    res.json({ deleted: true });
  });

  // Admin Carousel CRUD (persisted in Supabase when configured + Storage cleanup on delete)
  app.post('/api/admin/carousel', requireAuth, requireAdmin, async (req, res) => {
    const tag = typeof req.body?.tag === 'string' ? req.body.tag.trim() : '';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const subtitle = typeof req.body?.subtitle === 'string' ? req.body.subtitle.trim() : '';
    const ctaText = typeof req.body?.ctaText === 'string' ? req.body.ctaText.trim() || 'Ver catálogo' : 'Ver catálogo';
    const targetCategory =
      typeof req.body?.targetCategory === 'string' ? req.body.targetCategory.trim() || 'Todos' : 'Todos';
    const linkUrl = typeof req.body?.linkUrl === 'string' ? req.body.linkUrl.trim() : '';
    const imageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl.trim() : '';
    const storagePath = typeof req.body?.storagePath === 'string' ? req.body.storagePath.trim() : '';
    const sortOrder = Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 1;
    const active = req.body?.active !== false ? 1 : 0;

    if (!title) {
      res.status(400).json({ error: 'O título do slide é obrigatório.' });
      return;
    }
    if (!isSafeImageUrl(imageUrl)) {
      res.status(400).json({ error: 'URL de imagem inválida.' });
      return;
    }

    try {
      if (isSupabaseConfigured()) {
        const slide = await createSlidePersistent({
          tag,
          title,
          subtitle,
          ctaText,
          targetCategory,
          linkUrl,
          imageUrl,
          storagePath,
          sortOrder,
          active: active === 1,
        });
        pushBroadcastEvent('store_updated', { entity: 'carousel', action: 'created', slideId: slide.id });
        res.status(201).json({ slide });
        return;
      }

      const now = new Date().toISOString();
      const result = db
        .prepare(
          'INSERT INTO carousel_slides (tag, title, subtitle, ctaText, targetCategory, linkUrl, imageUrl, storagePath, sortOrder, active, deleted, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)'
        )
        .run(tag, title, subtitle, ctaText, targetCategory, linkUrl, imageUrl, storagePath, sortOrder, active, now, now);

      const row = db.prepare('SELECT * FROM carousel_slides WHERE id = ?').get(Number(result.lastInsertRowid)) as Record<
        string,
        unknown
      >;
      pushBroadcastEvent('store_updated', { entity: 'carousel', action: 'created' });
      res.status(201).json({ slide: mapSlideRow(row) });
    } catch (err) {
      console.error('Create carousel slide error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Erro ao salvar slide no banco de dados.',
      });
    }
  });

  app.put('/api/admin/carousel/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    const existing = db
      .prepare('SELECT * FROM carousel_slides WHERE id = ? AND COALESCE(deleted, 0) = 0')
      .get(id) as Record<string, unknown> | undefined;
    if (!existing && !isSupabaseConfigured()) {
      res.status(404).json({ error: 'Slide não encontrado.' });
      return;
    }

    const tag = typeof req.body?.tag === 'string' ? req.body.tag.trim() : '';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const subtitle = typeof req.body?.subtitle === 'string' ? req.body.subtitle.trim() : '';
    const ctaText = typeof req.body?.ctaText === 'string' ? req.body.ctaText.trim() || 'Ver catálogo' : 'Ver catálogo';
    const targetCategory =
      typeof req.body?.targetCategory === 'string' ? req.body.targetCategory.trim() || 'Todos' : 'Todos';
    const linkUrl = typeof req.body?.linkUrl === 'string' ? req.body.linkUrl.trim() : '';
    const imageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl.trim() : '';
    const storagePath = typeof req.body?.storagePath === 'string' ? req.body.storagePath.trim() : undefined;
    const sortOrder = Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 1;
    const active = req.body?.active !== false ? 1 : 0;

    if (!title) {
      res.status(400).json({ error: 'O título do slide é obrigatório.' });
      return;
    }
    if (!isSafeImageUrl(imageUrl)) {
      res.status(400).json({ error: 'URL de imagem inválida.' });
      return;
    }

    try {
      if (isSupabaseConfigured()) {
        const slide = await updateSlidePersistent(id, {
          tag,
          title,
          subtitle,
          ctaText,
          targetCategory,
          linkUrl,
          imageUrl,
          storagePath,
          sortOrder,
          active: active === 1,
        });
        pushBroadcastEvent('store_updated', { entity: 'carousel', action: 'updated', slideId: id });
        res.json({ slide });
        return;
      }

      const now = new Date().toISOString();
      db.prepare(
        'UPDATE carousel_slides SET tag = ?, title = ?, subtitle = ?, ctaText = ?, targetCategory = ?, linkUrl = ?, imageUrl = ?, storagePath = COALESCE(?, storagePath), sortOrder = ?, active = ?, updatedAt = ? WHERE id = ?'
      ).run(
        tag,
        title,
        subtitle,
        ctaText,
        targetCategory,
        linkUrl,
        imageUrl,
        storagePath ?? null,
        sortOrder,
        active,
        now,
        id
      );

      const row = db.prepare('SELECT * FROM carousel_slides WHERE id = ?').get(id) as Record<string, unknown>;
      pushBroadcastEvent('store_updated', { entity: 'carousel', action: 'updated', slideId: id });
      res.json({ slide: mapSlideRow(row) });
    } catch (err) {
      console.error('Update carousel slide error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Erro ao atualizar slide no banco.',
      });
    }
  });

  app.delete('/api/admin/carousel/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }

    const existing = db.prepare('SELECT * FROM carousel_slides WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;

    try {
      if (isSupabaseConfigured()) {
        await deleteSlidePersistent(id);
      }

      if (existing) {
        const existingUrl = String(existing.imageUrl || '');
        if (existingUrl.startsWith('/api/media/')) {
          const fname = existingUrl.replace('/api/media/', '');
          db.prepare('DELETE FROM uploaded_media WHERE filename = ?').run(fname);
        }
        db.prepare('DELETE FROM carousel_slides WHERE id = ?').run(id);
      }

      pushBroadcastEvent('store_updated', { entity: 'carousel', action: 'deleted', slideId: id });
      res.json({ deleted: true });
    } catch (err) {
      console.error('Delete carousel slide error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Erro ao excluir slide.',
      });
    }
  });

  // Admin Store Settings
  app.put('/api/admin/settings', requireAuth, requireAdmin, async (req, res) => {
    const existingRow = db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;
    const existing = mapSettingsRow(existingRow);

    const storeName =
      typeof req.body?.storeName === 'string' ? req.body.storeName.trim() || 'R&P Tabacaria' : 'R&P Tabacaria';
    const storeOpen = req.body?.storeOpen !== false ? 1 : 0;
    const closedMessage =
      typeof req.body?.closedMessage === 'string'
        ? req.body.closedMessage.trim() || 'Estamos fechados no momento. Voltamos em breve!'
        : existing.closedMessage;

    const minDeliveryOrder = Math.max(0, roundMoney(Number(req.body?.minDeliveryOrder || 0)));
    const rawMode = String(req.body?.shippingMode || 'per_km');
    const shippingMode = rawMode === 'fixed' ? 'fixed' : rawMode === 'to_confirm' ? 'to_confirm' : 'per_km';

    const shippingPerKm = Math.max(0, roundMoney(Number(req.body?.shippingPerKm ?? 1.5)));
    const freeShippingKm = Math.max(0, Number(req.body?.freeShippingKm ?? 1.5));

    const shippingFee =
      shippingMode === 'fixed' && req.body?.shippingFee !== null && req.body?.shippingFee !== ''
        ? Math.max(0, roundMoney(Number(req.body.shippingFee)))
        : null;
    const freeShippingThreshold =
      req.body?.freeShippingThreshold !== null &&
      req.body?.freeShippingThreshold !== '' &&
      Number(req.body?.freeShippingThreshold) > 0
        ? roundMoney(Number(req.body.freeShippingThreshold))
        : null;

    const storeCep = typeof req.body?.storeCep === 'string' ? req.body.storeCep.trim() : existing.storeCep;
    let storeLat = Number.isFinite(Number(req.body?.storeLat)) ? Number(req.body.storeLat) : existing.storeLat;
    let storeLng = Number.isFinite(Number(req.body?.storeLng)) ? Number(req.body.storeLng) : existing.storeLng;

    if (storeCep && storeCep.replace(/\D/g, '') !== existing.storeCep.replace(/\D/g, '')) {
      const geo = await lookupBrazilianCep(storeCep);
      if (geo && geo.lat !== 0 && geo.lng !== 0) {
        storeLat = geo.lat;
        storeLng = geo.lng;
      }
    }

    const storeAddress = typeof req.body?.storeAddress === 'string' ? req.body.storeAddress.trim() : '';
    const storeHours = typeof req.body?.storeHours === 'string' ? req.body.storeHours.trim() : '';
    const storeWhatsapp = typeof req.body?.storeWhatsapp === 'string' ? req.body.storeWhatsapp.trim() : '';
    const pickupInstructions =
      typeof req.body?.pickupInstructions === 'string' ? req.body.pickupInstructions.trim() : '';

    db.prepare(`
      UPDATE store_settings SET
        storeName = ?, storeOpen = ?, closedMessage = ?,
        minDeliveryOrder = ?, shippingMode = ?, shippingPerKm = ?, freeShippingKm = ?,
        shippingFee = ?, freeShippingThreshold = ?,
        storeCep = ?, storeLat = ?, storeLng = ?,
        storeAddress = ?, storeHours = ?, storeWhatsapp = ?, pickupInstructions = ?
      WHERE id = 1
    `).run(
      storeName,
      storeOpen,
      closedMessage,
      minDeliveryOrder,
      shippingMode,
      shippingPerKm,
      freeShippingKm,
      shippingFee,
      freeShippingThreshold,
      storeCep,
      storeLat,
      storeLng,
      storeAddress,
      storeHours,
      storeWhatsapp,
      pickupInstructions
    );

    const row = db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;
    pushBroadcastEvent('store_updated', { entity: 'settings' });
    res.json({ settings: mapSettingsRow(row) });
  });

  // Admin Order Status Update -> Automatically grants 1 roulette chance per R$ 50,00 subtotal on 'Confirmado'
  // and unlocks / terminates live delivery tracking on 'Saiu para entrega' / 'Entregue'
  app.patch('/api/admin/orders/:id/status', requireAuth, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const status = req.body?.status as OrderStatus;
    const rawCourierId = req.body?.assignedCourierId;
    if (!Number.isInteger(id) || !VALID_ORDER_STATUSES.includes(status)) {
      res.status(400).json({ error: 'Dados inválidos para atualizar pedido.' });
      return;
    }

    let nextAssignedCourierId: number | null | undefined = undefined;
    let nextAssignedCourierName = '';
    if (rawCourierId !== undefined) {
      if (rawCourierId === null || rawCourierId === '') {
        nextAssignedCourierId = null;
        nextAssignedCourierName = '';
      } else {
        const courierId = Number(rawCourierId);
        const courier = Number.isInteger(courierId) ? getUserById(courierId) : null;
        if (!courier || courier.role !== 'courier' || courier.active === false) {
          res.status(400).json({ error: 'Motoboy selecionado inválido ou desativado.' });
          return;
        }
        nextAssignedCourierId = courier.id;
        nextAssignedCourierName = courier.name;
      }
    }

    let existingOrderSnapshot: ReturnType<typeof mapOrderRow> | null = null;
    const preRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!preRow) {
      res.status(404).json({ error: 'Pedido não encontrado.' });
      return;
    }
    existingOrderSnapshot = mapOrderRow(preRow);

    let geocodedCoords: Coordinates | null = existingOrderSnapshot.destCoords;
    if (status === 'Saiu para entrega' && existingOrderSnapshot.deliveryMethod === 'Entrega' && !geocodedCoords && existingOrderSnapshot.address) {
      geocodedCoords = await geocodeDeliveryAddress(existingOrderSnapshot.address);
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      const existingRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as
        | Record<string, unknown>
        | undefined;
      if (!existingRow) {
        db.exec('ROLLBACK');
        res.status(404).json({ error: 'Pedido não encontrado.' });
        return;
      }

      const existingOrder = mapOrderRow(existingRow);
      let grantedNow = 0;
      let stockChanged = false;

      if (status === 'Confirmado' && !existingOrder.stockDeducted) {
        const stockValidation = validateOrderItemsStock(existingOrder.items);
        if (stockValidation.ok === false) {
          db.exec('ROLLBACK');
          res.status(400).json({
            error: `${stockValidation.error} Ajuste o estoque do produto se desejar confirmar este pedido.`,
          });
          return;
        }
        const lockStock = db
          .prepare('UPDATE orders SET stockDeducted = 1 WHERE id = ? AND stockDeducted = 0')
          .run(id);
        if (lockStock.changes === 1) {
          adjustInventoryForOrderItems(existingOrder.items, 'deduct');
          stockChanged = true;
        }
      } else if (status === 'Cancelado' && existingOrder.stockDeducted) {
        const lockRestore = db
          .prepare('UPDATE orders SET stockDeducted = 0 WHERE id = ? AND stockDeducted = 1')
          .run(id);
        if (lockRestore.changes === 1) {
          adjustInventoryForOrderItems(existingOrder.items, 'restore');
          stockChanged = true;
        }
      }

      if (status === 'Confirmado' && !existingOrder.rouletteGranted) {
        const chancesToGrant = Math.floor(existingOrder.subtotal / 50);
        const now = new Date();
        const grantedAt = now.toISOString();
        const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

        const lockGrant = db
          .prepare('UPDATE orders SET status = ?, rouletteGranted = 1 WHERE id = ? AND rouletteGranted = 0')
          .run(status, id);

        if (lockGrant.changes === 1 && chancesToGrant > 0) {
          const insertChance = db.prepare(`
            INSERT INTO roulette_chances (userId, orderId, orderNumber, status, grantedAt, expiresAt)
            VALUES (?, ?, ?, 'available', ?, ?)
          `);
          for (let i = 0; i < chancesToGrant; i++) {
            insertChance.run(existingOrder.userId, existingOrder.id, existingOrder.orderNumber, grantedAt, expiresAt);
          }
          grantedNow = chancesToGrant;
        }
      } else {
        db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
      }

      if (nextAssignedCourierId !== undefined) {
        db.prepare('UPDATE orders SET assignedCourierId = ?, assignedCourierName = ? WHERE id = ?').run(
          nextAssignedCourierId,
          nextAssignedCourierName,
          id
        );
      }

      if (status === 'Saiu para entrega' && existingOrder.deliveryMethod === 'Entrega') {
        const nextGps = existingOrder.courierGpsStatus === 'active' ? 'active' : 'waiting';
        db.prepare(
          'UPDATE orders SET trackingActive = 1, courierGpsStatus = ?, destLat = COALESCE(destLat, ?), destLng = COALESCE(destLng, ?) WHERE id = ?'
        ).run(
          nextGps,
          geocodedCoords ? geocodedCoords.lat : null,
          geocodedCoords ? geocodedCoords.lng : null,
          id
        );
      } else if (status === 'Entregue' || status === 'Concluído' || status === 'Cancelado') {
        const nowIso = new Date().toISOString();
        if (status === 'Entregue') {
          db.prepare(
            "UPDATE orders SET trackingActive = 0, courierGpsStatus = 'ended', deliveredAt = COALESCE(deliveredAt, ?) WHERE id = ?"
          ).run(nowIso, id);
        } else {
          db.prepare("UPDATE orders SET trackingActive = 0, courierGpsStatus = 'ended' WHERE id = ?").run(id);
        }
      } else {
        db.prepare('UPDATE orders SET trackingActive = 0 WHERE id = ?').run(id);
      }

      const updatedRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Record<string, unknown>;
      const updatedOrder = mapOrderRow(updatedRow);
      const settingsRow = db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;
      const tracking = mapDeliveryTrackingInfo(updatedRow, mapSettingsRow(settingsRow));
      db.exec('COMMIT');

      const statusPayload = {
        orderId: updatedOrder.id,
        orderNumber: updatedOrder.orderNumber,
        status: updatedOrder.status,
      };

      // Real-time push to customer, assigned courier, and open admin sessions
      pushUserEvent(updatedOrder.userId, 'order_updated', statusPayload);
      pushUserEvent(updatedOrder.userId, 'tracking_updated', tracking);
      if (updatedOrder.assignedCourierId) {
        pushUserEvent(updatedOrder.assignedCourierId, 'order_updated', statusPayload);
        pushUserEvent(updatedOrder.assignedCourierId, 'tracking_updated', tracking);
      }
      pushAdminEvent('order_updated', statusPayload);
      pushAdminEvent('tracking_updated', tracking);
      if (stockChanged) {
        for (const item of existingOrder.items) {
          const pRow = db.prepare('SELECT * FROM products WHERE id = ?').get(item.productId) as
            | Record<string, unknown>
            | undefined;
          if (pRow) {
            const p = mapProductRow(pRow);
            void syncProductStockToSupabase(p.id, Number(p.stockQuantity ?? 0), p.variationStock || {});
          }
        }
        pushBroadcastEvent('products_updated', { action: 'stock_updated', orderId: updatedOrder.id });
      }

      if (grantedNow > 0) {
        pushUserEvent(updatedOrder.userId, 'roulette_updated', {
          grantedNow,
          orderNumber: updatedOrder.orderNumber,
        });
      }

      const customerAccount = getUserById(updatedOrder.userId);
      void syncOrderToSupabase(updatedOrder, customerAccount?.email || '');

      res.json({ order: updatedOrder, chancesGranted: grantedNow });
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      console.error('Order status update error:', err);
      res.status(500).json({ error: 'Erro ao atualizar status do pedido.' });
    }
  });

  // Serve Vite or built dist
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`R&P Tabacaria server running on http://0.0.0.0:${port}`);
    startCouponReminderScheduler();
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
