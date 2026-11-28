import { db, mapOrderRow, mapUserRow } from './db.ts';
import type {
  DeliveryAddress,
  LoyalCustomerDetail,
  LoyalCustomerPeriod,
  LoyalCustomerRow,
  LoyalCustomersResponse,
  LoyalCustomerSortBy,
  Order,
} from '../src/types.ts';

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function getSaoPauloOffsetMs(): number {
  // America/Sao_Paulo is UTC-3 year-round
  return -3 * 60 * 60 * 1000;
}

function resolvePeriodRange(
  period: LoyalCustomerPeriod,
  startDate?: string,
  endDate?: string
): { startIso: string | null; endIso: string | null } {
  const now = new Date();
  const offsetMs = getSaoPauloOffsetMs();
  const localNow = new Date(now.getTime() + offsetMs);

  if (period === 'today') {
    const startUtc =
      Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate(), 0, 0, 0, 0) -
      offsetMs;
    return {
      startIso: new Date(startUtc).toISOString(),
      endIso: now.toISOString(),
    };
  }

  if (period === '7d') {
    return {
      startIso: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      endIso: now.toISOString(),
    };
  }

  if (period === '30d') {
    return {
      startIso: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      endIso: now.toISOString(),
    };
  }

  if (period === 'current_month') {
    const startUtc =
      Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), 1, 0, 0, 0, 0) - offsetMs;
    return {
      startIso: new Date(startUtc).toISOString(),
      endIso: now.toISOString(),
    };
  }

  if (period === 'custom') {
    let startIso: string | null = null;
    let endIso: string | null = null;
    if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      const [y, m, d] = startDate.split('-').map(Number);
      startIso = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - offsetMs).toISOString();
    }
    if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      const [y, m, d] = endDate.split('-').map(Number);
      endIso = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - offsetMs).toISOString();
    }
    return { startIso, endIso };
  }

  return { startIso: null, endIso: null };
}

export interface LoyalCustomersQueryParams {
  period?: LoyalCustomerPeriod;
  startDate?: string;
  endDate?: string;
  sortBy?: LoyalCustomerSortBy;
  search?: string;
  neighborhood?: string;
  inactiveOnly?: boolean;
  page?: number;
  pageSize?: number;
}

interface AggregatedCustomerInternal extends LoyalCustomerRow {
  totalOrdersRaw: number;
  totalSpentRaw: number;
}

