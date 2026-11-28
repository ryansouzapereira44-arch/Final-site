import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  CarouselSlide,
  CourierGpsStatus,
  CourierSummary,
  Coupon,
  CustomerSummary,
  DeliveryAddress,
  DeliveryTrackingInfo,
  Order,
  OrderStatus,
  Product,
  ProductSuggestion,
  RouletteChance,
  RoulettePrize,
  RoulettePrizeType,
  RouletteSpin,
  StoreSettings,
  User,
  UserRole,
} from '../src/types.ts';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'tabacaria.db');
export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    whatsapp TEXT NOT NULL DEFAULT '',
    cpf TEXT NOT NULL DEFAULT '',
    addressJson TEXT,
    passwordHash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer',
    active INTEGER NOT NULL DEFAULT 1,
    archived INTEGER NOT NULL DEFAULT 0,
    archivedAt TEXT,
    welcomeCampaignSeen INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS seed_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL,
    costPrice REAL NOT NULL DEFAULT 0,
    freightCostUnit REAL NOT NULL DEFAULT 0,
    packagingCostUnit REAL NOT NULL DEFAULT 0,
    otherCostUnit REAL NOT NULL DEFAULT 0,
    purchasedQuantity INTEGER NOT NULL DEFAULT 0,
    stockQuantity INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    archivedAt TEXT,
    imageUrl TEXT NOT NULL DEFAULT '',
    variationLabel TEXT NOT NULL DEFAULT '',
    variationsJson TEXT NOT NULL DEFAULT '[]',
    secondaryVariationLabel TEXT NOT NULL DEFAULT '',
    secondaryVariationsJson TEXT NOT NULL DEFAULT '[]',
    variationStockJson TEXT NOT NULL DEFAULT '{}',
    active INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS product_cost_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    productId INTEGER NOT NULL,
    quantityPurchased INTEGER NOT NULL,
    remainingQuantity INTEGER NOT NULL,
    unitPurchaseCost REAL NOT NULL,
    freightCostUnit REAL NOT NULL DEFAULT 0,
    packagingCostUnit REAL NOT NULL DEFAULT 0,
    otherCostUnit REAL NOT NULL DEFAULT 0,
    totalUnitCost REAL NOT NULL,
    supplierNote TEXT NOT NULL DEFAULT '',
    purchasedAt TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    createdByAdminId INTEGER,
    FOREIGN KEY (productId) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS product_cost_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    productId INTEGER NOT NULL,
    productNameSnapshot TEXT NOT NULL,
    eventType TEXT NOT NULL,
    unitPurchaseCost REAL NOT NULL,
    freightCostUnit REAL NOT NULL DEFAULT 0,
    packagingCostUnit REAL NOT NULL DEFAULT 0,
    otherCostUnit REAL NOT NULL DEFAULT 0,
    totalUnitCost REAL NOT NULL,
    salePrice REAL NOT NULL,
    purchasedQuantity INTEGER NOT NULL DEFAULT 0,
    stockQuantity INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    recordedAt TEXT NOT NULL,
    FOREIGN KEY (productId) REFERENCES products(id)
  );

  CREATE INDEX IF NOT EXISTS idx_cost_batches_product ON product_cost_batches(productId, id DESC);
  CREATE INDEX IF NOT EXISTS idx_cost_history_product_date ON product_cost_history(productId, recordedAt DESC, id DESC);

  CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    discountType TEXT NOT NULL,
    discountValue REAL NOT NULL,
    minOrderValue REAL NOT NULL DEFAULT 0,
    freeShipping INTEGER NOT NULL DEFAULT 0,
    ownerUserId INTEGER,
    allowedEmail TEXT,
    allowMultipleUses INTEGER NOT NULL DEFAULT 1,
    maxUses INTEGER,
    expiresAt TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    usageCount INTEGER NOT NULL DEFAULT 0,
    expirationReminderSentAt TEXT,
    createdAt TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_coupons_expiring_reminder ON coupons(ownerUserId, active, expiresAt);

  CREATE TABLE IF NOT EXISTS coupon_usages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    couponId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    orderId INTEGER,
    usedAt TEXT NOT NULL,
    FOREIGN KEY (couponId) REFERENCES coupons(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS carousel_slides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL DEFAULT '',
    ctaText TEXT NOT NULL DEFAULT 'Ver catálogo',
    targetCategory TEXT NOT NULL DEFAULT 'Todos',
    linkUrl TEXT NOT NULL DEFAULT '',
    imageUrl TEXT NOT NULL DEFAULT '',
    storagePath TEXT NOT NULL DEFAULT '',
    sortOrder INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    deleted INTEGER NOT NULL DEFAULT 0,
    deletedAt TEXT,
    createdAt TEXT NOT NULL DEFAULT '',
    updatedAt TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS uploaded_media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT UNIQUE NOT NULL,
    mimeType TEXT NOT NULL,
    data BLOB NOT NULL,
    sizeBytes INTEGER NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS store_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    storeName TEXT NOT NULL,
    storeOpen INTEGER NOT NULL DEFAULT 1,
    closedMessage TEXT NOT NULL DEFAULT 'Estamos fechados no momento. Voltamos em breve!',
    minDeliveryOrder REAL NOT NULL,
    shippingMode TEXT NOT NULL,
    shippingPerKm REAL NOT NULL DEFAULT 1.5,
    freeShippingKm REAL NOT NULL DEFAULT 1.5,
    shippingFee REAL,
    freeShippingThreshold REAL,
    storeCep TEXT NOT NULL DEFAULT '01001-000',
    storeLat REAL NOT NULL DEFAULT -23.55052,
    storeLng REAL NOT NULL DEFAULT -46.633308,
    storeAddress TEXT NOT NULL,
    storeHours TEXT NOT NULL,
    storeWhatsapp TEXT NOT NULL,
    pickupInstructions TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orderNumber INTEGER UNIQUE NOT NULL,
    userId INTEGER NOT NULL,
    customerName TEXT NOT NULL,
    customerWhatsapp TEXT NOT NULL,
    customerCpf TEXT NOT NULL DEFAULT '',
    deliveryMethod TEXT NOT NULL,
    addressJson TEXT,
    distanceKm REAL,
    paymentMethod TEXT NOT NULL,
    changeFor TEXT NOT NULL DEFAULT '',
    itemsJson TEXT NOT NULL,
    subtotal REAL NOT NULL,
    discountAmount REAL NOT NULL DEFAULT 0,
    couponCode TEXT,
    shippingFee REAL,
    shippingLabel TEXT NOT NULL,
    total REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pendente',
    rouletteGranted INTEGER NOT NULL DEFAULT 0,
    stockDeducted INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS roulette_prizes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    shortLabel TEXT NOT NULL,
    prizeType TEXT NOT NULL,
    discountValue REAL NOT NULL DEFAULT 0,
    weight INTEGER NOT NULL DEFAULT 10,
    color TEXT NOT NULL DEFAULT '#141414',
    active INTEGER NOT NULL DEFAULT 1,
    sortOrder INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS roulette_chances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    orderId INTEGER NOT NULL,
    orderNumber INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'available',
    grantedAt TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    usedAt TEXT,
    FOREIGN KEY (userId) REFERENCES users(id),
    FOREIGN KEY (orderId) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS roulette_spins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    userName TEXT NOT NULL,
    chanceId INTEGER NOT NULL,
    prizeId INTEGER NOT NULL,
    prizeLabel TEXT NOT NULL,
    prizeType TEXT NOT NULL,
    couponCode TEXT,
    couponExpiresAt TEXT,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS delivery_tracking_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orderId INTEGER NOT NULL,
    courierId INTEGER NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    accuracy REAL,
    heading REAL,
    speed REAL,
    recordedAt TEXT NOT NULL,
    FOREIGN KEY (orderId) REFERENCES orders(id),
    FOREIGN KEY (courierId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    tokenHash TEXT UNIQUE NOT NULL,
    expiresAt TEXT NOT NULL,
    usedAt TEXT,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS product_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    customerName TEXT NOT NULL,
    customerEmail TEXT NOT NULL,
    suggestion TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users(id)
  );
`);

function ensureColumn(table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Safe migrations on existing DB
ensureColumn('users', 'cpf', "TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'addressJson', 'TEXT');
ensureColumn('coupons', 'freeShipping', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('coupons', 'ownerUserId', 'INTEGER');
ensureColumn('coupons', 'allowedEmail', 'TEXT');
ensureColumn('coupons', 'allowMultipleUses', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('coupons', 'maxUses', 'INTEGER');
ensureColumn('coupons', 'expiresAt', 'TEXT');
ensureColumn('coupons', 'expirationReminderSentAt', 'TEXT');
ensureColumn('roulette_spins', 'couponExpiresAt', 'TEXT');
ensureColumn('orders', 'distanceKm', 'REAL');
ensureColumn('orders', 'rouletteGranted', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('store_settings', 'storeOpen', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn(
  'store_settings',
  'closedMessage',
  "TEXT NOT NULL DEFAULT 'Estamos fechados no momento. Voltamos em breve!'"
);
ensureColumn('store_settings', 'shippingPerKm', 'REAL NOT NULL DEFAULT 1.5');
ensureColumn('store_settings', 'freeShippingKm', 'REAL NOT NULL DEFAULT 1.5');
ensureColumn('store_settings', 'storeCep', "TEXT NOT NULL DEFAULT '01001-000'");
ensureColumn('users', 'active', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('users', 'archived', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'archivedAt', 'TEXT');
ensureColumn('users', 'welcomeCampaignSeen', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('orders', 'destLat', 'REAL');
ensureColumn('orders', 'destLng', 'REAL');
ensureColumn('orders', 'assignedCourierId', 'INTEGER');
ensureColumn('orders', 'assignedCourierName', "TEXT NOT NULL DEFAULT ''");
ensureColumn('orders', 'trackingActive', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('orders', 'courierLat', 'REAL');
ensureColumn('orders', 'courierLng', 'REAL');
ensureColumn('orders', 'courierAccuracy', 'REAL');
ensureColumn('orders', 'courierHeading', 'REAL');
ensureColumn('orders', 'courierSpeed', 'REAL');
ensureColumn('orders', 'courierGpsStatus', "TEXT NOT NULL DEFAULT 'waiting'");
ensureColumn('orders', 'lastLocationAt', 'TEXT');
ensureColumn('orders', 'deliveredAt', 'TEXT');
ensureColumn('store_settings', 'storeLat', 'REAL NOT NULL DEFAULT -23.55052');
ensureColumn('store_settings', 'storeLng', 'REAL NOT NULL DEFAULT -46.633308');
ensureColumn('products', 'sku', "TEXT NOT NULL DEFAULT ''");
ensureColumn('products', 'costPrice', 'REAL NOT NULL DEFAULT 0');
ensureColumn('products', 'freightCostUnit', 'REAL NOT NULL DEFAULT 0');
ensureColumn('products', 'packagingCostUnit', 'REAL NOT NULL DEFAULT 0');
ensureColumn('products', 'otherCostUnit', 'REAL NOT NULL DEFAULT 0');
ensureColumn('products', 'purchasedQuantity', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('products', 'stockQuantity', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('products', 'archived', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('products', 'archivedAt', 'TEXT');
ensureColumn('products', 'variationLabel', "TEXT NOT NULL DEFAULT ''");
ensureColumn('products', 'secondaryVariationLabel', "TEXT NOT NULL DEFAULT ''");
ensureColumn('products', 'secondaryVariationsJson', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('products', 'variationStockJson', "TEXT NOT NULL DEFAULT '{}'");
ensureColumn('products', 'badgeLabel', "TEXT NOT NULL DEFAULT ''");
ensureColumn('orders', 'stockDeducted', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('carousel_slides', 'linkUrl', "TEXT NOT NULL DEFAULT ''");
ensureColumn('carousel_slides', 'storagePath', "TEXT NOT NULL DEFAULT ''");
ensureColumn('carousel_slides', 'deleted', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('carousel_slides', 'deletedAt', 'TEXT');
ensureColumn('carousel_slides', 'createdAt', "TEXT NOT NULL DEFAULT ''");
ensureColumn('carousel_slides', 'updatedAt', "TEXT NOT NULL DEFAULT ''");

function seedInitialData(): void {
  const now = new Date().toISOString();

  const settingsCount = db.prepare('SELECT COUNT(*) as count FROM store_settings').get() as { count: number };
  if (settingsCount.count === 0) {
    db.prepare(`
      INSERT INTO store_settings (
        id, storeName, storeOpen, closedMessage, minDeliveryOrder,
        shippingMode, shippingPerKm, freeShippingKm, shippingFee, freeShippingThreshold,
        storeCep, storeLat, storeLng, storeAddress, storeHours, storeWhatsapp, pickupInstructions
      ) VALUES (1, ?, 1, ?, ?, 'per_km', 1.5, 1.5, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'R&P Tabacaria',
      'Estamos fechados no momento. Voltamos em breve!',
      0,
      '01001-000',
      -23.55052,
      -46.633308,
      'Av. Central, 420 - Loja 02, Centro',
      'Seg a Sáb: 10h às 22h | Dom: 12h às 20h',
      '(11) 99999-0000',
      'Apresente o número do pedido no balcão para retirada rápida.'
    );
  }

  const seedDoneRow = db
    .prepare("SELECT value FROM seed_meta WHERE key = 'initial_seed_v1'")
    .get() as { value: string } | undefined;
  const alreadySeeded = seedDoneRow?.value === '1';

  if (!alreadySeeded) {
    const prizesCount = db.prepare('SELECT COUNT(*) as count FROM roulette_prizes').get() as { count: number };
    if (prizesCount.count === 0) {
      const insertPrize = db.prepare(`
        INSERT INTO roulette_prizes (label, shortLabel, prizeType, discountValue, weight, color, active, sortOrder)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `);
      insertPrize.run('Frete Grátis', 'FRETE GRÁTIS', 'free_shipping', 0, 15, '#FFFFFF', 1);
      insertPrize.run('5% de Desconto', '5% OFF', 'percent', 5, 30, '#181818', 2);
      insertPrize.run('10% de Desconto', '10% OFF', 'percent', 10, 20, '#2B2B2B', 3);
      insertPrize.run('15% de Desconto', '15% OFF', 'percent', 15, 10, '#FFFFFF', 4);
      insertPrize.run('Não foi dessa vez', 'NADA', 'none', 0, 25, '#0F0F0F', 5);
    }

    const slidesCount = db.prepare('SELECT COUNT(*) as count FROM carousel_slides').get() as { count: number };
    if (slidesCount.count === 0) {
      const insertSlide = db.prepare(`
        INSERT INTO carousel_slides (tag, title, subtitle, ctaText, targetCategory, imageUrl, sortOrder, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `);
      insertSlide.run(
        'QUALIDADE · VARIEDADE · SEMPRE COM VOCÊ',
        'Mais que tabacaria, é estilo de vida.',
        'Narguilés completos, essências premium, carvões de coco e acessórios com padrão R&P.',
        'Explorar catálogo',
        'Todos',
        '',
        1
      );
      insertSlide.run(
        'SELEÇÃO DE ESSÊNCIAS',
        'Sabores intensos para cada sessão',
        'Escolha o sabor ideal diretamente no card do produto e monte seu pedido em segundos.',
        'Ver essências',
        'Essências',
        '',
        2
      );
      insertSlide.run(
        'ENTREGA OU RETIRADA',
        'Frete grátis até 1,5 km e R$ 1,50 por km',
        'A cada R$ 50,00 em produtos você ganha 1 chance na Roleta R&P após a confirmação do pedido.',
        'Ver narguilés',
        'Narguilés',
        '',
        3
      );
    }

    const productsCount = db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number };
    if (productsCount.count === 0) {
      const insertProduct = db.prepare(`
        INSERT INTO products (name, category, description, price, purchasedQuantity, stockQuantity, imageUrl, variationsJson, active, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `);

      insertProduct.run(
        'Narguilé R&P Black Edition',
        'Narguilés',
        'Setup completo em alumínio anodizado preto fosco com vaso de cristal fumê e mangueira de silicone.',
        349.9,
        15,
        15,
        '/src/assets/images/product_hookah_black_1795779511252.jpg',
        JSON.stringify(['Preto Fosco / Prata', 'Preto Total']),
        now,
        now
      );

      insertProduct.run(
        'Essência Premium Blend 250g',
        'Essências',
        'Corte fino com alta resistência ao calor e fumaça densa. Embalagem lacrada de 250g.',
        68.9,
        24,
        24,
        '/src/assets/images/product_tobacco_essence_1795779511616.jpg',
        JSON.stringify(['Dark Berry', 'Menta Glacial', 'Melancia Ice', 'Love 66', 'Uva Roxa']),
        now,
        now
      );

      insertProduct.run(
        'Essência Classic Pack 50g',
        'Essências',
        'Pack tradicional 50g com sabores clássicos e refrescantes para sessões equilibradas.',
        18.5,
        30,
        30,
        '/src/assets/images/product_tobacco_essence_1795779511616.jpg',
        JSON.stringify(['Hortelã', 'Morango com Creme', 'Maracujá', 'Limão Siciliano']),
        now,
        now
      );

      insertProduct.run(
        'Carvão de Coco Natural 1kg',
        'Carvão',
        'Carvão 100% fibra de coco de alta duração, baixa cinza e sem alteração de sabor.',
        34.9,
        20,
        20,
        '/src/assets/images/product_coconut_charcoal_1795779511363.jpg',
        JSON.stringify(['Cubo 26mm (1kg)', 'Hexagonal (1kg)']),
        now,
        now
      );

      insertProduct.run(
        'Rosh Cerâmico Phunnel Black',
        'Rosh & Acessórios',
        'Queimador artesanal em cerâmica esmaltada de alta retenção térmica para sessões longas.',
        49.9,
        14,
        14,
        '/src/assets/images/product_ceramic_rosh_1795779511909.jpg',
        JSON.stringify(['Borda Metálica', 'Preto Clássico']),
        now,
        now
      );

      insertProduct.run(
        'Pod System Ionic Matte',
        'Pods & Vapes',
        'Dispositivo compacto recarregável USB-C com acabamento metálico fosco e fluxo ajustável.',
        159.9,
        18,
        18,
        '/src/assets/images/product_pod_device_1795779511951.jpg',
        JSON.stringify(['Mint Ice', 'Grape Ice', 'Strawberry Kiwi', 'Menthol']),
        now,
        now
      );
    }

    const couponsCount = db.prepare('SELECT COUNT(*) as count FROM coupons').get() as { count: number };
    if (couponsCount.count === 0) {
      db.prepare(`
        INSERT INTO coupons (code, discountType, discountValue, minOrderValue, freeShipping, active, usageCount, createdAt)
        VALUES (?, ?, ?, ?, 0, 1, 0, ?)
      `).run('RP10', 'percent', 10, 60, now);
    }

    db.prepare("INSERT OR REPLACE INTO seed_meta (key, value) VALUES ('initial_seed_v1', '1')").run();
  }

  // One-time stock initialization for legacy seeded products that never had stock configured
  const stockSeedDoneRow = db
    .prepare("SELECT value FROM seed_meta WHERE key = 'initial_stock_seed_v1'")
    .get() as { value: string } | undefined;
  if (stockSeedDoneRow?.value !== '1') {
    db.prepare(
      'UPDATE products SET purchasedQuantity = 20, stockQuantity = 20, updatedAt = ? WHERE purchasedQuantity = 0 AND stockQuantity = 0 AND archived = 0'
    ).run(now);
    db.prepare("INSERT OR REPLACE INTO seed_meta (key, value) VALUES ('initial_stock_seed_v1', '1')").run();
  }

  // Backfill 7-day expiration on any legacy roulette coupons/spins missing expiresAt
  const legacyCoupons = db
    .prepare('SELECT id, code, createdAt FROM coupons WHERE ownerUserId IS NOT NULL AND expiresAt IS NULL')
    .all() as { id: number; code: string; createdAt: string }[];
  for (const lc of legacyCoupons) {
    const exp = new Date(new Date(lc.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE coupons SET expiresAt = ? WHERE id = ?').run(exp, lc.id);
    db.prepare('UPDATE roulette_spins SET couponExpiresAt = ? WHERE couponCode = ? AND couponExpiresAt IS NULL').run(
      exp,
      lc.code
    );
  }

  // Ensure single-use roulette/capped coupons reflect allowMultipleUses = 0
  db.prepare('UPDATE coupons SET allowMultipleUses = 0 WHERE maxUses = 1 AND allowMultipleUses != 0').run();

  // Backfill coupon_usages from existing orders if not yet recorded
  const ordersWithCoupon = db
    .prepare(
      `SELECT o.id as orderId, o.userId as userId, o.createdAt as createdAt, c.id as couponId
       FROM orders o
       JOIN coupons c ON upper(c.code) = upper(o.couponCode)
       WHERE o.couponCode IS NOT NULL AND o.couponCode != ''
         AND NOT EXISTS (
           SELECT 1 FROM coupon_usages cu WHERE cu.orderId = o.id AND cu.couponId = c.id
         )`
    )
    .all() as { orderId: number; userId: number; createdAt: string; couponId: number }[];
  for (const usage of ordersWithCoupon) {
    db.prepare('INSERT INTO coupon_usages (couponId, userId, orderId, usedAt) VALUES (?, ?, ?, ?)').run(
      usage.couponId,
      usage.userId,
      usage.orderId,
      usage.createdAt
    );
  }

  // Backfill SKU and initial cost history snapshot for existing products
  const allProducts = db
    .prepare(
      'SELECT id, sku, name, price, costPrice, freightCostUnit, packagingCostUnit, otherCostUnit, purchasedQuantity, stockQuantity, createdAt FROM products'
    )
    .all() as {
    id: number;
    sku: string;
    name: string;
    price: number;
    costPrice: number;
    freightCostUnit: number;
    packagingCostUnit: number;
    otherCostUnit: number;
    purchasedQuantity: number;
    stockQuantity: number;
    createdAt: string;
  }[];

  for (const prod of allProducts) {
    if (!prod.sku || !prod.sku.trim()) {
      const generatedSku = `RP-${String(prod.id).padStart(4, '0')}`;
      db.prepare('UPDATE products SET sku = ? WHERE id = ?').run(generatedSku, prod.id);
    }
    const historyExists = db
      .prepare('SELECT 1 FROM product_cost_history WHERE productId = ? LIMIT 1')
      .get(prod.id);
    if (!historyExists) {
      const totalUnitCost =
        Math.round(
          (Number(prod.costPrice || 0) +
            Number(prod.freightCostUnit || 0) +
            Number(prod.packagingCostUnit || 0) +
            Number(prod.otherCostUnit || 0) +
            Number.EPSILON) *
            100
        ) / 100;
      db.prepare(`
        INSERT INTO product_cost_history (
          productId, productNameSnapshot, eventType, unitPurchaseCost,
          freightCostUnit, packagingCostUnit, otherCostUnit, totalUnitCost,
          salePrice, purchasedQuantity, stockQuantity, note, recordedAt
        ) VALUES (?, ?, 'initial', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        prod.id,
        prod.name,
        Number(prod.costPrice || 0),
        Number(prod.freightCostUnit || 0),
        Number(prod.packagingCostUnit || 0),
        Number(prod.otherCostUnit || 0),
        totalUnitCost,
        Number(prod.price || 0),
        Number(prod.purchasedQuantity || 0),
        Number(prod.stockQuantity || 0),
        'Registro inicial sincronizado do catálogo',
        prod.createdAt || now
      );
    }
  }
}

seedInitialData();

export function mapUserRow(row: Record<string, unknown>): User {
  let savedAddress: DeliveryAddress | null = null;
  if (row.addressJson) {
    try {
      savedAddress = JSON.parse(String(row.addressJson)) as DeliveryAddress;
    } catch {
      savedAddress = null;
    }
  }
  const rawRole = String(row.role || 'customer');
  const role: UserRole = rawRole === 'admin' ? 'admin' : rawRole === 'courier' ? 'courier' : 'customer';
  return {
    id: Number(row.id),
    name: String(row.name),
    email: String(row.email),
    whatsapp: String(row.whatsapp || ''),
    cpf: String(row.cpf || ''),
    savedAddress,
    role,
    active: row.active !== 0,
    welcomeCampaignSeen: Boolean(row.welcomeCampaignSeen),
    createdAt: String(row.createdAt),
  };
}

export function formatProductSku(id: number, rawSku?: unknown): string {
  const cleaned = typeof rawSku === 'string' ? rawSku.trim().toUpperCase() : '';
  return cleaned || `RP-${String(id).padStart(4, '0')}`;
}

function parseVariationStockJson(raw: unknown): Record<string, number> {
  try {
    const parsed = JSON.parse(String(raw || '{}'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const key = String(k).trim();
      const num = Number(v);
      if (key && Number.isFinite(num)) {
        out[key] = Math.max(0, Math.round(num));
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function mapProductRow(row: Record<string, unknown>): Product {
  let variations: string[] = [];
  try {
    const parsed = JSON.parse(String(row.variationsJson || '[]'));
    if (Array.isArray(parsed)) {
      variations = parsed.map((v) => String(v)).filter(Boolean);
    }
  } catch {
    variations = [];
  }
  let secondaryVariations: string[] = [];
  try {
    const parsed = JSON.parse(String(row.secondaryVariationsJson || '[]'));
    if (Array.isArray(parsed)) {
      secondaryVariations = parsed.map((v) => String(v)).filter(Boolean);
    }
  } catch {
    secondaryVariations = [];
  }
  const id = Number(row.id);
  return {
    id,
    sku: formatProductSku(id, row.sku),
    name: String(row.name),
    category: String(row.category),
    description: String(row.description || ''),
    badgeLabel: String(row.badgeLabel || ''),
    price: Number(row.price),
    costPrice: Number(row.costPrice || 0),
    freightCostUnit: Number(row.freightCostUnit || 0),
    packagingCostUnit: Number(row.packagingCostUnit || 0),
    otherCostUnit: Number(row.otherCostUnit || 0),
    purchasedQuantity: Math.max(0, Math.round(Number(row.purchasedQuantity || 0))),
    stockQuantity: Math.max(0, Math.round(Number(row.stockQuantity || 0))),
    archived: Boolean(row.archived),
    archivedAt: row.archivedAt ? String(row.archivedAt) : null,
    imageUrl: String(row.imageUrl || ''),
    variationLabel: String(row.variationLabel || ''),
    variations,
    secondaryVariationLabel: String(row.secondaryVariationLabel || ''),
    secondaryVariations,
    variationStock: parseVariationStockJson(row.variationStockJson),
    active: Boolean(row.active),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

export function mapPublicProductRow(row: Record<string, unknown>): Product {
  let variations: string[] = [];
  try {
    const parsed = JSON.parse(String(row.variationsJson || '[]'));
    if (Array.isArray(parsed)) {
      variations = parsed.map((v) => String(v)).filter(Boolean);
    }
  } catch {
    variations = [];
  }
  let secondaryVariations: string[] = [];
  try {
    const parsed = JSON.parse(String(row.secondaryVariationsJson || '[]'));
    if (Array.isArray(parsed)) {
      secondaryVariations = parsed.map((v) => String(v)).filter(Boolean);
    }
  } catch {
    secondaryVariations = [];
  }
  const id = Number(row.id);
  return {
    id,
    sku: formatProductSku(id, row.sku),
    name: String(row.name),
    category: String(row.category),
    description: String(row.description || ''),
    badgeLabel: String(row.badgeLabel || ''),
    price: Number(row.price),
    stockQuantity: Math.max(0, Math.round(Number(row.stockQuantity || 0))),
    imageUrl: String(row.imageUrl || ''),
    variationLabel: String(row.variationLabel || ''),
    variations,
    secondaryVariationLabel: String(row.secondaryVariationLabel || ''),
    secondaryVariations,
    variationStock: parseVariationStockJson(row.variationStockJson),
    active: Boolean(row.active),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

export function mapCouponRow(row: Record<string, unknown>): Coupon {
  const rawType = String(row.discountType);
  const discountType: Coupon['discountType'] =
    rawType === 'fixed' ? 'fixed' : rawType === 'free_shipping' ? 'free_shipping' : 'percent';
  const maxUses = row.maxUses !== null && row.maxUses !== undefined ? Number(row.maxUses) : null;
  const allowMultipleRaw =
    row.allowMultipleUses !== null && row.allowMultipleUses !== undefined
      ? Boolean(row.allowMultipleUses)
      : maxUses !== 1;
  return {
    id: Number(row.id),
    code: String(row.code),
    discountType,
    discountValue: Number(row.discountValue),
    minOrderValue: Number(row.minOrderValue || 0),
    freeShipping: Boolean(row.freeShipping) || discountType === 'free_shipping',
    ownerUserId: row.ownerUserId !== null && row.ownerUserId !== undefined ? Number(row.ownerUserId) : null,
    allowedEmail: row.allowedEmail ? String(row.allowedEmail).trim().toLowerCase() : null,
    allowMultipleUses: allowMultipleRaw,
    maxUses,
    expiresAt: row.expiresAt ? String(row.expiresAt) : null,
    active: Boolean(row.active),
    usageCount: Number(row.usageCount || 0),
    createdAt: String(row.createdAt),
  };
}

export function mapSlideRow(row: Record<string, unknown>): CarouselSlide {
  return {
    id: Number(row.id),
    tag: String(row.tag || ''),
    title: String(row.title),
    subtitle: String(row.subtitle || ''),
    ctaText: String(row.ctaText || 'Ver catálogo'),
    targetCategory: String(row.targetCategory || 'Todos'),
    linkUrl: String(row.linkUrl || ''),
    imageUrl: String(row.imageUrl || ''),
    storagePath: String(row.storagePath || ''),
    sortOrder: Number(row.sortOrder || 0),
    active: Boolean(row.active),
    createdAt: row.createdAt ? String(row.createdAt) : undefined,
    updatedAt: row.updatedAt ? String(row.updatedAt) : undefined,
  };
}

export function mapSettingsRow(row: Record<string, unknown>): StoreSettings {
  const rawMode = String(row.shippingMode || 'per_km');
  const shippingMode =
    rawMode === 'fixed' ? 'fixed' : rawMode === 'to_confirm' ? 'to_confirm' : 'per_km';

  return {
    storeName: String(row.storeName),
    storeOpen: row.storeOpen !== 0,
    closedMessage: String(row.closedMessage || 'Estamos fechados no momento. Voltamos em breve!'),
    minDeliveryOrder: Number(row.minDeliveryOrder || 0),
    shippingMode,
    shippingPerKm: Number(row.shippingPerKm ?? 1.5),
    freeShippingKm: Number(row.freeShippingKm ?? 1.5),
    shippingFee: row.shippingFee !== null && row.shippingFee !== undefined ? Number(row.shippingFee) : null,
    freeShippingThreshold:
      row.freeShippingThreshold !== null && row.freeShippingThreshold !== undefined
        ? Number(row.freeShippingThreshold)
        : null,
    storeCep: String(row.storeCep || '01001-000'),
    storeLat: Number(row.storeLat ?? -23.55052),
    storeLng: Number(row.storeLng ?? -46.633308),
    storeAddress: String(row.storeAddress),
    storeHours: String(row.storeHours),
    storeWhatsapp: String(row.storeWhatsapp),
    pickupInstructions: String(row.pickupInstructions),
  };
}

export function mapOrderRow(row: Record<string, unknown>): Order {
  let address: DeliveryAddress | null = null;
  if (row.addressJson) {
    try {
      address = JSON.parse(String(row.addressJson)) as DeliveryAddress;
    } catch {
      address = null;
    }
  }
  let items = [];
  try {
    items = JSON.parse(String(row.itemsJson || '[]'));
  } catch {
    items = [];
  }
  const rawGpsStatus = String(row.courierGpsStatus || 'waiting');
  const courierGpsStatus: CourierGpsStatus =
    rawGpsStatus === 'active' || rawGpsStatus === 'unavailable' || rawGpsStatus === 'ended'
      ? rawGpsStatus
      : 'waiting';
  const destLat = row.destLat !== null && row.destLat !== undefined ? Number(row.destLat) : null;
  const destLng = row.destLng !== null && row.destLng !== undefined ? Number(row.destLng) : null;
  const destCoords =
    destLat !== null && destLng !== null && Number.isFinite(destLat) && Number.isFinite(destLng)
      ? { lat: destLat, lng: destLng }
      : null;

  return {
    id: Number(row.id),
    orderNumber: Number(row.orderNumber),
    userId: Number(row.userId),
    customerName: String(row.customerName),
    customerWhatsapp: String(row.customerWhatsapp),
    customerCpf: String(row.customerCpf || ''),
    deliveryMethod: row.deliveryMethod === 'Retirada na loja' ? 'Retirada na loja' : 'Entrega',
    address,
    distanceKm: row.distanceKm !== null && row.distanceKm !== undefined ? Number(row.distanceKm) : null,
    paymentMethod: String(row.paymentMethod) as Order['paymentMethod'],
    changeFor: String(row.changeFor || ''),
    items: Array.isArray(items) ? items : [],
    subtotal: Number(row.subtotal),
    discountAmount: Number(row.discountAmount || 0),
    couponCode: row.couponCode ? String(row.couponCode) : null,
    shippingFee: row.shippingFee !== null && row.shippingFee !== undefined ? Number(row.shippingFee) : null,
    shippingLabel: String(row.shippingLabel),
    total: Number(row.total),
    status: String(row.status) as OrderStatus,
    rouletteGranted: Boolean(row.rouletteGranted),
    stockDeducted: Boolean(row.stockDeducted),
    notes: String(row.notes || ''),
    createdAt: String(row.createdAt),
    assignedCourierId:
      row.assignedCourierId !== null && row.assignedCourierId !== undefined
        ? Number(row.assignedCourierId)
        : null,
    assignedCourierName: String(row.assignedCourierName || ''),
    destCoords,
    trackingActive: Boolean(row.trackingActive),
    courierGpsStatus,
    lastLocationAt: row.lastLocationAt ? String(row.lastLocationAt) : null,
    deliveredAt: row.deliveredAt ? String(row.deliveredAt) : null,
  };
}

export function mapDeliveryTrackingInfo(
  row: Record<string, unknown>,
  settings: StoreSettings
): DeliveryTrackingInfo {
  const order = mapOrderRow(row);
  const courierLat = row.courierLat !== null && row.courierLat !== undefined ? Number(row.courierLat) : null;
  const courierLng = row.courierLng !== null && row.courierLng !== undefined ? Number(row.courierLng) : null;
  const courierCoords =
    courierLat !== null &&
    courierLng !== null &&
    Number.isFinite(courierLat) &&
    Number.isFinite(courierLng)
      ? { lat: courierLat, lng: courierLng }
      : null;

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    deliveryMethod: order.deliveryMethod,
    customerName: order.customerName,
    address: order.address,
    destCoords: order.destCoords,
    storeCoords: { lat: settings.storeLat, lng: settings.storeLng },
    storeAddress: settings.storeAddress,
    assignedCourierId: order.assignedCourierId,
    assignedCourierName: order.assignedCourierName,
    trackingActive: order.trackingActive,
    courierCoords,
    courierAccuracy:
      row.courierAccuracy !== null && row.courierAccuracy !== undefined ? Number(row.courierAccuracy) : null,
    courierHeading:
      row.courierHeading !== null && row.courierHeading !== undefined ? Number(row.courierHeading) : null,
    courierSpeed:
      row.courierSpeed !== null && row.courierSpeed !== undefined ? Number(row.courierSpeed) : null,
    courierGpsStatus: order.courierGpsStatus,
    lastLocationAt: order.lastLocationAt,
    deliveredAt: order.deliveredAt,
  };
}

export function mapPrizeRow(row: Record<string, unknown>): RoulettePrize {
  return {
    id: Number(row.id),
    label: String(row.label),
    shortLabel: String(row.shortLabel),
    prizeType: String(row.prizeType) as RoulettePrizeType,
    discountValue: Number(row.discountValue || 0),
    weight: Number(row.weight || 0),
    color: String(row.color || '#141414'),
    active: Boolean(row.active),
    sortOrder: Number(row.sortOrder || 0),
  };
}

export function mapChanceRow(row: Record<string, unknown>): RouletteChance {
  return {
    id: Number(row.id),
    userId: Number(row.userId),
    orderId: Number(row.orderId),
    orderNumber: Number(row.orderNumber),
    status: String(row.status) as RouletteChance['status'],
    grantedAt: String(row.grantedAt),
    expiresAt: String(row.expiresAt),
    usedAt: row.usedAt ? String(row.usedAt) : null,
  };
}

export function mapSpinRow(row: Record<string, unknown>): RouletteSpin {
  return {
    id: Number(row.id),
    userId: Number(row.userId),
    userName: String(row.userName),
    chanceId: Number(row.chanceId),
    prizeId: Number(row.prizeId),
    prizeLabel: String(row.prizeLabel),
    prizeType: String(row.prizeType) as RoulettePrizeType,
    couponCode: row.couponCode ? String(row.couponCode) : null,
    couponExpiresAt: row.couponExpiresAt ? String(row.couponExpiresAt) : null,
    createdAt: String(row.createdAt),
  };
}

export type UserRecord = User & { passwordHash: string };

export function getUserByEmail(email: string): UserRecord | null {
  const row = db
    .prepare(
      'SELECT id, name, email, whatsapp, cpf, addressJson, passwordHash, role, active, welcomeCampaignSeen, createdAt FROM users WHERE lower(email) = lower(?) AND COALESCE(archived, 0) = 0'
    )
    .get(email.trim()) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...mapUserRow(row),
    passwordHash: String(row.passwordHash),
  };
}

export function getUserById(id: number): User | null {
  const row = db
    .prepare(
      'SELECT id, name, email, whatsapp, cpf, addressJson, role, active, welcomeCampaignSeen, createdAt FROM users WHERE id = ? AND COALESCE(archived, 0) = 0'
    )
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapUserRow(row) : null;
}

export function listCouriers(): CourierSummary[] {
  const rows = db
    .prepare(
      "SELECT id, name, email, whatsapp, active, createdAt FROM users WHERE role = 'courier' AND COALESCE(archived, 0) = 0 ORDER BY id DESC"
    )
    .all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    email: String(row.email),
    whatsapp: String(row.whatsapp || ''),
    active: row.active !== 0,
    createdAt: String(row.createdAt),
  }));
}

export function listCustomers(): CustomerSummary[] {
  const rows = db
    .prepare(
      "SELECT id, name, email FROM users WHERE active = 1 AND COALESCE(archived, 0) = 0 AND role != 'courier' ORDER BY name ASC, id DESC"
    )
    .all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    email: String(row.email).trim().toLowerCase(),
  }));
}

export function mapSuggestionRow(row: Record<string, unknown>): ProductSuggestion {
  return {
    id: Number(row.id),
    userId: Number(row.userId),
    customerName: String(row.customerName),
    customerEmail: String(row.customerEmail),
    suggestion: String(row.suggestion),
    createdAt: String(row.createdAt),
  };
}

export function hasUserUsedCoupon(couponId: number, userId: number): boolean {
  const row = db
    .prepare('SELECT id FROM coupon_usages WHERE couponId = ? AND userId = ? LIMIT 1')
    .get(couponId, userId);
  return Boolean(row);
}

export function recordCouponUsage(couponId: number, userId: number, orderId: number, usedAt: string): void {
  db.prepare('INSERT INTO coupon_usages (couponId, userId, orderId, usedAt) VALUES (?, ?, ?, ?)').run(
    couponId,
    userId,
    orderId,
    usedAt
  );
}

export function hasAdminUser(): boolean {
  const row = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get() as { count: number };
  return row.count > 0;
}

export function createUserRecord(params: {
  name: string;
  email: string;
  whatsapp: string;
  passwordHash: string;
  role: UserRole;
}): User {
  const now = new Date().toISOString();
  const res = db
    .prepare('INSERT INTO users (name, email, whatsapp, passwordHash, role, active, createdAt) VALUES (?, ?, ?, ?, ?, 1, ?)')
    .run(params.name, params.email.trim().toLowerCase(), params.whatsapp, params.passwordHash, params.role, now);
  const created = getUserById(Number(res.lastInsertRowid));
  if (!created) {
    throw new Error('Failed to retrieve created user');
  }
  return created;
}

export function markUserWelcomeSeen(userId: number): User | null {
  db.prepare('UPDATE users SET welcomeCampaignSeen = 1 WHERE id = ?').run(userId);
  return getUserById(userId);
}

export function getOrCreateSessionSecret(): string {
  const existing = db
    .prepare("SELECT value FROM seed_meta WHERE key = 'session_secret_v1'")
    .get() as { value: string } | undefined;
  if (existing?.value && existing.value.length >= 32) {
    return existing.value;
  }
  const generated = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT OR REPLACE INTO seed_meta (key, value) VALUES ('session_secret_v1', ?)").run(
    generated
  );
  return generated;
}
