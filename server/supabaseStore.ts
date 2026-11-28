import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { db, formatProductSku, listCouriers, mapProductRow, mapSlideRow } from './db.ts';
import type { CarouselSlide, CourierSummary, Order, Product } from '../src/types.ts';

let cachedClient: SupabaseClient | null = null;
let cachedConfigKey = '';
let migrationPromise: Promise<void> | null = null;

function getSupabaseEnv(): {
  url: string;
  serviceRoleKey: string;
  bucket: string;
} {
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const bucket = (process.env.SUPABASE_STORAGE_BUCKET || 'carousel-images').trim() || 'carousel-images';
  return { url, serviceRoleKey, bucket };
}

export function isSupabaseConfigured(): boolean {
  const { url, serviceRoleKey } = getSupabaseEnv();
  return Boolean(url && serviceRoleKey && /^https?:\/\//i.test(url));
}

function getSupabaseClient(): SupabaseClient {
  const { url, serviceRoleKey } = getSupabaseEnv();
  const key = `${url}::${serviceRoleKey}`;
  if (!cachedClient || cachedConfigKey !== key) {
    cachedClient = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    cachedConfigKey = key;
  }
  return cachedClient;
}

function extractStoragePathFromUrl(imageUrl: string, bucket: string): string {
  if (!imageUrl) return '';
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = imageUrl.indexOf(marker);
  if (idx === -1) return '';
  const rawPath = imageUrl.slice(idx + marker.length).split('?')[0];
  try {
    return decodeURIComponent(rawPath);
  } catch {
    return rawPath;
  }
}

async function ensureStorageBucketExists(client: SupabaseClient, bucket: string): Promise<void> {
  const { data } = await client.storage.getBucket(bucket);
  if (data) return;
  await client.storage.createBucket(bucket, {
    public: true,
    fileSizeLimit: 4 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  });
}

export async function uploadImageToSupabaseStorage(params: {
  buffer: Buffer;
  mimeType: string;
  ext: 'jpg' | 'png' | 'webp';
  folder?: 'carousel' | 'products';
}): Promise<{ imageUrl: string; storagePath: string }> {
  const { bucket } = getSupabaseEnv();
  const client = getSupabaseClient();
  await ensureStorageBucketExists(client, bucket);

  const folder = params.folder || 'carousel';
  const storagePath = `${folder}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${params.ext}`;

  const { error: uploadError } = await client.storage
    .from(bucket)
    .upload(storagePath, params.buffer, {
      contentType: params.mimeType,
      upsert: false,
      cacheControl: '31536000',
    });

  if (uploadError) {
    throw new Error(`Falha ao enviar imagem para o Supabase Storage: ${uploadError.message}`);
  }

  const { data: publicData } = client.storage.from(bucket).getPublicUrl(storagePath);
  if (!publicData?.publicUrl) {
    throw new Error('Supabase Storage não retornou a URL pública da imagem.');
  }

  return {
    imageUrl: publicData.publicUrl,
    storagePath,
  };
}

export async function deleteImageFromSupabaseStorage(
  imageUrl?: string | null,
  storagePath?: string | null
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const { bucket } = getSupabaseEnv();
  const resolvedPath = (storagePath || '').trim() || extractStoragePathFromUrl(imageUrl || '', bucket);
  if (!resolvedPath) return;

  try {
    const client = getSupabaseClient();
    await client.storage.from(bucket).remove([resolvedPath]);
  } catch (err) {
    console.warn('Supabase storage cleanup warning:', err);
  }
}

function mapSupabaseProductRow(row: Record<string, unknown>): Product {
  const id = Number(row.id);
  const variations = Array.isArray(row.variations)
    ? row.variations.map((v) => String(v).trim()).filter(Boolean)
    : [];
  const secondaryVariations = Array.isArray(row.secondary_variations)
    ? row.secondary_variations.map((v) => String(v).trim()).filter(Boolean)
    : [];
  const variationStockRaw =
    row.variation_stock && typeof row.variation_stock === 'object' && !Array.isArray(row.variation_stock)
      ? (row.variation_stock as Record<string, unknown>)
      : {};
  const variationStock: Record<string, number> = {};
  for (const [k, v] of Object.entries(variationStockRaw)) {
    const num = Number(v);
    if (k.trim() && Number.isFinite(num)) {
      variationStock[k.trim()] = Math.max(0, Math.round(num));
    }
  }

  return {
    id,
    sku: formatProductSku(id, row.sku),
    name: String(row.name || ''),
    category: String(row.category || ''),
    description: String(row.description || ''),
    badgeLabel: String(row.badge_label || ''),
    price: Number(row.price || 0),
    costPrice: Number(row.cost_price || 0),
    freightCostUnit: Number(row.freight_cost_unit || 0),
    packagingCostUnit: Number(row.packaging_cost_unit || 0),
    otherCostUnit: Number(row.other_cost_unit || 0),
    purchasedQuantity: Math.max(0, Math.round(Number(row.purchased_quantity || 0))),
    stockQuantity: Math.max(0, Math.round(Number(row.stock_quantity || 0))),
    archived: Boolean(row.deleted),
    archivedAt: row.deleted_at ? String(row.deleted_at) : null,
    imageUrl: String(row.image_url || ''),
    variationLabel: String(row.variation_label || 'Sabor / Variação'),
    variations,
    secondaryVariationLabel: String(row.secondary_variation_label || ''),
    secondaryVariations,
    variationStock,
    active: row.active !== false,
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString()),
  };
}