function buildConfirmedCustomersAggregation(params: LoyalCustomersQueryParams): {
  filtered: AggregatedCustomerInternal[];
  neighborhoods: string[];
} {
  const period: LoyalCustomerPeriod = params.period || 'all';
  const sortBy: LoyalCustomerSortBy = params.sortBy || 'total_spent';
  const { startIso, endIso } = resolvePeriodRange(period, params.startDate, params.endDate);
  const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Server-side SQL query pulling ONLY confirmed orders (status != Pendente & != Cancelado)
  const confirmedRows = db
    .prepare(
      `SELECT
         o.id,
         o.userId,
         o.customerName,
         o.customerWhatsapp,
         o.deliveryMethod,
         o.addressJson,
         o.itemsJson,
         o.subtotal,
         o.createdAt,
         u.name AS accountName,
         u.email AS accountEmail,
         u.whatsapp AS accountWhatsapp
       FROM orders o
       LEFT JOIN users u ON u.id = o.userId
       WHERE o.status NOT IN ('Pendente', 'Cancelado')
       ORDER BY o.createdAt DESC, o.id DESC`
    )
    .all() as Record<string, unknown>[];

  // Track overall last confirmed order per user for accurate ">30 days inactive" check
  const overallLastByUser = new Map<number, string>();
  for (const row of confirmedRows) {
    const uid = Number(row.userId);
    const createdAt = String(row.createdAt || '');
    const prev = overallLastByUser.get(uid);
    if (!prev || createdAt > prev) {
      overallLastByUser.set(uid, createdAt);
    }
  }

  interface CustomerAccumulator {
    userId: number;
    name: string;
    email: string;
    whatsapp: string;
    ordersCount: number;
    totalSpent: number;
    lastOrderAt: string;
    neighborhoodCounts: Map<string, { count: number; latestAt: string }>;
    productCounts: Map<string, number>;
  }

  const byCustomer = new Map<number, CustomerAccumulator>();

  for (const row of confirmedRows) {
    const createdAt = String(row.createdAt || '');
    if (startIso && createdAt < startIso) continue;
    if (endIso && createdAt > endIso) continue;

    const uid = Number(row.userId);
    const name = String(row.accountName || row.customerName || 'Cliente').trim();
    const email = String(row.accountEmail || '').trim().toLowerCase();
    const whatsapp = String(row.customerWhatsapp || row.accountWhatsapp || '').trim();
    const subtotal = Math.max(0, Number(row.subtotal || 0)); // Frete NEVER enters the sum

    let neighborhood = 'Retirada / Não informado';
    if (row.deliveryMethod === 'Entrega' && row.addressJson) {
      try {
        const addr = JSON.parse(String(row.addressJson)) as Partial<DeliveryAddress>;
        if (addr?.neighborhood && addr.neighborhood.trim()) {
          neighborhood = addr.neighborhood.trim();
        }
      } catch {
        // fallback label
      }
    } else if (row.deliveryMethod === 'Retirada na loja') {
      neighborhood = 'Retirada na loja';
    }

    let acc = byCustomer.get(uid);
    if (!acc) {
      acc = {
        userId: uid,
        name,
        email,
        whatsapp,
        ordersCount: 0,
        totalSpent: 0,
        lastOrderAt: createdAt,
        neighborhoodCounts: new Map(),
        productCounts: new Map(),
      };
      byCustomer.set(uid, acc);
    }

    acc.ordersCount += 1;
    acc.totalSpent = roundMoney(acc.totalSpent + subtotal);
    if (createdAt > acc.lastOrderAt) {
      acc.lastOrderAt = createdAt;
      if (whatsapp) acc.whatsapp = whatsapp;
      if (name) acc.name = name;
    }

    const prevNb = acc.neighborhoodCounts.get(neighborhood);
    acc.neighborhoodCounts.set(neighborhood, {
      count: (prevNb?.count || 0) + 1,
      latestAt: !prevNb || createdAt > prevNb.latestAt ? createdAt : prevNb.latestAt,
    });

    try {
      const items = JSON.parse(String(row.itemsJson || '[]')) as Array<{
        name?: string;
        variation?: string;
        quantity?: number;
      }>;
      if (Array.isArray(items)) {
        for (const item of items) {
          const itemName = String(item?.name || '').trim();
          if (!itemName) continue;
          const rawVar = String(item?.variation || '').trim();
          const label =
            rawVar && rawVar !== 'Padrão' ? `${itemName} (${rawVar})` : itemName;
          const qty = Math.max(1, Math.round(Number(item?.quantity || 1)));
          acc.productCounts.set(label, (acc.productCounts.get(label) || 0) + qty);
        }
      }
    } catch {
      // ignore malformed itemsJson
    }
  }

  const allAggregated: AggregatedCustomerInternal[] = [];
  const neighborhoodSet = new Set<string>();

  for (const acc of byCustomer.values()) {
    let mainNeighborhood = 'Retirada / Não informado';
    let bestNbCount = -1;
    let bestNbDate = '';
    for (const [nb, info] of acc.neighborhoodCounts.entries()) {
      if (info.count > bestNbCount || (info.count === bestNbCount && info.latestAt > bestNbDate)) {
        mainNeighborhood = nb;
        bestNbCount = info.count;
        bestNbDate = info.latestAt;
      }
    }
    neighborhoodSet.add(mainNeighborhood);

    let topProduct = '-';
    let bestProdQty = 0;
    for (const [label, qty] of acc.productCounts.entries()) {
      if (qty > bestProdQty) {
        topProduct = label;
        bestProdQty = qty;
      }
    }

    const overallLast = overallLastByUser.get(acc.userId) || acc.lastOrderAt;
    const isInactive30d = overallLast < thirtyDaysAgoIso;
    const avgTicket = acc.ordersCount > 0 ? roundMoney(acc.totalSpent / acc.ordersCount) : 0;

    allAggregated.push({
      rank: 0,
      userId: acc.userId,
      name: acc.name,
      email: acc.email,
      whatsapp: acc.whatsapp,
      mainNeighborhood,
      ordersCount: acc.ordersCount,
      totalSpent: acc.totalSpent,
      avgTicket,
      lastOrderAt: acc.lastOrderAt,
      topProduct,
      isInactive30d,
      totalOrdersRaw: acc.ordersCount,
      totalSpentRaw: acc.totalSpent,
    });
  }

  const searchNorm = normalizeText(params.search || '');
  const searchDigits = digitsOnly(params.search || '');
  const neighborhoodNorm = normalizeText(params.neighborhood || '');
  const inactiveOnly = Boolean(params.inactiveOnly);

  const filtered = allAggregated.filter((c) => {
    if (searchNorm) {
      const nameMatch = normalizeText(c.name).includes(searchNorm);
      const emailMatch = normalizeText(c.email).includes(searchNorm);
      const phoneMatch =
        normalizeText(c.whatsapp).includes(searchNorm) ||
        (searchDigits.length >= 3 && digitsOnly(c.whatsapp).includes(searchDigits));
      if (!nameMatch && !emailMatch && !phoneMatch) {
        return false;
      }
    }
    if (neighborhoodNorm && normalizeText(c.mainNeighborhood) !== neighborhoodNorm) {
      return false;
    }
    if (inactiveOnly && !c.isInactive30d) {
      return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (sortBy === 'orders_count') {
      if (b.ordersCount !== a.ordersCount) return b.ordersCount - a.ordersCount;
      return b.totalSpent - a.totalSpent;
    }
    if (sortBy === 'avg_ticket') {
      if (b.avgTicket !== a.avgTicket) return b.avgTicket - a.avgTicket;
      return b.totalSpent - a.totalSpent;
    }
    if (sortBy === 'last_order_at') {
      if (b.lastOrderAt !== a.lastOrderAt) return b.lastOrderAt.localeCompare(a.lastOrderAt);
      return b.totalSpent - a.totalSpent;
    }
    if (b.totalSpent !== a.totalSpent) return b.totalSpent - a.totalSpent;
    return b.ordersCount - a.ordersCount;
  });

  filtered.forEach((row, index) => {
    row.rank = index + 1;
  });

  const neighborhoods = Array.from(neighborhoodSet).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  return { filtered, neighborhoods };
}

export function getLoyalCustomersOverview(params: LoyalCustomersQueryParams): LoyalCustomersResponse {
  const { filtered, neighborhoods } = buildConfirmedCustomersAggregation(params);

  const pageSize = Math.min(100, Math.max(5, Math.round(Number(params.pageSize || 15))));
  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(totalPages, Math.max(1, Math.round(Number(params.page || 1))));
  const startIdx = (page - 1) * pageSize;

  const recurringCustomers = filtered.filter((c) => c.ordersCount > 1).length;
  const totalSpentAll = filtered.reduce((acc, c) => acc + c.totalSpentRaw, 0);
  const totalOrdersAll = filtered.reduce((acc, c) => acc + c.totalOrdersRaw, 0);
  const overallAvgTicket = totalOrdersAll > 0 ? roundMoney(totalSpentAll / totalOrdersAll) : 0;

  // Top 10 revenue always reflects the top 10 highest-spending customers in the filtered set
  const top10Revenue = roundMoney(
    [...filtered]
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 10)
      .reduce((acc, c) => acc + c.totalSpent, 0)
  );

  const customers: LoyalCustomerRow[] = filtered
    .slice(startIdx, startIdx + pageSize)
    .map(({ totalOrdersRaw: _o, totalSpentRaw: _s, ...row }) => row);

  return {
    customers,
    summary: {
      totalCustomers: totalCount,
      recurringCustomers,
      overallAvgTicket,
      top10Revenue,
    },
    neighborhoods,
    pagination: {
      page,
      pageSize,
      totalCount,
      totalPages,
    },
  };
}

