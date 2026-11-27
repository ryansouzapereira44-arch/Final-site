import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import express, { type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import {
  createUserRecord,
  db,
  getUserByEmail,
  getUserById,
  hasAdminUser,
  mapChanceRow,
  mapCouponRow,
  mapOrderRow,
  mapPrizeRow,
  mapProductRow,
  mapSettingsRow,
  mapSlideRow,
  mapSpinRow,
} from './server/db.ts';
import {
  type AuthenticatedRequest,
  clearSessionCookie,
  getAdminEmail,
  getConfiguredAdminPassword,
  hashPassword,
  isAdminClaimed,
  requireAdmin,
  requireAuth,
  setSessionCookie,
  signSessionToken,
  verifyEnvAdminPassword,
  verifyPassword,
} from './server/auth.ts';
import type {
  CartItem,
  Coordinates,
  DeliveryAddress,
  OrderStatus,
  PaymentMethod,
  RoulettePrize,
  RouletteStateResponse,
} from './src/types.ts';

const VALID_PAYMENTS: PaymentMethod[] = ['PIX', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro'];
const VALID_ORDER_STATUSES: OrderStatus[] = [
  'Pendente',
  'Confirmado',
  'Em preparo',
  'Saiu para entrega',
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

// SSE client registry per userId for real-time roulette & order updates
const sseClients = new Map<number, Set<Response>>();

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
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  // Auth status (public)
  app.get('/api/auth/status', (_req, res) => {
    res.json({
      adminClaimed: isAdminClaimed(),
      adminEmail: getAdminEmail(),
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

    const { passwordHash: _ph, ...user } = record;
    const token = signSessionToken(user);
    setSessionCookie(res, token);
    res.json({ user, token });
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

  // Real-time SSE notifications for automatic roulette & order status sync
  app.get('/api/events', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    if (!sseClients.has(userId)) {
      sseClients.set(userId, new Set());
    }
    sseClients.get(userId)!.add(res);

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

  // Storefront Data
  app.get('/api/store', requireAuth, (_req, res) => {
    const productRows = db
      .prepare('SELECT * FROM products WHERE active = 1 ORDER BY id DESC')
      .all() as Record<string, unknown>[];
    const slideRows = db
      .prepare('SELECT * FROM carousel_slides WHERE active = 1 ORDER BY sortOrder ASC, id ASC')
      .all() as Record<string, unknown>[];
    const settingsRow = db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;

    const products = productRows.map(mapProductRow);
    const categories = ['Todos', ...Array.from(new Set(products.map((p) => p.category)))];

    res.json({
      products,
      categories,
      slides: slideRows.map(mapSlideRow),
      settings: mapSettingsRow(settingsRow),
    });
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

  // Validate discount / free-shipping coupon
  app.post('/api/coupons/validate', requireAuth, (req: AuthenticatedRequest, res) => {
    expireOldCoupons();
    const userId = req.authUser!.id;
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
    const nowIso = new Date().toISOString();

    if (coupon.ownerUserId !== null && coupon.ownerUserId !== userId) {
      res.status(403).json({ valid: false, message: 'Este cupom pertence a outro cliente.' });
      return;
    }
    if (coupon.maxUses !== null && coupon.usageCount >= coupon.maxUses) {
      res.status(400).json({ valid: false, message: 'Este cupom já foi utilizado.' });
      return;
    }
    if (coupon.expiresAt && coupon.expiresAt <= nowIso) {
      res.status(400).json({ valid: false, message: 'Este cupom expirou (validade de 7 dias encerrada).' });
      return;
    }
    if (!coupon.active) {
      res.status(400).json({ valid: false, message: 'Este cupom está inativo.' });
      return;
    }
    if (subtotal < coupon.minOrderValue) {
      res.status(400).json({
        valid: false,
        message: `Pedido mínimo de R$ ${coupon.minOrderValue.toFixed(2).replace('.', ',')} para usar este cupom.`,
      });
      return;
    }

    let discountAmount = 0;
    let message = '';
    if (coupon.freeShipping || coupon.discountType === 'free_shipping') {
      discountAmount = 0;
      message = `Cupom ${coupon.code} aplicado (Frete Grátis).`;
    } else if (coupon.discountType === 'percent') {
      discountAmount = roundMoney((subtotal * coupon.discountValue) / 100);
      message = `Cupom ${coupon.code} aplicado (${coupon.discountValue}% OFF).`;
    } else {
      discountAmount = roundMoney(Math.min(subtotal, coupon.discountValue));
      message = `Cupom ${coupon.code} aplicado (R$ ${coupon.discountValue.toFixed(2).replace('.', ',')} OFF).`;
    }

    res.json({
      valid: true,
      coupon,
      discountAmount,
      message,
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

      const productRow = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(productId) as
        | Record<string, unknown>
        | undefined;
      if (!productRow) {
        res.status(400).json({ error: 'Um dos produtos do carrinho não está mais disponível.' });
        return;
      }
      const product = mapProductRow(productRow);
      const lineTotal = roundMoney(product.price * quantity);
      subtotal = roundMoney(subtotal + lineTotal);

      verifiedItems.push({
        productId: product.id,
        name: product.name,
        price: product.price,
        imageUrl: product.imageUrl,
        variation: variation || product.variations[0] || 'Padrão',
        quantity,
      });
    }

    let discountAmount = 0;
    let appliedCouponCode: string | null = null;
    let freeShippingByCoupon = false;

    if (couponCodeInput) {
      expireOldCoupons();
      const nowOrderIso = new Date().toISOString();
      const couponRow = db.prepare('SELECT * FROM coupons WHERE upper(code) = ?').get(couponCodeInput) as
        | Record<string, unknown>
        | undefined;
      if (couponRow) {
        const coupon = mapCouponRow(couponRow);
        const ownerOk = coupon.ownerUserId === null || coupon.ownerUserId === user.id;
        const usesOk = coupon.maxUses === null || coupon.usageCount < coupon.maxUses;
        const notExpired = !coupon.expiresAt || coupon.expiresAt > nowOrderIso;
        if (coupon.active && ownerOk && usesOk && notExpired && subtotal >= coupon.minOrderValue) {
          appliedCouponCode = coupon.code;
          if (coupon.freeShipping || coupon.discountType === 'free_shipping') {
            freeShippingByCoupon = true;
          } else if (coupon.discountType === 'percent') {
            discountAmount = roundMoney((subtotal * coupon.discountValue) / 100);
          } else {
            discountAmount = roundMoney(Math.min(subtotal, coupon.discountValue));
          }
          db.prepare('UPDATE coupons SET usageCount = usageCount + 1 WHERE id = ?').run(coupon.id);
          if (coupon.maxUses !== null && coupon.usageCount + 1 >= coupon.maxUses) {
            db.prepare('UPDATE coupons SET active = 0 WHERE id = ?').run(coupon.id);
          }
        }
      }
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

    const maxOrderRow = db.prepare('SELECT COALESCE(MAX(orderNumber), 1000) as maxNum FROM orders').get() as {
      maxNum: number;
    };
    const nextOrderNumber = Number(maxOrderRow.maxNum) + 1;
    const now = new Date().toISOString();

    const insertResult = db
      .prepare(`
        INSERT INTO orders (
          orderNumber, userId, customerName, customerWhatsapp, customerCpf,
          deliveryMethod, addressJson, distanceKm, paymentMethod, changeFor, itemsJson,
          subtotal, discountAmount, couponCode, shippingFee, shippingLabel, total,
          status, rouletteGranted, notes, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendente', 0, ?, ?)
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

    const createdRow = db
      .prepare('SELECT * FROM orders WHERE id = ?')
      .get(Number(insertResult.lastInsertRowid)) as Record<string, unknown>;

    res.status(201).json({ order: mapOrderRow(createdRow) });
  });

  // Customer's own orders
  app.get('/api/orders/mine', requireAuth, (req: AuthenticatedRequest, res) => {
    const rows = db
      .prepare('SELECT * FROM orders WHERE userId = ? ORDER BY id DESC')
      .all(req.authUser!.id) as Record<string, unknown>[];
    res.json({ orders: rows.map(mapOrderRow) });
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
        couponExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const discountType = prize.prizeType === 'free_shipping' ? 'free_shipping' : 'percent';
        const discountValue = prize.prizeType === 'free_shipping' ? 0 : prize.discountValue;
        const freeShipping = prize.prizeType === 'free_shipping' ? 1 : 0;

        db.prepare(`
          INSERT INTO coupons (
            code, discountType, discountValue, minOrderValue, freeShipping,
            ownerUserId, maxUses, expiresAt, active, usageCount, createdAt
          ) VALUES (?, ?, ?, 0, ?, ?, 1, ?, 1, 0, ?)
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

  app.get('/api/admin/overview', requireAuth, requireAdmin, (_req, res) => {
    expireOldCoupons();
    const products = (db.prepare('SELECT * FROM products ORDER BY id DESC').all() as Record<string, unknown>[]).map(
      mapProductRow
    );
    const coupons = (db.prepare('SELECT * FROM coupons ORDER BY id DESC').all() as Record<string, unknown>[]).map(
      mapCouponRow
    );
    const slides = (
      db.prepare('SELECT * FROM carousel_slides ORDER BY sortOrder ASC, id ASC').all() as Record<string, unknown>[]
    ).map(mapSlideRow);
    const orders = (db.prepare('SELECT * FROM orders ORDER BY id DESC').all() as Record<string, unknown>[]).map(
      mapOrderRow
    );
    const settingsRow = db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;

    res.json({
      products,
      coupons,
      slides,
      orders,
      settings: mapSettingsRow(settingsRow),
    });
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
    res.json({ settings: mapSettingsRow(row) });
  });

  // Admin Products CRUD
  app.post('/api/admin/products', requireAuth, requireAdmin, (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    const price = Number(req.body?.price);
    const imageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl.trim() : '';
    const variations = Array.isArray(req.body?.variations)
      ? req.body.variations.map((v: unknown) => String(v).trim()).filter(Boolean)
      : [];
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
    const result = db
      .prepare(
        'INSERT INTO products (name, category, description, price, imageUrl, variationsJson, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(name, category, description, roundMoney(price), imageUrl, JSON.stringify(variations), active, now, now);

    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(result.lastInsertRowid)) as Record<
      string,
      unknown
    >;
    res.status(201).json({ product: mapProductRow(row) });
  });

  app.put('/api/admin/products/:id', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Produto não encontrado.' });
      return;
    }

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    const price = Number(req.body?.price);
    const imageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl.trim() : '';
    const variations = Array.isArray(req.body?.variations)
      ? req.body.variations.map((v: unknown) => String(v).trim()).filter(Boolean)
      : [];
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
    db.prepare(
      'UPDATE products SET name = ?, category = ?, description = ?, price = ?, imageUrl = ?, variationsJson = ?, active = ?, updatedAt = ? WHERE id = ?'
    ).run(name, category, description, roundMoney(price), imageUrl, JSON.stringify(variations), active, now, id);

    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Record<string, unknown>;
    res.json({ product: mapProductRow(row) });
  });

  app.delete('/api/admin/products/:id', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    res.json({ deleted: true });
  });

  // Admin Coupons CRUD
  app.post('/api/admin/coupons', requireAuth, requireAdmin, (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase().replace(/\s+/g, '') : '';
    const rawType = String(req.body?.discountType || 'percent');
    const discountType = rawType === 'fixed' ? 'fixed' : rawType === 'free_shipping' ? 'free_shipping' : 'percent';
    const discountValue = discountType === 'free_shipping' ? 0 : Number(req.body?.discountValue);
    const minOrderValue = Number(req.body?.minOrderValue || 0);
    const freeShipping = discountType === 'free_shipping' ? 1 : 0;
    const active = req.body?.active !== false ? 1 : 0;

    if (!code || code.length < 2 || (discountType !== 'free_shipping' && (!Number.isFinite(discountValue) || discountValue <= 0))) {
      res.status(400).json({ error: 'Código e valor de desconto válidos são obrigatórios.' });
      return;
    }
    if (discountType === 'percent' && discountValue > 100) {
      res.status(400).json({ error: 'Desconto percentual não pode exceder 100%.' });
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
        'INSERT INTO coupons (code, discountType, discountValue, minOrderValue, freeShipping, active, usageCount, createdAt) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
      )
      .run(code, discountType, roundMoney(discountValue), Math.max(0, roundMoney(minOrderValue)), freeShipping, active, now);

    const row = db.prepare('SELECT * FROM coupons WHERE id = ?').get(Number(result.lastInsertRowid)) as Record<
      string,
      unknown
    >;
    res.status(201).json({ coupon: mapCouponRow(row) });
  });

  app.put('/api/admin/coupons/:id', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    const existing = db.prepare('SELECT * FROM coupons WHERE id = ?').get(id);
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

    if (!code || (discountType !== 'free_shipping' && (!Number.isFinite(discountValue) || discountValue <= 0))) {
      res.status(400).json({ error: 'Código e valor de desconto válidos são obrigatórios.' });
      return;
    }
    if (discountType === 'percent' && discountValue > 100) {
      res.status(400).json({ error: 'Desconto percentual não pode exceder 100%.' });
      return;
    }

    const duplicate = db.prepare('SELECT id FROM coupons WHERE upper(code) = ? AND id != ?').get(code, id);
    if (duplicate) {
      res.status(409).json({ error: 'Já existe outro cupom com este código.' });
      return;
    }

    db.prepare(
      'UPDATE coupons SET code = ?, discountType = ?, discountValue = ?, minOrderValue = ?, freeShipping = ?, active = ? WHERE id = ?'
    ).run(code, discountType, roundMoney(discountValue), Math.max(0, roundMoney(minOrderValue)), freeShipping, active, id);

    const row = db.prepare('SELECT * FROM coupons WHERE id = ?').get(id) as Record<string, unknown>;
    res.json({ coupon: mapCouponRow(row) });
  });

  app.delete('/api/admin/coupons/:id', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    db.prepare('DELETE FROM coupons WHERE id = ?').run(id);
    res.json({ deleted: true });
  });

  // Admin Carousel CRUD
  app.post('/api/admin/carousel', requireAuth, requireAdmin, (req, res) => {
    const tag = typeof req.body?.tag === 'string' ? req.body.tag.trim() : '';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const subtitle = typeof req.body?.subtitle === 'string' ? req.body.subtitle.trim() : '';
    const ctaText = typeof req.body?.ctaText === 'string' ? req.body.ctaText.trim() || 'Ver catálogo' : 'Ver catálogo';
    const targetCategory =
      typeof req.body?.targetCategory === 'string' ? req.body.targetCategory.trim() || 'Todos' : 'Todos';
    const imageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl.trim() : '';
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

    const result = db
      .prepare(
        'INSERT INTO carousel_slides (tag, title, subtitle, ctaText, targetCategory, imageUrl, sortOrder, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(tag, title, subtitle, ctaText, targetCategory, imageUrl, sortOrder, active);

    const row = db.prepare('SELECT * FROM carousel_slides WHERE id = ?').get(Number(result.lastInsertRowid)) as Record<
      string,
      unknown
    >;
    res.status(201).json({ slide: mapSlideRow(row) });
  });

  app.put('/api/admin/carousel/:id', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    const existing = db.prepare('SELECT * FROM carousel_slides WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Slide não encontrado.' });
      return;
    }

    const tag = typeof req.body?.tag === 'string' ? req.body.tag.trim() : '';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const subtitle = typeof req.body?.subtitle === 'string' ? req.body.subtitle.trim() : '';
    const ctaText = typeof req.body?.ctaText === 'string' ? req.body.ctaText.trim() || 'Ver catálogo' : 'Ver catálogo';
    const targetCategory =
      typeof req.body?.targetCategory === 'string' ? req.body.targetCategory.trim() || 'Todos' : 'Todos';
    const imageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl.trim() : '';
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

    db.prepare(
      'UPDATE carousel_slides SET tag = ?, title = ?, subtitle = ?, ctaText = ?, targetCategory = ?, imageUrl = ?, sortOrder = ?, active = ? WHERE id = ?'
    ).run(tag, title, subtitle, ctaText, targetCategory, imageUrl, sortOrder, active, id);

    const row = db.prepare('SELECT * FROM carousel_slides WHERE id = ?').get(id) as Record<string, unknown>;
    res.json({ slide: mapSlideRow(row) });
  });

  app.delete('/api/admin/carousel/:id', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    db.prepare('DELETE FROM carousel_slides WHERE id = ?').run(id);
    res.json({ deleted: true });
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
    res.json({ settings: mapSettingsRow(row) });
  });

  // Admin Order Status Update -> Automatically grants 1 roulette chance per R$ 50,00 subtotal on 'Confirmado'
  app.patch('/api/admin/orders/:id/status', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const status = req.body?.status as OrderStatus;
    if (!Number.isInteger(id) || !VALID_ORDER_STATUSES.includes(status)) {
      res.status(400).json({ error: 'Dados inválidos para atualizar pedido.' });
      return;
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

      const updatedRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Record<string, unknown>;
      const updatedOrder = mapOrderRow(updatedRow);
      db.exec('COMMIT');

      // Real-time push to the customer's open browser session
      pushUserEvent(updatedOrder.userId, 'order_updated', {
        orderId: updatedOrder.id,
        orderNumber: updatedOrder.orderNumber,
        status: updatedOrder.status,
      });
      if (grantedNow > 0) {
        pushUserEvent(updatedOrder.userId, 'roulette_updated', {
          grantedNow,
          orderNumber: updatedOrder.orderNumber,
        });
      }

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
      server: { middlewareMode: true },
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
  app.listen(port, '0.0.0.0', () => {
    console.log(`R&P Tabacaria server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