function mapSupabaseDriverRow(row: Record<string, unknown>): CourierSummary & { passwordHash?: string } {
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    email: String(row.email || '').trim().toLowerCase(),
    whatsapp: String(row.phone || ''),
    active: row.active !== false,
    createdAt: String(row.created_at || new Date().toISOString()),
    passwordHash: row.password_hash ? String(row.password_hash) : undefined,
  };
}

function mapSupabaseSlideRow(row: Record<string, unknown>): CarouselSlide {
  return {
    id: Number(row.id),
    tag: String(row.tag || ''),
    title: String(row.title || ''),
    subtitle: String(row.subtitle || ''),
    ctaText: String(row.cta_text || 'Ver catálogo'),
    targetCategory: String(row.target_category || 'Todos'),
    linkUrl: String(row.link_url || ''),
    imageUrl: String(row.image_url || ''),
    storagePath: String(row.storage_path || ''),
    sortOrder: Number(row.sort_order ?? 1),
    active: row.active !== false,
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

function syncProductToLocalCache(product: Product): void {
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(product.id);
  if (existing) {
    db.prepare(
      `UPDATE products SET
        sku = ?, name = ?, category = ?, description = ?, badgeLabel = ?, price = ?,
        costPrice = ?, freightCostUnit = ?, packagingCostUnit = ?, otherCostUnit = ?,
        purchasedQuantity = ?, stockQuantity = ?, archived = 0, archivedAt = NULL,
        imageUrl = ?, variationLabel = ?, variationsJson = ?, secondaryVariationLabel = ?,
        secondaryVariationsJson = ?, variationStockJson = ?, active = ?, updatedAt = ?
       WHERE id = ?`
    ).run(
      product.sku || formatProductSku(product.id),
      product.name,
      product.category,
      product.description,
      product.badgeLabel || '',
      product.price,
      product.costPrice || 0,
      product.freightCostUnit || 0,
      product.packagingCostUnit || 0,
      product.otherCostUnit || 0,
      product.purchasedQuantity || 0,
      product.stockQuantity || 0,
      product.imageUrl || '',
      product.variationLabel || '',
      JSON.stringify(product.variations || []),
      product.secondaryVariationLabel || '',
      JSON.stringify(product.secondaryVariations || []),
      JSON.stringify(product.variationStock || {}),
      product.active ? 1 : 0,
      product.updatedAt || new Date().toISOString(),
      product.id
    );
  } else {
    db.prepare(
      `INSERT INTO products (
        id, sku, name, category, description, badgeLabel, price,
        costPrice, freightCostUnit, packagingCostUnit, otherCostUnit,
        purchasedQuantity, stockQuantity, archived,
        imageUrl, variationLabel, variationsJson, secondaryVariationLabel,
        secondaryVariationsJson, variationStockJson, active, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      product.id,
      product.sku || formatProductSku(product.id),
      product.name,
      product.category,
      product.description,
      product.badgeLabel || '',
      product.price,
      product.costPrice || 0,
      product.freightCostUnit || 0,
      product.packagingCostUnit || 0,
      product.otherCostUnit || 0,
      product.purchasedQuantity || 0,
      product.stockQuantity || 0,
      product.imageUrl || '',
      product.variationLabel || '',
      JSON.stringify(product.variations || []),
      product.secondaryVariationLabel || '',
      JSON.stringify(product.secondaryVariations || []),
      JSON.stringify(product.variationStock || {}),
      product.active ? 1 : 0,
      product.createdAt || new Date().toISOString(),
      product.updatedAt || new Date().toISOString()
    );
  }
}

function syncDriverToLocalCache(driver: CourierSummary & { passwordHash?: string }): void {
  const byEmail = db
    .prepare('SELECT id, role FROM users WHERE lower(email) = ? LIMIT 1')
    .get(driver.email.toLowerCase()) as { id: number; role: string } | undefined;

  if (byEmail && byEmail.role === 'courier') {
    if (driver.passwordHash) {
      db.prepare(
        "UPDATE users SET name = ?, whatsapp = ?, active = ?, archived = 0, archivedAt = NULL, passwordHash = ? WHERE id = ? AND role = 'courier'"
      ).run(driver.name, driver.whatsapp || '', driver.active ? 1 : 0, driver.passwordHash, byEmail.id);
    } else {
      db.prepare(
        "UPDATE users SET name = ?, whatsapp = ?, active = ?, archived = 0, archivedAt = NULL WHERE id = ? AND role = 'courier'"
      ).run(driver.name, driver.whatsapp || '', driver.active ? 1 : 0, byEmail.id);
    }
    return;
  }

  if (!byEmail) {
    const byId = db.prepare('SELECT id FROM users WHERE id = ?').get(driver.id);
    if (!byId) {
      db.prepare(
        'INSERT INTO users (id, name, email, whatsapp, passwordHash, role, active, archived, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
      ).run(
        driver.id,
        driver.name,
        driver.email.toLowerCase(),
        driver.whatsapp || '',
        driver.passwordHash || '',
        'courier',
        driver.active ? 1 : 0,
        driver.createdAt || new Date().toISOString()
      );
    } else {
      db.prepare(
        'INSERT INTO users (name, email, whatsapp, passwordHash, role, active, archived, createdAt) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
      ).run(
        driver.name,
        driver.email.toLowerCase(),
        driver.whatsapp || '',
        driver.passwordHash || '',
        'courier',
        driver.active ? 1 : 0,
        driver.createdAt || new Date().toISOString()
      );
    }
  }
}

function syncSlideToLocalCache(slide: CarouselSlide): void {
  const existing = db.prepare('SELECT id FROM carousel_slides WHERE id = ?').get(slide.id);
  if (existing) {
    db.prepare(
      'UPDATE carousel_slides SET tag = ?, title = ?, subtitle = ?, ctaText = ?, targetCategory = ?, linkUrl = ?, imageUrl = ?, storagePath = ?, sortOrder = ?, active = ?, deleted = 0, deletedAt = NULL, updatedAt = ? WHERE id = ?'
    ).run(
      slide.tag,
      slide.title,
      slide.subtitle,
      slide.ctaText,
      slide.targetCategory,
      slide.linkUrl || '',
      slide.imageUrl,
      slide.storagePath || '',
      slide.sortOrder,
      slide.active ? 1 : 0,
      slide.updatedAt || new Date().toISOString(),
      slide.id
    );
  } else {
    db.prepare(
      'INSERT INTO carousel_slides (id, tag, title, subtitle, ctaText, targetCategory, linkUrl, imageUrl, storagePath, sortOrder, active, deleted, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)'
    ).run(
      slide.id,
      slide.tag,
      slide.title,
      slide.subtitle,
      slide.ctaText,
      slide.targetCategory,
      slide.linkUrl || '',
      slide.imageUrl,
      slide.storagePath || '',
      slide.sortOrder,
      slide.active ? 1 : 0,
      slide.createdAt || new Date().toISOString(),
      slide.updatedAt || new Date().toISOString()
    );
  }
}

export async function ensureSupabaseMigratedOnce(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const doneRow = db
    .prepare("SELECT value FROM seed_meta WHERE key = 'supabase_migrated_v1'")
    .get() as { value: string } | undefined;
  if (doneRow?.value === '1') return;

  if (!migrationPromise) {
    migrationPromise = (async () => {
      const client = getSupabaseClient();

      // 1. Migrate products once if Supabase products table is completely empty
      const { count: prodCount, error: prodCountErr } = await client
        .from('products')
        .select('id', { count: 'exact', head: true });
      if (!prodCountErr && (prodCount ?? 0) === 0) {
        const localProducts = db
          .prepare('SELECT * FROM products WHERE archived = 0 ORDER BY id ASC')
          .all() as Record<string, unknown>[];
        if (localProducts.length > 0) {
          const rows = localProducts.map((row) => {
            const p = mapProductRow(row);
            return {
              sku: p.sku || formatProductSku(p.id),
              name: p.name,
              category: p.category,
              description: p.description,
              badge_label: p.badgeLabel || '',
              price: p.price,
              cost_price: p.costPrice || 0,
              freight_cost_unit: p.freightCostUnit || 0,
              packaging_cost_unit: p.packagingCostUnit || 0,
              other_cost_unit: p.otherCostUnit || 0,
              purchased_quantity: p.purchasedQuantity || 0,
              stock_quantity: p.stockQuantity || 0,
              image_url: p.imageUrl || '',
              variation_label: p.variationLabel || 'Sabor / Variação',
              variations: p.variations || [],
              secondary_variation_label: p.secondaryVariationLabel || '',
              secondary_variations: p.secondaryVariations || [],
              variation_stock: p.variationStock || {},
              active: p.active,
              deleted: false,
            };
          });
          await client.from('products').insert(rows);
        }
      }

      // 2. Migrate delivery drivers once if Supabase delivery_drivers table is completely empty
      const { count: driverCount, error: driverCountErr } = await client
        .from('delivery_drivers')
        .select('id', { count: 'exact', head: true });
      if (!driverCountErr && (driverCount ?? 0) === 0) {
        const localCouriers = db
          .prepare(
            "SELECT id, name, email, whatsapp, passwordHash, active FROM users WHERE role = 'courier' AND COALESCE(archived, 0) = 0 ORDER BY id ASC"
          )
          .all() as {
          id: number;
          name: string;
          email: string;
          whatsapp: string;
          passwordHash: string;
          active: number;
        }[];
        if (localCouriers.length > 0) {
          await client.from('delivery_drivers').insert(
            localCouriers.map((c) => ({
              name: c.name,
              email: c.email.trim().toLowerCase(),
              phone: c.whatsapp || '',
              password_hash: c.passwordHash || '',
              active: c.active !== 0,
              deleted: false,
            }))
          );
        }
      }

      // 3. Migrate carousel slides once if Supabase carousel_slides table is completely empty
      const { count: slideCount, error: slideCountErr } = await client
        .from('carousel_slides')
        .select('id', { count: 'exact', head: true });
      if (!slideCountErr && (slideCount ?? 0) === 0) {
        const localSlides = db
          .prepare('SELECT * FROM carousel_slides WHERE COALESCE(deleted, 0) = 0 ORDER BY sortOrder ASC, id ASC')
          .all() as Record<string, unknown>[];
        if (localSlides.length > 0) {
          await client.from('carousel_slides').insert(
            localSlides.map((row) => {
              const s = mapSlideRow(row);
              return {
                tag: s.tag,
                title: s.title,
                subtitle: s.subtitle,
                cta_text: s.ctaText,
                target_category: s.targetCategory,
                link_url: s.linkUrl || '',
                image_url: s.imageUrl || '',
                storage_path: s.storagePath || '',
                sort_order: s.sortOrder,
                active: s.active,
                deleted: false,
              };
            })
          );
        }
      }

      db.prepare("INSERT OR REPLACE INTO seed_meta (key, value) VALUES ('supabase_migrated_v1', '1')").run();
    })().finally(() => {
      migrationPromise = null;
    });
  }

  await migrationPromise;
}

// ==================== PRODUCTS ====================

export async function listProductsPersistent(onlyActive: boolean): Promise<Product[]> {
  if (!isSupabaseConfigured()) {
    const query = onlyActive
      ? 'SELECT * FROM products WHERE active = 1 AND archived = 0 ORDER BY id DESC'
      : 'SELECT * FROM products WHERE archived = 0 ORDER BY id DESC';
    const rows = db.prepare(query).all() as Record<string, unknown>[];
    return rows.map(mapProductRow);
  }

  await ensureSupabaseMigratedOnce();
  const client = getSupabaseClient();
  let query = client
    .from('products')
    .select('*')
    .eq('deleted', false)
    .order('id', { ascending: false });

  if (onlyActive) {
    query = query.eq('active', true);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Erro ao carregar produtos no Supabase: ${error.message}`);
  }

  const products = (data || []).map((r) => mapSupabaseProductRow(r as Record<string, unknown>));

  // Keep local mirror aligned with Supabase source of truth
  const remoteIds = new Set(products.map((p) => p.id));
  for (const p of products) {
    syncProductToLocalCache(p);
  }
  if (!onlyActive) {
    const localRows = db.prepare('SELECT id FROM products WHERE archived = 0').all() as { id: number }[];
    const now = new Date().toISOString();
    for (const lr of localRows) {
      if (!remoteIds.has(lr.id)) {
        db.prepare('UPDATE products SET archived = 1, active = 0, archivedAt = ? WHERE id = ?').run(now, lr.id);
      }
    }
  }

  return products;
}

export async function createProductPersistent(input: {
  sku: string;
  name: string;
  category: string;
  description: string;
  badgeLabel?: string;
  price: number;
  costPrice: number;
  freightCostUnit: number;
  packagingCostUnit: number;
  otherCostUnit: number;
  purchasedQuantity: number;
  stockQuantity: number;
  imageUrl: string;
  storagePath?: string;
  variationLabel: string;
  variations: string[];
  secondaryVariationLabel: string;
  secondaryVariations: string[];
  variationStock: Record<string, number>;
  active: boolean;
}): Promise<Product> {
  const client = getSupabaseClient();
  await ensureSupabaseMigratedOnce();

  const { data, error } = await client
    .from('products')
    .insert({
      sku: input.sku,
      name: input.name,
      category: input.category,
      description: input.description,
      badge_label: input.badgeLabel || '',
      price: input.price,
      cost_price: input.costPrice,
      freight_cost_unit: input.freightCostUnit,
      packaging_cost_unit: input.packagingCostUnit,
      other_cost_unit: input.otherCostUnit,
      purchased_quantity: input.purchasedQuantity,
      stock_quantity: input.stockQuantity,
      image_url: input.imageUrl,
      storage_path: input.storagePath || '',
      variation_label: input.variationLabel,
      variations: input.variations,
      secondary_variation_label: input.secondaryVariationLabel,
      secondary_variations: input.secondaryVariations,
      variation_stock: input.variationStock,
      active: input.active,
      deleted: false,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Erro ao salvar produto no Supabase: ${error?.message || 'sem confirmação do banco.'}`);
  }

  let product = mapSupabaseProductRow(data as Record<string, unknown>);
  if (!input.sku) {
    const generatedSku = formatProductSku(product.id);
    const { data: updatedSkuData } = await client
      .from('products')
      .update({ sku: generatedSku })
      .eq('id', product.id)
      .select('*')
      .single();
    if (updatedSkuData) {
      product = mapSupabaseProductRow(updatedSkuData as Record<string, unknown>);
    } else {
      product.sku = generatedSku;
    }
  }

  syncProductToLocalCache(product);
  return product;
}

export async function updateProductPersistent(
  id: number,
  input: {
    sku: string;
    name: string;
    category: string;
    description: string;
    badgeLabel?: string;
    price: number;
    costPrice: number;
    freightCostUnit: number;
    packagingCostUnit: number;
    otherCostUnit: number;
    purchasedQuantity: number;
    stockQuantity: number;
    imageUrl: string;
    storagePath?: string;
    variationLabel: string;
    variations: string[];
    secondaryVariationLabel: string;
    secondaryVariations: string[];
    variationStock: Record<string, number>;
    active: boolean;
  }
): Promise<Product> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('products')
    .update({
      sku: input.sku,
      name: input.name,
      category: input.category,
      description: input.description,
      badge_label: input.badgeLabel || '',
      price: input.price,
      cost_price: input.costPrice,
      freight_cost_unit: input.freightCostUnit,
      packaging_cost_unit: input.packagingCostUnit,
      other_cost_unit: input.otherCostUnit,
      purchased_quantity: input.purchasedQuantity,
      stock_quantity: input.stockQuantity,
      image_url: input.imageUrl,
      ...(input.storagePath !== undefined ? { storage_path: input.storagePath } : {}),
      variation_label: input.variationLabel,
      variations: input.variations,
      secondary_variation_label: input.secondaryVariationLabel,
      secondary_variations: input.secondaryVariations,
      variation_stock: input.variationStock,
      active: input.active,
    })
    .eq('id', id)
    .eq('deleted', false)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Erro ao atualizar produto no Supabase: ${error?.message || 'produto não encontrado.'}`);
  }

  const product = mapSupabaseProductRow(data as Record<string, unknown>);
  syncProductToLocalCache(product);
  return product;
}

export async function syncProductStockToSupabase(
  id: number,
  stockQuantity: number,
  variationStock: Record<string, number>
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const client = getSupabaseClient();
    await client
      .from('products')
      .update({
        stock_quantity: Math.max(0, Math.round(stockQuantity)),
        variation_stock: variationStock,
      })
      .eq('id', id);
  } catch (err) {
    console.warn('Supabase stock sync warning:', err);
  }
}

export async function syncProductProfitToSupabase(product: {
  id: number;
  sku?: string;
  price: number;
  costPrice?: number;
  freightCostUnit?: number;
  packagingCostUnit?: number;
  otherCostUnit?: number;
  purchasedQuantity?: number;
  stockQuantity?: number;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const client = getSupabaseClient();
    await client
      .from('products')
      .update({
        ...(product.sku ? { sku: product.sku } : {}),
        price: product.price,
        cost_price: product.costPrice ?? 0,
        freight_cost_unit: product.freightCostUnit ?? 0,
        packaging_cost_unit: product.packagingCostUnit ?? 0,
        other_cost_unit: product.otherCostUnit ?? 0,
        purchased_quantity: Math.max(0, Math.round(Number(product.purchasedQuantity ?? 0))),
        stock_quantity: Math.max(0, Math.round(Number(product.stockQuantity ?? 0))),
      })
      .eq('id', product.id);
  } catch (err) {
    console.warn('Supabase profit sync warning:', err);
  }
}

export async function syncOrderToSupabase(order: Order, customerEmail: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const client = getSupabaseClient();
    await client.from('orders').upsert(
      {
        order_number: order.orderNumber,
        user_id: order.userId,
        customer_name: order.customerName,
        customer_email: customerEmail.trim().toLowerCase(),
        customer_whatsapp: order.customerWhatsapp,
        customer_cpf: order.customerCpf || '',
        delivery_method: order.deliveryMethod,
        address: order.address,
        payment_method: order.paymentMethod,
        items: order.items,
        subtotal: order.subtotal,
        discount_amount: order.discountAmount || 0,
        shipping_fee: order.shippingFee ?? 0,
        total: order.total,
        status: order.status,
        notes: order.notes || '',
        created_at: order.createdAt,
      },
      { onConflict: 'order_number' }
    );
  } catch (err) {
    console.warn('Supabase order sync warning:', err);
  }
}