export function getAllFilteredLoyalCustomersForExport(
  params: LoyalCustomersQueryParams
): LoyalCustomerRow[] {
  const { filtered } = buildConfirmedCustomersAggregation(params);
  return filtered.map(({ totalOrdersRaw: _o, totalSpentRaw: _s, ...row }) => row);
}

function escapeCsvCell(value: string | number): string {
  const str = String(value ?? '');
  if (/[",;\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildLoyalCustomersCsv(rows: LoyalCustomerRow[]): string {
  const header = [
    'Posição',
    'Nome',
    'E-mail',
    'Telefone/WhatsApp',
    'Bairro principal',
    'Qtd. pedidos',
    'Total gasto (sem frete)',
    'Ticket médio',
    'Último pedido',
    'Produto mais comprado',
    'Status (>30 dias)',
  ];

  const lines = [header.map(escapeCsvCell).join(',')];

  for (const r of rows) {
    lines.push(
      [
        r.rank,
        r.name,
        r.email,
        r.whatsapp || '',
        r.mainNeighborhood,
        r.ordersCount,
        r.totalSpent.toFixed(2).replace('.', ','),
        r.avgTicket.toFixed(2).replace('.', ','),
        r.lastOrderAt,
        r.topProduct,
        r.isInactive30d ? 'Inativo (+30d)' : 'Ativo',
      ]
        .map(escapeCsvCell)
        .join(',')
    );
  }

  return `\uFEFF${lines.join('\r\n')}`;
}

export function getLoyalCustomerDetail(userId: number): LoyalCustomerDetail | null {
  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as
    | Record<string, unknown>
    | undefined;

  const orderRows = db
    .prepare('SELECT * FROM orders WHERE userId = ? ORDER BY createdAt DESC, id DESC')
    .all(userId) as Record<string, unknown>[];

  if (!userRow && orderRows.length === 0) {
    return null;
  }

  const user = userRow ? mapUserRow(userRow) : null;
  const orders: Order[] = orderRows.map(mapOrderRow);
  const confirmedOrders = orders.filter(
    (o) => o.status !== 'Pendente' && o.status !== 'Cancelado'
  );

  const totalSpent = roundMoney(
    confirmedOrders.reduce((acc, o) => acc + Math.max(0, Number(o.subtotal || 0)), 0)
  );
  const ordersCount = confirmedOrders.length;
  const avgTicket = ordersCount > 0 ? roundMoney(totalSpent / ordersCount) : 0;
  const lastOrderAt = confirmedOrders[0]?.createdAt || orders[0]?.createdAt || '';
  const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const isInactive30d = lastOrderAt ? lastOrderAt < thirtyDaysAgoIso : true;

  // Neighborhood counts
  const nbCounts = new Map<string, number>();
  for (const o of confirmedOrders) {
    const nb =
      o.deliveryMethod === 'Entrega' && o.address?.neighborhood?.trim()
        ? o.address.neighborhood.trim()
        : o.deliveryMethod === 'Retirada na loja'
          ? 'Retirada na loja'
          : 'Retirada / Não informado';
    nbCounts.set(nb, (nbCounts.get(nb) || 0) + 1);
  }
  let mainNeighborhood = 'Retirada / Não informado';
  let bestNb = -1;
  for (const [nb, cnt] of nbCounts.entries()) {
    if (cnt > bestNb) {
      mainNeighborhood = nb;
      bestNb = cnt;
    }
  }

  // Unique addresses (saved + historical orders)
  const addressMap = new Map<string, DeliveryAddress>();
  const addAddress = (addr: DeliveryAddress | null | undefined) => {
    if (!addr || (!addr.street && !addr.neighborhood && !addr.cep)) return;
    const key = `${addr.street.trim().toLowerCase()}|${addr.number.trim().toLowerCase()}|${addr.neighborhood.trim().toLowerCase()}|${addr.cep.replace(/\D/g, '')}`;
    if (!addressMap.has(key)) {
      addressMap.set(key, addr);
    }
  };
  addAddress(user?.savedAddress);
  for (const o of orders) {
    addAddress(o.address);
  }

  // Favorite products & flavors across confirmed orders
  const favMap = new Map<
    string,
    { productName: string; variation: string; totalQuantity: number; totalSpent: number }
  >();
  for (const o of confirmedOrders) {
    for (const item of o.items) {
      const productName = item.name.trim();
      const variation = (item.variation || '').trim();
      const key = `${productName.toLowerCase()}::${variation.toLowerCase()}`;
      const qty = Math.max(1, Math.round(Number(item.quantity || 1)));
      const spend = roundMoney(Number(item.price || 0) * qty);
      const prev = favMap.get(key);
      if (prev) {
        prev.totalQuantity += qty;
        prev.totalSpent = roundMoney(prev.totalSpent + spend);
      } else {
        favMap.set(key, {
          productName,
          variation: variation && variation !== 'Padrão' ? variation : '',
          totalQuantity: qty,
          totalSpent: spend,
        });
      }
    }
  }

  const favoriteProducts = Array.from(favMap.values()).sort((a, b) => {
    if (b.totalQuantity !== a.totalQuantity) return b.totalQuantity - a.totalQuantity;
    return b.totalSpent - a.totalSpent;
  });

  const latestOrder = orders[0];
  return {
    customer: {
      userId,
      name: user?.name || latestOrder?.customerName || 'Cliente',
      email: user?.email || '',
      whatsapp: user?.whatsapp || latestOrder?.customerWhatsapp || '',
      cpf: user?.cpf || latestOrder?.customerCpf || '',
      mainNeighborhood,
      ordersCount,
      totalSpent,
      avgTicket,
      lastOrderAt,
      isInactive30d,
    },
    addresses: Array.from(addressMap.values()),
    favoriteProducts,
    orders,
  };
}