export async function deleteProductPersistent(
  id: number,
  hasOrderReferences: boolean
): Promise<{ softDeleted: boolean }> {
  const client = getSupabaseClient();
  const { data: existing, error: fetchErr } = await client
    .from('products')
    .select('id, image_url, storage_path')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) {
    throw new Error(`Erro ao localizar produto no Supabase: ${fetchErr.message}`);
  }
  if (!existing) {
    throw new Error('Produto não encontrado no banco de dados.');
  }

  if (hasOrderReferences) {
    const now = new Date().toISOString();
    const { error: softErr } = await client
      .from('products')
      .update({ deleted: true, active: false, deleted_at: now })
      .eq('id', id);
    if (softErr) {
      throw new Error(`Erro ao excluir produto no Supabase: ${softErr.message}`);
    }
    return { softDeleted: true };
  }

  const { error: delErr } = await client.from('products').delete().eq('id', id);
  if (delErr) {
    throw new Error(`Erro ao excluir produto no Supabase: ${delErr.message}`);
  }

  await deleteImageFromSupabaseStorage(
    String((existing as Record<string, unknown>).image_url || ''),
    String((existing as Record<string, unknown>).storage_path || '')
  );

  return { softDeleted: false };
}

// ==================== DELIVERY DRIVERS (MOTOBOYS) ====================

export async function listDriversPersistent(): Promise<CourierSummary[]> {
  if (!isSupabaseConfigured()) {
    return listCouriers();
  }

  await ensureSupabaseMigratedOnce();
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('delivery_drivers')
    .select('*')
    .eq('deleted', false)
    .order('id', { ascending: false });

  if (error) {
    throw new Error(`Erro ao carregar motoboys no Supabase: ${error.message}`);
  }

  const drivers = (data || []).map((r) => mapSupabaseDriverRow(r as Record<string, unknown>));
  for (const d of drivers) {
    syncDriverToLocalCache(d);
  }

  // Archive local couriers that were removed in Supabase
  const remoteEmails = new Set(drivers.map((d) => d.email.toLowerCase()));
  const localCouriers = db
    .prepare("SELECT id, email FROM users WHERE role = 'courier' AND COALESCE(archived, 0) = 0")
    .all() as { id: number; email: string }[];
  const now = new Date().toISOString();
  for (const lc of localCouriers) {
    if (!remoteEmails.has(lc.email.trim().toLowerCase())) {
      db.prepare("UPDATE users SET archived = 1, active = 0, archivedAt = ? WHERE id = ?").run(now, lc.id);
    }
  }

  return drivers.map(({ passwordHash: _ph, ...summary }) => summary);
}

export async function createDriverPersistent(input: {
  name: string;
  email: string;
  whatsapp: string;
  passwordHash: string;
}): Promise<CourierSummary> {
  const client = getSupabaseClient();
  await ensureSupabaseMigratedOnce();

  const normalizedEmail = input.email.trim().toLowerCase();
  const { data: dup } = await client
    .from('delivery_drivers')
    .select('id')
    .eq('email', normalizedEmail)
    .eq('deleted', false)
    .maybeSingle();

  if (dup) {
    throw new Error('Já existe um motoboy cadastrado com este e-mail.');
  }

  const { data, error } = await client
    .from('delivery_drivers')
    .insert({
      name: input.name,
      email: normalizedEmail,
      phone: input.whatsapp,
      password_hash: input.passwordHash,
      active: true,
      deleted: false,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Erro ao cadastrar motoboy no Supabase: ${error?.message || 'falha no banco.'}`);
  }

  const mapped = mapSupabaseDriverRow(data as Record<string, unknown>);
  syncDriverToLocalCache(mapped);
  const { passwordHash: _ph, ...summary } = mapped;
  return summary;
}

export async function updateDriverPersistent(
  emailKey: string,
  input: {
    name?: string;
    email?: string;
    whatsapp?: string;
    active: boolean;
    passwordHash?: string;
  }
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const client = getSupabaseClient();
  const payload: Record<string, unknown> = {
    active: input.active,
  };
  if (input.name !== undefined) payload.name = input.name;
  if (input.email !== undefined) payload.email = input.email.trim().toLowerCase();
  if (input.whatsapp !== undefined) payload.phone = input.whatsapp;
  if (input.passwordHash) payload.password_hash = input.passwordHash;

  const { error } = await client
    .from('delivery_drivers')
    .update(payload)
    .eq('email', emailKey.trim().toLowerCase())
    .eq('deleted', false);

  if (error) {
    throw new Error(`Erro ao atualizar motoboy no Supabase: ${error.message}`);
  }
}

export async function deleteDriverPersistent(
  emailKey: string,
  hasOrderOrTrackingHistory: boolean
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const client = getSupabaseClient();
  const cleanEmail = emailKey.trim().toLowerCase();

  if (hasOrderOrTrackingHistory) {
    const now = new Date().toISOString();
    const { error } = await client
      .from('delivery_drivers')
      .update({
        deleted: true,
        active: false,
        deleted_at: now,
        email: `archived_${Date.now()}_${cleanEmail}`,
      })
      .eq('email', cleanEmail);
    if (error) {
      throw new Error(`Erro ao excluir motoboy no Supabase: ${error.message}`);
    }
    return;
  }

  const { error } = await client.from('delivery_drivers').delete().eq('email', cleanEmail);
  if (error) {
    throw new Error(`Erro ao excluir motoboy no Supabase: ${error.message}`);
  }
}

// ==================== CAROUSEL SLIDES ====================

export async function listSlidesPersistent(onlyActive: boolean): Promise<CarouselSlide[]> {
  if (!isSupabaseConfigured()) {
    const query = onlyActive
      ? 'SELECT * FROM carousel_slides WHERE active = 1 AND COALESCE(deleted, 0) = 0 ORDER BY sortOrder ASC, id ASC'
      : 'SELECT * FROM carousel_slides WHERE COALESCE(deleted, 0) = 0 ORDER BY sortOrder ASC, id ASC';
    const rows = db.prepare(query).all() as Record<string, unknown>[];
    return rows.map(mapSlideRow);
  }

  await ensureSupabaseMigratedOnce();
  const client = getSupabaseClient();
  let query = client
    .from('carousel_slides')
    .select('*')
    .eq('deleted', false)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });

  if (onlyActive) {
    query = query.eq('active', true);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Erro ao carregar slides no Supabase: ${error.message}`);
  }

  const slides = (data || []).map((r) => mapSupabaseSlideRow(r as Record<string, unknown>));
  const remoteIds = new Set(slides.map((s) => s.id));
  for (const s of slides) {
    syncSlideToLocalCache(s);
  }
  if (!onlyActive) {
    const localRows = db
      .prepare('SELECT id FROM carousel_slides WHERE COALESCE(deleted, 0) = 0')
      .all() as { id: number }[];
    const now = new Date().toISOString();
    for (const lr of localRows) {
      if (!remoteIds.has(lr.id)) {
        db.prepare('UPDATE carousel_slides SET deleted = 1, active = 0, deletedAt = ? WHERE id = ?').run(
          now,
          lr.id
        );
      }
    }
  }

  return slides;
}

export async function createSlidePersistent(input: {
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
}): Promise<CarouselSlide> {
  const client = getSupabaseClient();
  await ensureSupabaseMigratedOnce();

  const { data, error } = await client
    .from('carousel_slides')
    .insert({
      tag: input.tag,
      title: input.title,
      subtitle: input.subtitle,
      cta_text: input.ctaText,
      target_category: input.targetCategory,
      link_url: input.linkUrl || '',
      image_url: input.imageUrl,
      storage_path: input.storagePath || '',
      sort_order: input.sortOrder,
      active: input.active,
      deleted: false,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Erro ao salvar slide no Supabase: ${error?.message || 'sem confirmação do banco.'}`);
  }

  const slide = mapSupabaseSlideRow(data as Record<string, unknown>);
  syncSlideToLocalCache(slide);
  return slide;
}

export async function updateSlidePersistent(
  id: number,
  input: {
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
  }
): Promise<CarouselSlide> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('carousel_slides')
    .update({
      tag: input.tag,
      title: input.title,
      subtitle: input.subtitle,
      cta_text: input.ctaText,
      target_category: input.targetCategory,
      link_url: input.linkUrl || '',
      image_url: input.imageUrl,
      ...(input.storagePath !== undefined ? { storage_path: input.storagePath } : {}),
      sort_order: input.sortOrder,
      active: input.active,
    })
    .eq('id', id)
    .eq('deleted', false)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Erro ao atualizar slide no Supabase: ${error?.message || 'slide não encontrado.'}`);
  }

  const slide = mapSupabaseSlideRow(data as Record<string, unknown>);
  syncSlideToLocalCache(slide);
  return slide;
}

export async function deleteSlidePersistent(id: number): Promise<void> {
  const client = getSupabaseClient();
  const { data: existing, error: fetchErr } = await client
    .from('carousel_slides')
    .select('id, image_url, storage_path')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) {
    throw new Error(`Erro ao localizar slide no Supabase: ${fetchErr.message}`);
  }
  if (!existing) {
    throw new Error('Slide não encontrado.');
  }

  const { error: delErr } = await client.from('carousel_slides').delete().eq('id', id);
  if (delErr) {
    throw new Error(`Erro ao excluir slide no Supabase: ${delErr.message}`);
  }

  await deleteImageFromSupabaseStorage(
    String((existing as Record<string, unknown>).image_url || ''),
    String((existing as Record<string, unknown>).storage_path || '')
  );
}
