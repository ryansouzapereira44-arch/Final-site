import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  ArrowDownUp,
  Calculator,
  Edit3,
  History,
  ImagePlus,
  Layers,
  PackagePlus,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Tag,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import { formatBRL, formatDateTimeBR } from '../../lib/format';
import { compressImageFileToDataUrl } from '../../lib/imageUpload';
import {
  calculatePriceFromTargetMargin,
  calculatePriceFromTargetProfit,
  computeProductProfitMetrics,
  computeTotalUnitCost,
  computeWeightedAverageCost,
  roundMoney,
  simulateSales,
} from '../../lib/profitMath';
import type {
  ProductCostBatch,
  ProductCostHistoryEntry,
  ProfitOverviewResponse,
  ProfitProductRow,
  ProfitSortOption,
} from '../../types';
import { SafeProductImage } from '../BrandMark';

interface ProfitManagerModuleProps {
  token: string | null;
  liveSyncTrigger?: number;
  onProductsChanged: () => void;
}

type ProfitSubTab = 'overview' | 'sales_sim' | 'price_sim' | 'history';

const EVENT_TYPE_LABELS: Record<ProductCostHistoryEntry['eventType'], string> = {
  initial: 'Cadastro inicial',
  manual_edit: 'Edição de custos/estoque',
  batch_entry: 'Entrada de lote (CMP)',
  price_change: 'Alteração de preço',
  archived: 'Produto arquivado',
};

function parseDecimalInput(raw: string): number {
  const normalized = raw.replace(',', '.').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1).replace('.', ',')}%`;
}

const PRESET_PRODUCT_IMAGES = [
  { label: 'Essência Blend', url: '/src/assets/images/product_tobacco_essence_1795779511616.jpg' },
  { label: 'Narguilé Black', url: '/src/assets/images/product_hookah_black_1795779511252.jpg' },
  { label: 'Carvão Coco', url: '/src/assets/images/product_coconut_charcoal_1795779511363.jpg' },
  { label: 'Rosh Cerâmico', url: '/src/assets/images/product_ceramic_rosh_1795779511909.jpg' },
  { label: 'Pod System', url: '/src/assets/images/product_pod_device_1795779511951.jpg' },
];

export function ProfitManagerModule({
  token,
  liveSyncTrigger = 0,
  onProductsChanged,
}: ProfitManagerModuleProps) {
  const [subTab, setSubTab] = useState<ProfitSubTab>('overview');
  const [data, setData] = useState<ProfitOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  // Filters & sorting
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('Todas');
  const [sortBy, setSortBy] = useState<ProfitSortOption>('highest_potential_profit');
  const [historyProductFilter, setHistoryProductFilter] = useState<string>('all');

  // Product cost edit modal state
  const [editingRow, setEditingRow] = useState<{
    product: ProfitProductRow;
    sku: string;
    price: string;
    costPrice: string;
    freightCostUnit: string;
    packagingCostUnit: string;
    otherCostUnit: string;
    purchasedQuantity: string;
    stockQuantity: string;
    note: string;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Add new product directly into stock modal state
  const [newStockProduct, setNewStockProduct] = useState<{
    sku: string;
    name: string;
    category: string;
    description: string;
    price: string;
    costPrice: string;
    freightCostUnit: string;
    packagingCostUnit: string;
    otherCostUnit: string;
    purchasedQuantity: string;
    stockQuantity: string;
    imageUrl: string;
    variationLabel: string;
    variationsText: string;
    secondaryVariationLabel: string;
    secondaryVariationsText: string;
    active: boolean;
  } | null>(null);
  const [savingNewProduct, setSavingNewProduct] = useState(false);
  const [uploadingNewImage, setUploadingNewImage] = useState(false);
  const newProductFileInputRef = useRef<HTMLInputElement | null>(null);

  // Inline stock draft map & inline delete confirmation
  const [stockDrafts, setStockDrafts] = useState<Record<number, string>>({});
  const [savingStockId, setSavingStockId] = useState<number | null>(null);
  const [savingAllStock, setSavingAllStock] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<number | null>(null);

  // Batch modal state
  const [batchModal, setBatchModal] = useState<{
    product: ProfitProductRow;
    quantityPurchased: string;
    unitPurchaseCost: string;
    freightCostUnit: string;
    packagingCostUnit: string;
    otherCostUnit: string;
    supplierNote: string;
  } | null>(null);
  const [savingBatch, setSavingBatch] = useState(false);

  // Product detail history modal
  const [detailModal, setDetailModal] = useState<{
    product: ProfitProductRow;
    batches: ProductCostBatch[];
    history: ProductCostHistoryEntry[];
  } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Sales Simulator state
  const [salesSimProductId, setSalesSimProductId] = useState<string>('custom');
  const [salesSimPurchaseCost, setSalesSimPurchaseCost] = useState('10.00');
  const [salesSimAdditionalCost, setSalesSimAdditionalCost] = useState('0.00');
  const [salesSimSalePrice, setSalesSimSalePrice] = useState('20.00');
  const [salesSimStockQty, setSalesSimStockQty] = useState('100');
  const [salesSimSellQty, setSalesSimSellQty] = useState('50');

  // Price Simulator state
  const [priceSimProductId, setPriceSimProductId] = useState<string>('custom');
  const [priceSimMode, setPriceSimMode] = useState<'margin' | 'profit'>('margin');
  const [priceSimPurchaseCost, setPriceSimPurchaseCost] = useState('10.00');
  const [priceSimAdditionalCost, setPriceSimAdditionalCost] = useState('0.00');
  const [priceSimStockQty, setPriceSimStockQty] = useState('50');
  const [priceSimTargetMargin, setPriceSimTargetMargin] = useState('40');
  const [priceSimTargetProfit, setPriceSimTargetProfit] = useState('10.00');
  const [customComparePrices, setCustomComparePrices] = useState<number[]>([]);
  const [newComparePriceInput, setNewComparePriceInput] = useState('');
  const [applyingSimulatedPrice, setApplyingSimulatedPrice] = useState(false);

  const loadData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError('');
      try {
        const res = await api.getProfitOverview(token);
        setData(res);
      } catch (err) {
        if (!silent) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar R&P Profit Manager.');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  // Real-time synchronization whenever catalog or profit data changes
  useEffect(() => {
    if (liveSyncTrigger > 0) {
      void loadData(true);
    }
  }, [liveSyncTrigger, loadData]);

  function showNotice(msg: string) {
    setFeedback(msg);
    window.setTimeout(() => setFeedback(''), 4000);
  }

  function openEditModal(product: ProfitProductRow) {
    setEditingRow({
      product,
      sku: product.sku,
      price: product.price.toFixed(2),
      costPrice: product.costPrice.toFixed(2),
      freightCostUnit: product.freightCostUnit.toFixed(2),
      packagingCostUnit: product.packagingCostUnit.toFixed(2),
      otherCostUnit: product.otherCostUnit.toFixed(2),
      purchasedQuantity: String(product.purchasedQuantity),
      stockQuantity: String(product.stockQuantity),
      note: '',
    });
  }

  function openBatchModal(product: ProfitProductRow) {
    setBatchModal({
      product,
      quantityPurchased: '10',
      unitPurchaseCost: product.costPrice > 0 ? product.costPrice.toFixed(2) : '',
      freightCostUnit: product.freightCostUnit > 0 ? product.freightCostUnit.toFixed(2) : '0.00',
      packagingCostUnit: product.packagingCostUnit > 0 ? product.packagingCostUnit.toFixed(2) : '0.00',
      otherCostUnit: product.otherCostUnit > 0 ? product.otherCostUnit.toFixed(2) : '0.00',
      supplierNote: '',
    });
  }

  async function openDetailModal(product: ProfitProductRow) {
    setLoadingDetail(true);
    setError('');
    try {
      const res = await api.getProfitProductDetail(token, product.id);
      setDetailModal(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar histórico do produto.');
    } finally {
      setLoadingDetail(false);
    }
  }

  function loadProductIntoSalesSimulator(product: ProfitProductRow) {
    setSalesSimProductId(String(product.id));
    setSalesSimPurchaseCost(product.costPrice.toFixed(2));
    setSalesSimAdditionalCost(product.totalAdditionalCostUnit.toFixed(2));
    setSalesSimSalePrice(product.price.toFixed(2));
    setSalesSimStockQty(String(product.stockQuantity));
    setSalesSimSellQty(String(product.stockQuantity > 0 ? Math.min(product.stockQuantity, 10) : 10));
    setSubTab('sales_sim');
  }

  function loadProductIntoPriceSimulator(product: ProfitProductRow) {
    setPriceSimProductId(String(product.id));
    setPriceSimPurchaseCost(product.costPrice.toFixed(2));
    setPriceSimAdditionalCost(product.totalAdditionalCostUnit.toFixed(2));
    setPriceSimStockQty(String(product.stockQuantity));
    setCustomComparePrices([product.price]);
    setSubTab('price_sim');
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingRow) return;
    setSavingEdit(true);
    setError('');
    try {
      await api.updateProfitProduct(token, editingRow.product.id, {
        sku: editingRow.sku.trim().toUpperCase(),
        price: parseDecimalInput(editingRow.price),
        costPrice: Math.max(0, parseDecimalInput(editingRow.costPrice)),
        freightCostUnit: Math.max(0, parseDecimalInput(editingRow.freightCostUnit)),
        packagingCostUnit: Math.max(0, parseDecimalInput(editingRow.packagingCostUnit)),
        otherCostUnit: Math.max(0, parseDecimalInput(editingRow.otherCostUnit)),
        purchasedQuantity: Math.max(0, Math.round(parseDecimalInput(editingRow.purchasedQuantity))),
        stockQuantity: Math.max(0, Math.round(parseDecimalInput(editingRow.stockQuantity))),
        note: editingRow.note.trim() || undefined,
      });
      const editedId = editingRow.product.id;
      setStockDrafts((prev) => {
        const next = { ...prev };
        delete next[editedId];
        return next;
      });
      setEditingRow(null);
      await loadData(true);
      onProductsChanged();
      showNotice('Produto salvo no banco de dados. Só será removido se você clicar em Excluir.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar dados do produto.');
    } finally {
      setSavingEdit(false);
    }
  }

  function openAddStockProductModal() {
    setNewStockProduct({
      sku: '',
      name: '',
      category: 'Essências',
      description: '',
      price: '',
      costPrice: '0',
      freightCostUnit: '0',
      packagingCostUnit: '0',
      otherCostUnit: '0',
      purchasedQuantity: '10',
      stockQuantity: '10',
      imageUrl: PRESET_PRODUCT_IMAGES[0].url,
      variationLabel: 'Sabor / Variação',
      variationsText: '',
      secondaryVariationLabel: '',
      secondaryVariationsText: '',
      active: true,
    });
  }

  async function handleNewProductFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !newStockProduct) return;
    setError('');
    setUploadingNewImage(true);
    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      const res = await api.uploadAdminImage(token, dataUrl);
      setNewStockProduct((prev) => (prev ? { ...prev, imageUrl: res.imageUrl } : prev));
      showNotice('Foto carregada. Clique em "Salvar Produto no Estoque" para gravar.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar foto do produto.');
    } finally {
      setUploadingNewImage(false);
    }
  }

  async function handleSaveNewStockProduct(e: FormEvent) {
    e.preventDefault();
    if (!newStockProduct) return;
    setSavingNewProduct(true);
    setError('');
    try {
      const price = Math.max(0, parseDecimalInput(newStockProduct.price));
      const costPrice = Math.max(0, parseDecimalInput(newStockProduct.costPrice));
      const freightCostUnit = Math.max(0, parseDecimalInput(newStockProduct.freightCostUnit));
      const packagingCostUnit = Math.max(0, parseDecimalInput(newStockProduct.packagingCostUnit));
      const otherCostUnit = Math.max(0, parseDecimalInput(newStockProduct.otherCostUnit));
      const purchasedQuantity = Math.max(0, Math.round(parseDecimalInput(newStockProduct.purchasedQuantity)));
      const stockQuantity = Math.max(0, Math.round(parseDecimalInput(newStockProduct.stockQuantity)));
      const variations = newStockProduct.variationsText
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      const secondaryVariations = newStockProduct.secondaryVariationsText
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);

      await api.saveProduct(token, {
        sku: newStockProduct.sku.trim().toUpperCase(),
        name: newStockProduct.name.trim(),
        category: newStockProduct.category.trim(),
        description: newStockProduct.description.trim(),
        price,
        costPrice,
        freightCostUnit,
        packagingCostUnit,
        otherCostUnit,
        purchasedQuantity,
        stockQuantity,
        imageUrl: newStockProduct.imageUrl.trim(),
        variationLabel: newStockProduct.variationLabel.trim() || 'Sabor / Variação',
        variations,
        secondaryVariationLabel: newStockProduct.secondaryVariationLabel.trim(),
        secondaryVariations,
        active: newStockProduct.active,
      });

      setNewStockProduct(null);
      await loadData(true);
      onProductsChanged();
      showNotice('Produto adicionado e salvo no estoque! Ele permanece salvo até você clicar em Excluir.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar novo produto no estoque.');
    } finally {
      setSavingNewProduct(false);
    }
  }

  async function handleSaveInlineStock(product: ProfitProductRow) {
    const rawDraft = stockDrafts[product.id];
    if (rawDraft === undefined) return;
    const nextStock = Math.max(0, Math.round(parseDecimalInput(rawDraft)));
    setSavingStockId(product.id);
    setError('');
    try {
      await api.updateProfitProduct(token, product.id, {
        stockQuantity: nextStock,
        note: `Estoque salvo para ${nextStock} unidade(s) no painel de estoque`,
      });
      setStockDrafts((prev) => {
        const next = { ...prev };
        delete next[product.id];
        return next;
      });
      await loadData(true);
      onProductsChanged();
      showNotice(`Estoque de "${product.name}" salvo (${nextStock} un.).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar estoque do produto.');
    } finally {
      setSavingStockId(null);
    }
  }

  async function handleSaveAllModifiedStock() {
    if (!data) return;
    const modifiedProducts = data.products.filter((p) => {
      const draft = stockDrafts[p.id];
      return draft !== undefined && Math.max(0, Math.round(parseDecimalInput(draft))) !== p.stockQuantity;
    });
    if (modifiedProducts.length === 0) return;

    setSavingAllStock(true);
    setError('');
    try {
      for (const prod of modifiedProducts) {
        const nextStock = Math.max(0, Math.round(parseDecimalInput(stockDrafts[prod.id])));
        await api.updateProfitProduct(token, prod.id, {
          stockQuantity: nextStock,
          note: `Estoque salvo em lote para ${nextStock} unidade(s)`,
        });
      }
      setStockDrafts({});
      await loadData(true);
      onProductsChanged();
      showNotice(`${modifiedProducts.length} produto(s) salvos no estoque permanentemente.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar alterações do estoque.');
    } finally {
      setSavingAllStock(false);
    }
  }

  async function handleDeleteStockProduct(product: ProfitProductRow) {
    setDeletingProductId(product.id);
    setError('');
    try {
      await api.deleteProduct(token, product.id);
      setConfirmDeleteId(null);
      setStockDrafts((prev) => {
        const next = { ...prev };
        delete next[product.id];
        return next;
      });
      await loadData(true);
      onProductsChanged();
      showNotice(`Produto "${product.name}" excluído do estoque e do catálogo.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir produto.');
    } finally {
      setDeletingProductId(null);
    }
  }

  async function handleSaveBatch(e: FormEvent) {
    e.preventDefault();
    if (!batchModal) return;
    setSavingBatch(true);
    setError('');
    try {
      await api.createProfitBatch(token, batchModal.product.id, {
        quantityPurchased: Math.round(parseDecimalInput(batchModal.quantityPurchased)),
        unitPurchaseCost: Math.max(0, parseDecimalInput(batchModal.unitPurchaseCost)),
        freightCostUnit: Math.max(0, parseDecimalInput(batchModal.freightCostUnit)),
        packagingCostUnit: Math.max(0, parseDecimalInput(batchModal.packagingCostUnit)),
        otherCostUnit: Math.max(0, parseDecimalInput(batchModal.otherCostUnit)),
        supplierNote: batchModal.supplierNote.trim(),
      });
      setBatchModal(null);
      await loadData(true);
      onProductsChanged();
      showNotice('Lote registrado com recálculo automático por Custo Médio Ponderado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao registrar lote.');
    } finally {
      setSavingBatch(false);
    }
  }

  async function handleApplySimulatedPrice(newPrice: number) {
    if (priceSimProductId === 'custom' || !data) return;
    const targetProduct = data.products.find((p) => String(p.id) === priceSimProductId);
    if (!targetProduct || !Number.isFinite(newPrice) || newPrice <= 0) return;
    setApplyingSimulatedPrice(true);
    setError('');
    try {
      await api.updateProfitProduct(token, targetProduct.id, {
        price: roundMoney(newPrice),
        note: 'Preço aplicado a partir do Simulador de Preços (custo preservado)',
      });
      await loadData(true);
      onProductsChanged();
      showNotice(`Preço de "${targetProduct.name}" atualizado para ${formatBRL(newPrice)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao aplicar novo preço.');
    } finally {
      setApplyingSimulatedPrice(false);
    }
  }

  const productCategories = useMemo(() => {
    if (!data) return ['Todas'];
    return ['Todas', ...Array.from(new Set(data.products.map((p) => p.category).filter(Boolean)))];
  }, [data]);

  const filteredAndSortedProducts = useMemo(() => {
    if (!data) return [];
    const term = searchTerm.trim().toLowerCase();
    const list = data.products.filter((p) => {
      if (categoryFilter !== 'Todas' && p.category !== categoryFilter) return false;
      if (!term) return true;
      return (
        p.name.toLowerCase().includes(term) ||
        p.sku.toLowerCase().includes(term) ||
        p.category.toLowerCase().includes(term)
      );
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'highest_profit_unit') return b.profitPerUnit - a.profitPerUnit;
      if (sortBy === 'highest_margin') return b.marginPercent - a.marginPercent;
      if (sortBy === 'lowest_margin') return a.marginPercent - b.marginPercent;
      return b.potentialProfit - a.potentialProfit;
    });
  }, [data, searchTerm, categoryFilter, sortBy]);

  // Top 6 products chart data
  const topChartProducts = useMemo(() => {
    if (!data) return [];
    return [...data.products]
      .sort((a, b) => Math.max(b.potentialRevenue, b.potentialCost) - Math.max(a.potentialRevenue, a.potentialCost))
      .slice(0, 6);
  }, [data]);

  const maxChartValue = useMemo(() => {
    const maxVal = topChartProducts.reduce(
      (max, p) => Math.max(max, p.potentialRevenue, p.potentialCost, Math.abs(p.potentialProfit)),
      0
    );
    return maxVal > 0 ? maxVal : 1;
  }, [topChartProducts]);

  const dirtyStockCount = useMemo(() => {
    if (!data) return 0;
    return data.products.filter((p) => {
      const draft = stockDrafts[p.id];
      return draft !== undefined && Math.max(0, Math.round(parseDecimalInput(draft))) !== p.stockQuantity;
    }).length;
  }, [data, stockDrafts]);

  // Live new product modal preview calculation
  const newProductPreview = useMemo(() => {
    if (!newStockProduct) return null;
    return computeProductProfitMetrics({
      price: Math.max(0, parseDecimalInput(newStockProduct.price)),
      costPrice: Math.max(0, parseDecimalInput(newStockProduct.costPrice)),
      freightCostUnit: Math.max(0, parseDecimalInput(newStockProduct.freightCostUnit)),
      packagingCostUnit: Math.max(0, parseDecimalInput(newStockProduct.packagingCostUnit)),
      otherCostUnit: Math.max(0, parseDecimalInput(newStockProduct.otherCostUnit)),
      purchasedQuantity: Math.max(0, Math.round(parseDecimalInput(newStockProduct.purchasedQuantity))),
      stockQuantity: Math.max(0, Math.round(parseDecimalInput(newStockProduct.stockQuantity))),
    });
  }, [newStockProduct]);

  // Live edit modal preview calculation
  const editPreview = useMemo(() => {
    if (!editingRow) return null;
    return computeProductProfitMetrics({
      price: Math.max(0, parseDecimalInput(editingRow.price)),
      costPrice: Math.max(0, parseDecimalInput(editingRow.costPrice)),
      freightCostUnit: Math.max(0, parseDecimalInput(editingRow.freightCostUnit)),
      packagingCostUnit: Math.max(0, parseDecimalInput(editingRow.packagingCostUnit)),
      otherCostUnit: Math.max(0, parseDecimalInput(editingRow.otherCostUnit)),
      purchasedQuantity: Math.max(0, Math.round(parseDecimalInput(editingRow.purchasedQuantity))),
      stockQuantity: Math.max(0, Math.round(parseDecimalInput(editingRow.stockQuantity))),
    });
  }, [editingRow]);

  // Live batch modal preview calculation (Weighted Average Cost)
  const batchPreview = useMemo(() => {
    if (!batchModal) return null;
    const qty = Math.max(1, Math.round(parseDecimalInput(batchModal.quantityPurchased)));
    const cost = Math.max(0, parseDecimalInput(batchModal.unitPurchaseCost));
    const freight = Math.max(0, parseDecimalInput(batchModal.freightCostUnit));
    const packaging = Math.max(0, parseDecimalInput(batchModal.packagingCostUnit));
    const other = Math.max(0, parseDecimalInput(batchModal.otherCostUnit));
    const batchUnitTotal = computeTotalUnitCost({
      costPrice: cost,
      freightCostUnit: freight,
      packagingCostUnit: packaging,
      otherCostUnit: other,
    });
    const weighted = computeWeightedAverageCost({
      currentStockQuantity: batchModal.product.stockQuantity,
      currentCostPrice: batchModal.product.costPrice,
      currentFreightCostUnit: batchModal.product.freightCostUnit,
      currentPackagingCostUnit: batchModal.product.packagingCostUnit,
      currentOtherCostUnit: batchModal.product.otherCostUnit,
      batchQuantity: qty,
      batchUnitPurchaseCost: cost,
      batchFreightCostUnit: freight,
      batchPackagingCostUnit: packaging,
      batchOtherCostUnit: other,
    });
    const nextProfitUnit = roundMoney(batchModal.product.price - weighted.nextTotalUnitCost);
    const nextMargin =
      batchModal.product.price > 0 ? (nextProfitUnit / batchModal.product.price) * 100 : 0;

    return {
      qty,
      batchUnitTotal,
      batchTotalInvestment: roundMoney(batchUnitTotal * qty),
      ...weighted,
      nextProfitUnit,
      nextMargin,
    };
  }, [batchModal]);

  // Sales Simulator live computation
  const salesSimResult = useMemo(() => {
    return simulateSales({
      unitPurchaseCost: Math.max(0, parseDecimalInput(salesSimPurchaseCost)),
      additionalCostUnit: Math.max(0, parseDecimalInput(salesSimAdditionalCost)),
      salePrice: Math.max(0, parseDecimalInput(salesSimSalePrice)),
      stockQuantity: Math.max(0, Math.round(parseDecimalInput(salesSimStockQty))),
      sellQuantity: Math.max(0, Math.round(parseDecimalInput(salesSimSellQty))),
    });
  }, [
    salesSimPurchaseCost,
    salesSimAdditionalCost,
    salesSimSalePrice,
    salesSimStockQty,
    salesSimSellQty,
  ]);

  // Price Simulator live computation
  const priceSimUnitCost = useMemo(() => {
    return roundMoney(
      Math.max(0, parseDecimalInput(priceSimPurchaseCost)) +
        Math.max(0, parseDecimalInput(priceSimAdditionalCost))
    );
  }, [priceSimPurchaseCost, priceSimAdditionalCost]);

  const priceSimCalculatedPrice = useMemo(() => {
    if (priceSimMode === 'margin') {
      return calculatePriceFromTargetMargin(priceSimUnitCost, parseDecimalInput(priceSimTargetMargin));
    }
    return calculatePriceFromTargetProfit(priceSimUnitCost, parseDecimalInput(priceSimTargetProfit));
  }, [priceSimMode, priceSimUnitCost, priceSimTargetMargin, priceSimTargetProfit]);

  const priceSimCalculatedMetrics = useMemo(() => {
    if (priceSimCalculatedPrice === null) return null;
    return computeProductProfitMetrics({
      price: priceSimCalculatedPrice,
      costPrice: Math.max(0, parseDecimalInput(priceSimPurchaseCost)),
      freightCostUnit: Math.max(0, parseDecimalInput(priceSimAdditionalCost)),
      packagingCostUnit: 0,
      otherCostUnit: 0,
      purchasedQuantity: Math.max(0, Math.round(parseDecimalInput(priceSimStockQty))),
      stockQuantity: Math.max(0, Math.round(parseDecimalInput(priceSimStockQty))),
    });
  }, [priceSimCalculatedPrice, priceSimPurchaseCost, priceSimAdditionalCost, priceSimStockQty]);

  const priceComparisonScenarios = useMemo(() => {
    const selectedProduct =
      priceSimProductId !== 'custom' && data
        ? data.products.find((p) => String(p.id) === priceSimProductId) || null
        : null;
    const stockQty = Math.max(0, Math.round(parseDecimalInput(priceSimStockQty)));

    const candidateMap = new Map<string, { label: string; price: number }>();

    if (selectedProduct) {
      candidateMap.set(selectedProduct.price.toFixed(2), {
        label: 'Preço atual no catálogo',
        price: selectedProduct.price,
      });
    }
    if (priceSimCalculatedPrice !== null && priceSimCalculatedPrice > 0) {
      candidateMap.set(priceSimCalculatedPrice.toFixed(2), {
        label: priceSimMode === 'margin' ? 'Meta de margem' : 'Meta de lucro',
        price: priceSimCalculatedPrice,
      });
      const plus10 = roundMoney(priceSimCalculatedPrice * 1.1);
      const minus10 = roundMoney(Math.max(0.01, priceSimCalculatedPrice * 0.9));
      if (!candidateMap.has(minus10.toFixed(2))) {
        candidateMap.set(minus10.toFixed(2), { label: 'Cenário -10%', price: minus10 });
      }
      if (!candidateMap.has(plus10.toFixed(2))) {
        candidateMap.set(plus10.toFixed(2), { label: 'Cenário +10%', price: plus10 });
      }
    }
    for (const customPrice of customComparePrices) {
      const rounded = roundMoney(customPrice);
      if (rounded > 0 && !candidateMap.has(rounded.toFixed(2))) {
        candidateMap.set(rounded.toFixed(2), { label: 'Preço simulado', price: rounded });
      }
    }

    return Array.from(candidateMap.values())
      .sort((a, b) => a.price - b.price)
      .map((item) => ({
        ...item,
        metrics: computeProductProfitMetrics({
          price: item.price,
          costPrice: Math.max(0, parseDecimalInput(priceSimPurchaseCost)),
          freightCostUnit: Math.max(0, parseDecimalInput(priceSimAdditionalCost)),
          packagingCostUnit: 0,
          otherCostUnit: 0,
          purchasedQuantity: stockQty,
          stockQuantity: stockQty,
        }),
      }));
  }, [
    priceSimProductId,
    data,
    priceSimStockQty,
    priceSimCalculatedPrice,
    priceSimMode,
    customComparePrices,
    priceSimPurchaseCost,
    priceSimAdditionalCost,
  ]);

  const filteredBatches = useMemo(() => {
    if (!data) return [];
    if (historyProductFilter === 'all') return data.batches;
    return data.batches.filter((b) => String(b.productId) === historyProductFilter);
  }, [data, historyProductFilter]);

  const filteredHistory = useMemo(() => {
    if (!data) return [];
    if (historyProductFilter === 'all') return data.history;
    return data.history.filter((h) => String(h.productId) === historyProductFilter);
  }, [data, historyProductFilter]);

  const historyProductOptions = useMemo(() => {
    if (!data) return [];
    const map = new Map<number, { id: number; label: string }>();
    for (const p of data.products) {
      map.set(p.id, { id: p.id, label: `${p.name} (${p.sku})` });
    }
    for (const h of data.history) {
      if (!map.has(h.productId)) {
        map.set(h.productId, {
          id: h.productId,
          label: `${h.productNameSnapshot}${h.productArchived ? ' (Arquivado)' : ''}`,
        });
      }
    }
    return Array.from(map.values());
  }, [data]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/12 bg-[#0C0C0C] p-12 text-center text-sm text-[#9E9E9E]">
        Carregando R&amp;P Profit Manager...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Sub-navigation */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
            R&amp;P Profit Manager
          </h2>
          <p className="text-xs sm:text-sm text-[#9E9E9E] mt-1">
            Custos por produto, margem, markup, lucro potencial do estoque e simuladores sincronizados com o catálogo.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#0C0C0C] border border-white/12 overflow-x-auto max-w-full">
            {[
              { id: 'overview', label: 'Rentabilidade', icon: TrendingUp },
              { id: 'sales_sim', label: 'Simulador de Vendas', icon: Calculator },
              { id: 'price_sim', label: 'Simulador de Preços', icon: Tag },
              { id: 'history', label: 'Lotes e Histórico', icon: History },
            ].map((item) => {
              const Icon = item.icon;
              const isActive = subTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSubTab(item.id as ProfitSubTab)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 transition-colors ${
                    isActive
                      ? 'bg-white text-black'
                      : 'text-[#9E9E9E] hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={openAddStockProductModal}
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-white text-black text-xs font-extrabold hover:bg-neutral-200 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar Produto no Estoque
          </button>

          <button
            type="button"
            onClick={() => void loadData(false)}
            className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-white/15 text-xs font-bold text-white hover:bg-white hover:text-black transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Sincronizar
          </button>
        </div>
      </div>

      {feedback && (
        <div className="p-3.5 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-sm text-emerald-200">
          {feedback}
        </div>
      )}

      {error && (
        <div role="alert" className="p-3.5 rounded-xl bg-red-950/60 border border-red-500/40 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Clarification banner: Gross product profit vs Net company profit */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 rounded-xl border border-white/10 bg-[#0C0C0C] text-xs text-[#A3A3A3]">
        <span>
          <strong className="text-white font-semibold">Lucro Bruto por Produto:</strong> considera preço de venda menos compra e custos diretos (frete de compra, embalagem e outros custos da mercadoria). Não desconta taxas de pagamento nem despesas operacionais da loja.
        </span>
        <span className="text-white/70 whitespace-nowrap shrink-0 tabular-nums">
          Sincronizado com {data?.indicators.activeProductCount ?? 0} produtos ativos
        </span>
      </div>

      {/* ================= SUB-TAB 1: OVERVIEW & PROFITABILITY TABLE ================= */}
      {subTab === 'overview' && data && (
        <div className="space-y-6">
          {/* General Profitability KPIs */}
          <section aria-label="Indicadores gerais de rentabilidade" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            <div className="rounded-xl border border-white/12 bg-[#0C0C0C] p-4">
              <p className="text-xs text-[#9E9E9E]">Total investido em mercadorias</p>
              <p className="text-xl font-extrabold text-white tabular-nums mt-1.5">
                {formatBRL(data.indicators.totalInvested)}
              </p>
              <p className="text-[11px] text-[#737373] mt-1 tabular-nums">
                Custo unitário total × estoque
              </p>
            </div>

            <div className="rounded-xl border border-white/12 bg-[#0C0C0C] p-4">
              <p className="text-xs text-[#9E9E9E]">Faturamento potencial do estoque</p>
              <p className="text-xl font-extrabold text-white tabular-nums mt-1.5">
                {formatBRL(data.indicators.potentialRevenue)}
              </p>
              <p className="text-[11px] text-[#737373] mt-1 tabular-nums">
                Preço de venda × estoque
              </p>
            </div>

            <div className="rounded-xl border border-white/12 bg-[#0C0C0C] p-4">
              <p className="text-xs text-[#9E9E9E]">Lucro bruto potencial</p>
              <p
                className={`text-xl font-extrabold tabular-nums mt-1.5 ${
                  data.indicators.potentialGrossProfit >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {formatBRL(data.indicators.potentialGrossProfit)}
              </p>
              <p className="text-[11px] text-[#737373] mt-1">
                Vendendo todo o estoque atual
              </p>
            </div>

            <div className="rounded-xl border border-white/12 bg-[#0C0C0C] p-4">
              <p className="text-xs text-[#9E9E9E]">Média de margem de lucro</p>
              <p className="text-xl font-extrabold text-white tabular-nums mt-1.5">
                {formatPercent(data.indicators.averageMarginPercent)}
              </p>
              <p className="text-[11px] text-[#737373] mt-1 tabular-nums">
                {data.indicators.configuredCostCount > 0
                  ? `${data.indicators.configuredCostCount} de ${data.indicators.activeProductCount} com custo`
                  : 'Informe os custos dos produtos'}
              </p>
            </div>

            <div className="rounded-xl border border-white/12 bg-[#0C0C0C] p-4">
              <p className="text-xs text-[#9E9E9E]">Total de unidades cadastradas</p>
              <p className="text-xl font-extrabold text-white tabular-nums mt-1.5">
                {data.indicators.totalStockUnits.toLocaleString('pt-BR')} un.
              </p>
              <p className="text-[11px] text-[#737373] mt-1 tabular-nums">
                Compradas: {data.indicators.totalPurchasedUnits.toLocaleString('pt-BR')} un.
              </p>
            </div>
          </section>

          {/* Highlighted Products: Most Profitable & Lowest Margin */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-white/12 bg-[#0C0C0C] p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3.5 min-w-0">
                {data.indicators.mostProfitableProduct ? (
                  <div className="w-14 h-14 rounded-lg overflow-hidden bg-[#141414] shrink-0">
                    <SafeProductImage
                      src={data.indicators.mostProfitableProduct.imageUrl}
                      alt={data.indicators.mostProfitableProduct.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : null}
                <div className="min-w-0">
                  <p className="text-xs text-emerald-400 font-semibold flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5" />
                    Produto mais lucrativo
                  </p>
                  {data.indicators.mostProfitableProduct ? (
                    <>
                      <p className="text-sm font-bold text-white truncate mt-0.5">
                        {data.indicators.mostProfitableProduct.name}
                      </p>
                      <p className="text-xs text-[#9E9E9E] tabular-nums mt-0.5">
                        {formatBRL(data.indicators.mostProfitableProduct.profitPerUnit)}/un. · Potencial{' '}
                        <span className="text-white font-semibold">
                          {formatBRL(data.indicators.mostProfitableProduct.potentialProfit)}
                        </span>
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-[#737373] mt-1">Nenhum produto ativo cadastrado.</p>
                  )}
                </div>
              </div>
              {data.indicators.mostProfitableProduct && (
                <button
                  type="button"
                  onClick={() => loadProductIntoSalesSimulator(data.indicators.mostProfitableProduct!)}
                  className="px-3 py-2 rounded-lg border border-white/15 text-xs font-bold text-white hover:bg-white hover:text-black transition-colors whitespace-nowrap shrink-0"
                >
                  Simular
                </button>
              )}
            </div>

            <div className="rounded-xl border border-white/12 bg-[#0C0C0C] p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3.5 min-w-0">
                {data.indicators.lowestMarginProduct ? (
                  <div className="w-14 h-14 rounded-lg overflow-hidden bg-[#141414] shrink-0">
                    <SafeProductImage
                      src={data.indicators.lowestMarginProduct.imageUrl}
                      alt={data.indicators.lowestMarginProduct.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : null}
                <div className="min-w-0">
                  <p className="text-xs text-amber-400 font-semibold flex items-center gap-1.5">
                    <TrendingDown className="w-3.5 h-3.5" />
                    Produto com menor margem
                  </p>
                  {data.indicators.lowestMarginProduct ? (
                    <>
                      <p className="text-sm font-bold text-white truncate mt-0.5">
                        {data.indicators.lowestMarginProduct.name}
                      </p>
                      <p className="text-xs text-[#9E9E9E] tabular-nums mt-0.5">
                        Margem{' '}
                        <span className="text-white font-semibold">
                          {formatPercent(data.indicators.lowestMarginProduct.marginPercent)}
                        </span>{' '}
                        · Lucro {formatBRL(data.indicators.lowestMarginProduct.profitPerUnit)}/un.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-[#737373] mt-1">Nenhum produto ativo cadastrado.</p>
                  )}
                </div>
              </div>
              {data.indicators.lowestMarginProduct && (
                <button
                  type="button"
                  onClick={() => loadProductIntoPriceSimulator(data.indicators.lowestMarginProduct!)}
                  className="px-3 py-2 rounded-lg border border-white/15 text-xs font-bold text-white hover:bg-white hover:text-black transition-colors whitespace-nowrap shrink-0"
                >
                  Ajustar preço
                </button>
              )}
            </div>
          </section>

          {/* Charts Section */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Chart 1: Potential Revenue vs Invested Cost & Profit */}
            <div className="rounded-xl border border-white/12 bg-[#0C0C0C] p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-white">Custo Investido vs. Lucro Potencial</h3>
                  <p className="text-xs text-[#9E9E9E]">Principais produtos em estoque atual</p>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-[#9E9E9E]">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-white/30 inline-block" />
                    Custo
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-emerald-400 inline-block" />
                    Lucro
                  </span>
                </div>
              </div>

              {topChartProducts.length === 0 ? (
                <p className="text-xs text-[#737373] py-8 text-center">
                  Cadastre produtos e estoque para visualizar o comparativo.
                </p>
              ) : (
                <div className="space-y-3">
                  {topChartProducts.map((p) => {
                    const costWidth = Math.min(100, (p.potentialCost / maxChartValue) * 100);
                    const profitWidth =
                      p.potentialProfit > 0 ? Math.min(100 - costWidth, (p.potentialProfit / maxChartValue) * 100) : 0;
                    return (
                      <div key={p.id} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-white font-medium truncate">{p.name}</span>
                          <span className="text-[#9E9E9E] tabular-nums whitespace-nowrap shrink-0">
                            {p.stockQuantity} un. ·{' '}
                            <span className={p.potentialProfit >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                              {formatBRL(p.potentialProfit)}
                            </span>
                          </span>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-white/6 overflow-hidden flex">
                          <div
                            className="h-full bg-white/30 transition-all"
                            style={{ width: `${costWidth}%` }}
                            title={`Investido: ${formatBRL(p.potentialCost)}`}
                          />
                          <div
                            className={`h-full transition-all ${p.potentialProfit >= 0 ? 'bg-emerald-400' : 'bg-red-500'}`}
                            style={{ width: `${profitWidth}%` }}
                            title={`Lucro potencial: ${formatBRL(p.potentialProfit)}`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Chart 2: Category Profitability Breakdown */}
            <div className="rounded-xl border border-white/12 bg-[#0C0C0C] p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-white">Rentabilidade por Categoria</h3>
                  <p className="text-xs text-[#9E9E9E]">Margem média e potencial bruto por linha</p>
                </div>
                <Layers className="w-4 h-4 text-[#737373]" />
              </div>

              {data.categories.length === 0 ? (
                <p className="text-xs text-[#737373] py-8 text-center">
                  Nenhuma categoria disponível.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.categories.map((cat) => {
                    const barWidth = Math.max(0, Math.min(100, cat.avgMarginPercent));
                    return (
                      <div key={cat.category} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-white font-semibold truncate">
                            {cat.category}{' '}
                            <span className="text-[#737373] font-normal">
                              ({cat.productCount} prod. · {cat.totalUnits} un.)
                            </span>
                          </span>
                          <span className="tabular-nums text-white font-bold whitespace-nowrap shrink-0">
                            {formatPercent(cat.avgMarginPercent)} · {formatBRL(cat.potentialProfit)}
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-white/8 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-white transition-all"
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* Products Profitability & Stock Table */}
          <section className="rounded-xl border border-white/12 bg-[#0C0C0C] overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-white/10 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-white">Estoque e Rentabilidade dos Produtos</h3>
                <p className="text-xs text-[#9E9E9E] mt-0.5">
                  Adicione produtos, ajuste o estoque e clique em &ldquo;Salvar&rdquo;. Tudo permanece salvo até você clicar em &ldquo;Excluir&rdquo;.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {dirtyStockCount > 0 && (
                  <button
                    type="button"
                    disabled={savingAllStock}
                    onClick={() => void handleSaveAllModifiedStock()}
                    className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl bg-emerald-400 text-black text-xs font-extrabold hover:bg-emerald-300 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {savingAllStock
                      ? 'Salvando...'
                      : `Salvar Estoque (${dirtyStockCount})`}
                  </button>
                )}

                <button
                  type="button"
                  onClick={openAddStockProductModal}
                  className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl bg-white text-black text-xs font-extrabold hover:bg-neutral-200 transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Adicionar Produto
                </button>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-[#737373] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar produto ou SKU..."
                    className="h-10 pl-8 pr-3 rounded-xl bg-black border border-white/15 text-xs text-white placeholder:text-[#737373] focus:outline-none focus:border-white w-44 sm:w-52"
                  />
                </div>

                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  aria-label="Filtrar por categoria"
                  className="h-10 px-3 rounded-xl bg-black border border-white/15 text-xs text-white focus:outline-none focus:border-white"
                >
                  {productCategories.map((c) => (
                    <option key={c} value={c}>
                      {c === 'Todas' ? 'Todas categorias' : c}
                    </option>
                  ))}
                </select>

                <div className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl bg-black border border-white/15">
                  <ArrowDownUp className="w-3.5 h-3.5 text-[#9E9E9E]" />
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as ProfitSortOption)}
                    aria-label="Ordenar produtos"
                    className="bg-transparent text-xs text-white font-semibold focus:outline-none"
                  >
                    <option value="highest_potential_profit" className="bg-black">
                      Maior lucro potencial
                    </option>
                    <option value="highest_profit_unit" className="bg-black">
                      Maior lucro por unidade
                    </option>
                    <option value="highest_margin" className="bg-black">
                      Maior margem de lucro
                    </option>
                    <option value="lowest_margin" className="bg-black">
                      Menor margem de lucro
                    </option>
                  </select>
                </div>
              </div>
            </div>

            {filteredAndSortedProducts.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <p className="text-sm text-[#9E9E9E]">
                  Nenhum produto encontrado para o filtro atual.
                </p>
                <button
                  type="button"
                  onClick={openAddStockProductModal}
                  className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-white text-black text-xs font-extrabold hover:bg-neutral-200 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Adicionar Produto no Estoque
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-[11px] font-semibold text-[#9E9E9E]">
                      <th className="py-3 px-4">Produto</th>
                      <th className="py-3 px-3 text-right">Custo unit.</th>
                      <th className="py-3 px-3 text-right">Preço venda</th>
                      <th className="py-3 px-3 text-right">Lucro / un.</th>
                      <th className="py-3 px-3 text-right">Margem / Markup</th>
                      <th className="py-3 px-3 text-right">Estoque (un.)</th>
                      <th className="py-3 px-3 text-right">Lucro potencial</th>
                      <th className="py-3 px-4 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/8 text-xs">
                    {filteredAndSortedProducts.map((p) => {
                      const isNegative = p.profitPerUnit < 0;
                      const isLowMargin = p.marginPercent > 0 && p.marginPercent < 20;
                      const marginColor = isNegative
                        ? 'text-red-400'
                        : isLowMargin
                          ? 'text-amber-400'
                          : 'text-emerald-400';

                      const draftVal = stockDrafts[p.id];
                      const inputStockStr = draftVal !== undefined ? draftVal : String(p.stockQuantity);
                      const parsedDraftStock = Math.max(0, Math.round(parseDecimalInput(inputStockStr)));
                      const isStockDirty = draftVal !== undefined && parsedDraftStock !== p.stockQuantity;
                      const livePotentialProfit = roundMoney(p.profitPerUnit * parsedDraftStock);

                      return (
                        <tr key={p.id} className="hover:bg-white/[0.03] transition-colors">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3 min-w-[200px]">
                              <div className="w-11 h-11 rounded-lg overflow-hidden bg-[#141414] shrink-0">
                                <SafeProductImage
                                  src={p.imageUrl}
                                  alt={p.name}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                              <div className="min-w-0">
                                <p className="font-bold text-white truncate max-w-[220px]">{p.name}</p>
                                <p className="text-[11px] text-[#737373] truncate">
                                  {p.sku} · {p.category} · {p.active ? 'Ativo' : 'Oculto'}
                                </p>
                              </div>
                            </div>
                          </td>

                          <td className="py-3 px-3 text-right tabular-nums whitespace-nowrap">
                            <span className="font-semibold text-white">{formatBRL(p.totalUnitCost)}</span>
                            {p.totalAdditionalCostUnit > 0 && (
                              <p className="text-[10px] text-[#737373]">
                                {formatBRL(p.costPrice)} + {formatBRL(p.totalAdditionalCostUnit)} adic.
                              </p>
                            )}
                          </td>

                          <td className="py-3 px-3 text-right tabular-nums whitespace-nowrap font-semibold text-white">
                            {formatBRL(p.price)}
                          </td>

                          <td
                            className={`py-3 px-3 text-right tabular-nums whitespace-nowrap font-bold ${
                              p.profitPerUnit >= 0 ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          >
                            {formatBRL(p.profitPerUnit)}
                          </td>

                          <td className="py-3 px-3 text-right tabular-nums whitespace-nowrap">
                            <span className={`font-bold ${marginColor}`}>
                              {formatPercent(p.marginPercent)}
                            </span>
                            <p className="text-[10px] text-[#737373]">
                              Markup {formatPercent(p.markupPercent)}
                            </p>
                          </td>

                          <td className="py-3 px-3 text-right tabular-nums whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <input
                                type="number"
                                min="0"
                                step="1"
                                aria-label={`Estoque de ${p.name}`}
                                value={inputStockStr}
                                onChange={(e) =>
                                  setStockDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))
                                }
                                className={`w-20 h-8 px-2 rounded-lg bg-black border text-right text-xs font-bold text-white tabular-nums focus:outline-none ${
                                  isStockDirty
                                    ? 'border-emerald-400'
                                    : 'border-white/15 focus:border-white'
                                }`}
                              />
                              <button
                                type="button"
                                disabled={!isStockDirty || savingStockId === p.id}
                                onClick={() => void handleSaveInlineStock(p)}
                                title="Salvar estoque deste produto"
                                className={`h-8 px-2.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 transition-colors ${
                                  isStockDirty
                                    ? 'bg-emerald-400 text-black hover:bg-emerald-300'
                                    : 'border border-white/12 text-[#737373] cursor-default'
                                } disabled:opacity-60`}
                              >
                                <Save className="w-3 h-3" />
                                {savingStockId === p.id ? '...' : 'Salvar'}
                              </button>
                            </div>
                            <p className="text-[10px] text-[#737373] mt-0.5">
                              Compradas: {p.purchasedQuantity}
                            </p>
                          </td>

                          <td
                            className={`py-3 px-3 text-right tabular-nums whitespace-nowrap font-extrabold ${
                              livePotentialProfit >= 0 ? 'text-white' : 'text-red-400'
                            }`}
                          >
                            {formatBRL(livePotentialProfit)}
                          </td>

                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            {confirmDeleteId === p.id ? (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={deletingProductId === p.id}
                                  onClick={() => void handleDeleteStockProduct(p)}
                                  className="h-8 px-2.5 rounded-lg bg-red-600 text-white text-[11px] font-bold hover:bg-red-500 disabled:opacity-50"
                                >
                                  {deletingProductId === p.id ? 'Excluindo...' : 'Confirmar'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="h-8 px-2 rounded-lg border border-white/15 text-[11px] text-[#9E9E9E] hover:text-white"
                                >
                                  Cancelar
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openEditModal(p)}
                                  title="Editar custos, preço e estoque"
                                  className="h-8 px-2.5 rounded-lg border border-white/15 text-[11px] font-bold text-white hover:bg-white hover:text-black transition-colors inline-flex items-center gap-1"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openBatchModal(p)}
                                  title="Registrar novo lote de compra (CMP)"
                                  className="h-8 px-2.5 rounded-lg border border-white/15 text-[11px] font-bold text-white hover:bg-white hover:text-black transition-colors inline-flex items-center gap-1"
                                >
                                  <PackagePlus className="w-3 h-3" />
                                  Lote
                                </button>
                                <button
                                  type="button"
                                  onClick={() => loadProductIntoSalesSimulator(p)}
                                  title="Simular vendas deste produto"
                                  className="h-8 w-8 rounded-lg border border-white/15 text-white hover:bg-white hover:text-black transition-colors inline-flex items-center justify-center"
                                >
                                  <Calculator className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void openDetailModal(p)}
                                  title="Ver histórico de custos e lotes"
                                  disabled={loadingDetail}
                                  className="h-8 w-8 rounded-lg border border-white/15 text-white hover:bg-white hover:text-black transition-colors inline-flex items-center justify-center disabled:opacity-50"
                                >
                                  <History className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(p.id)}
                                  title="Excluir produto do estoque e catálogo"
                                  aria-label={`Excluir ${p.name}`}
                                  className="h-8 w-8 rounded-lg border border-white/15 text-[#9E9E9E] hover:text-red-400 hover:border-red-500/40 transition-colors inline-flex items-center justify-center"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Historical Sales Gross Profit Snapshot */}
          <section className="rounded-xl border border-white/12 bg-[#0C0C0C] p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Lucro Bruto Histórico por Pedidos (Custos Preservados)
                </h3>
                <p className="text-xs text-[#9E9E9E]">
                  Calculado sobre {data.historicalSales.ordersAnalyzed} pedido(s) não cancelado(s) usando o custo histórico vigente na data de cada venda.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs tabular-nums">
                <span className="text-[#9E9E9E]">
                  Receita itens: <strong className="text-white">{formatBRL(data.historicalSales.totalSalesRevenue)}</strong>
                </span>
                <span className="text-[#9E9E9E]">
                  Custo histórico: <strong className="text-white">{formatBRL(data.historicalSales.totalHistoricalCost)}</strong>
                </span>
                <span className="text-[#9E9E9E]">
                  Lucro bruto: <strong className="text-emerald-400">{formatBRL(data.historicalSales.totalHistoricalGrossProfit)}</strong>
                </span>
              </div>
            </div>

            {data.historicalSales.recentOrders.length === 0 ? (
              <p className="text-xs text-[#737373] py-4">
                Ainda não há pedidos confirmados ou em andamento registrados para compor o histórico.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-[11px] text-[#9E9E9E]">
                      <th className="py-2 pr-3">Pedido</th>
                      <th className="py-2 px-3">Data</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3 text-right">Itens vendidos</th>
                      <th className="py-2 px-3 text-right">Custo na data</th>
                      <th className="py-2 px-3 text-right">Lucro bruto</th>
                      <th className="py-2 pl-3 text-right">Margem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/8">
                    {data.historicalSales.recentOrders.map((ord) => (
                      <tr key={ord.orderId}>
                        <td className="py-2.5 pr-3 font-bold text-white tabular-nums">#{ord.orderNumber}</td>
                        <td className="py-2.5 px-3 text-[#9E9E9E] tabular-nums">{formatDateTimeBR(ord.createdAt)}</td>
                        <td className="py-2.5 px-3 text-[#E5E5E5]">{ord.status}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-white">{formatBRL(ord.itemsRevenue)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-[#9E9E9E]">{formatBRL(ord.historicalCost)}</td>
                        <td
                          className={`py-2.5 px-3 text-right tabular-nums font-bold ${
                            ord.historicalGrossProfit >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {formatBRL(ord.historicalGrossProfit)}
                        </td>
                        <td className="py-2.5 pl-3 text-right tabular-nums text-white">{formatPercent(ord.marginPercent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ================= SUB-TAB 2: SALES SIMULATOR ================= */}
      {subTab === 'sales_sim' && data && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          <div className="lg:col-span-5 rounded-xl border border-white/12 bg-[#0C0C0C] p-5 space-y-4">
            <div>
              <h3 className="text-base font-bold text-white">Simulador de Vendas</h3>
              <p className="text-xs text-[#9E9E9E] mt-0.5">
                Selecione um produto real ou personalize os valores para simular investimento, faturamento e lucro.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Carregar produto do catálogo</label>
              <select
                value={salesSimProductId}
                onChange={(e) => {
                  const val = e.target.value;
                  setSalesSimProductId(val);
                  if (val !== 'custom') {
                    const found = data.products.find((p) => String(p.id) === val);
                    if (found) {
                      setSalesSimPurchaseCost(found.costPrice.toFixed(2));
                      setSalesSimAdditionalCost(found.totalAdditionalCostUnit.toFixed(2));
                      setSalesSimSalePrice(found.price.toFixed(2));
                      setSalesSimStockQty(String(found.stockQuantity));
                      setSalesSimSellQty(String(found.stockQuantity > 0 ? found.stockQuantity : 10));
                    }
                  }
                }}
                className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
              >
                <option value="custom">Simulação personalizada</option>
                {data.products.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name} ({p.sku}) — Estoque: {p.stockQuantity} un.
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Valor de compra / un. (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={salesSimPurchaseCost}
                  onChange={(e) => setSalesSimPurchaseCost(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Custos adicionais / un. (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={salesSimAdditionalCost}
                  onChange={(e) => setSalesSimAdditionalCost(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Preço de venda / un. (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={salesSimSalePrice}
                  onChange={(e) => setSalesSimSalePrice(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Estoque disponível (un.)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={salesSimStockQty}
                  onChange={(e) => setSalesSimStockQty(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                Quantidade que pretendo vender (un.)
              </label>
              <input
                type="number"
                step="1"
                min="0"
                value={salesSimSellQty}
                onChange={(e) => setSalesSimSellQty(e.target.value)}
                className="w-full h-12 px-4 rounded-xl bg-black border border-white/25 text-base font-bold text-white tabular-nums focus:outline-none focus:border-white"
              />
              <div className="flex flex-wrap gap-2 mt-2.5">
                {[10, 25, 50, 100].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setSalesSimSellQty(String(preset))}
                    className="px-2.5 py-1.5 rounded-lg bg-black border border-white/15 text-xs font-semibold text-[#E5E5E5] hover:border-white hover:text-white transition-colors tabular-nums"
                  >
                    {preset} un.
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSalesSimSellQty(String(Math.max(0, Math.round(parseDecimalInput(salesSimStockQty)))))}
                  className="px-2.5 py-1.5 rounded-lg bg-black border border-white/15 text-xs font-semibold text-white hover:bg-white hover:text-black transition-colors"
                >
                  Todo o estoque
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 rounded-xl border border-white/12 bg-[#0C0C0C] p-5 flex flex-col justify-between space-y-5">
            <div>
              <p className="text-xs text-[#9E9E9E]">Resultado em tempo real da simulação</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-4">
                <div className="p-4 rounded-xl bg-black border border-white/10">
                  <p className="text-xs text-[#9E9E9E]">Investimento total</p>
                  <p className="text-2xl font-extrabold text-white tabular-nums mt-1">
                    {formatBRL(salesSimResult.totalInvestment)}
                  </p>
                  <p className="text-[11px] text-[#737373] mt-1 tabular-nums">
                    Custo unitário total: {formatBRL(salesSimResult.totalUnitCost)}
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-black border border-white/10">
                  <p className="text-xs text-[#9E9E9E]">Faturamento previsto</p>
                  <p className="text-2xl font-extrabold text-white tabular-nums mt-1">
                    {formatBRL(salesSimResult.expectedRevenue)}
                  </p>
                  <p className="text-[11px] text-[#737373] mt-1 tabular-nums">
                    Lucro por unidade: {formatBRL(salesSimResult.profitPerUnit)}
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-black border border-white/10">
                  <p className="text-xs text-[#9E9E9E]">Lucro bruto previsto</p>
                  <p
                    className={`text-2xl font-extrabold tabular-nums mt-1 ${
                      salesSimResult.expectedGrossProfit >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {formatBRL(salesSimResult.expectedGrossProfit)}
                  </p>
                  <p className="text-[11px] text-[#737373] mt-1 tabular-nums">
                    Markup sobre custo: {formatPercent(salesSimResult.markupPercent)}
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-black border border-white/10">
                  <p className="text-xs text-[#9E9E9E]">Margem de lucro</p>
                  <p
                    className={`text-2xl font-extrabold tabular-nums mt-1 ${
                      salesSimResult.marginPercent >= 0 ? 'text-white' : 'text-red-400'
                    }`}
                  >
                    {formatPercent(salesSimResult.marginPercent)}
                  </p>
                  <p className="text-[11px] text-[#737373] mt-1">
                    Lucro bruto ÷ faturamento
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-black border border-white/10 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#9E9E9E]">Quantidade restante em estoque após as vendas</span>
                <span
                  className={`font-extrabold tabular-nums text-sm ${
                    salesSimResult.remainingStock >= 0 ? 'text-white' : 'text-red-400'
                  }`}
                >
                  {salesSimResult.remainingStock >= 0
                    ? `${salesSimResult.remainingStock} unidades restantes`
                    : `Déficit de ${salesSimResult.stockDeficit} unidades`}
                </span>
              </div>
              {(() => {
                const stockNum = Math.max(0, Math.round(parseDecimalInput(salesSimStockQty)));
                const sellNum = Math.max(0, Math.round(parseDecimalInput(salesSimSellQty)));
                const usedPct = stockNum > 0 ? Math.min(100, (sellNum / stockNum) * 100) : sellNum > 0 ? 100 : 0;
                return (
                  <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        salesSimResult.remainingStock < 0 ? 'bg-red-500' : 'bg-white'
                      }`}
                      style={{ width: `${usedPct}%` }}
                    />
                  </div>
                );
              })()}
              {salesSimResult.stockDeficit > 0 && (
                <p className="text-xs text-red-300">
                  Atenção: a quantidade simulada excede o estoque atual em {salesSimResult.stockDeficit} unidade(s). Considere registrar um novo lote de compra.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= SUB-TAB 3: PRICE SIMULATOR ================= */}
      {subTab === 'price_sim' && data && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
            <div className="lg:col-span-5 rounded-xl border border-white/12 bg-[#0C0C0C] p-5 space-y-4">
              <div>
                <h3 className="text-base font-bold text-white">Simulador de Preços</h3>
                <p className="text-xs text-[#9E9E9E] mt-0.5">
                  Defina a margem ou o lucro desejado por unidade para descobrir o preço ideal de venda.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Produto de referência</label>
                <select
                  value={priceSimProductId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPriceSimProductId(val);
                    if (val !== 'custom') {
                      const found = data.products.find((p) => String(p.id) === val);
                      if (found) {
                        setPriceSimPurchaseCost(found.costPrice.toFixed(2));
                        setPriceSimAdditionalCost(found.totalAdditionalCostUnit.toFixed(2));
                        setPriceSimStockQty(String(found.stockQuantity));
                        setCustomComparePrices([found.price]);
                      }
                    }
                  }}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                >
                  <option value="custom">Cálculo livre (sem vincular produto)</option>
                  {data.products.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name} — Custo {formatBRL(p.totalUnitCost)} · Atual {formatBRL(p.price)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Custo de compra / un. (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={priceSimPurchaseCost}
                    onChange={(e) => setPriceSimPurchaseCost(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Custos adicionais / un. (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={priceSimAdditionalCost}
                    onChange={(e) => setPriceSimAdditionalCost(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Modo de meta</label>
                <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-black border border-white/15">
                  <button
                    type="button"
                    onClick={() => setPriceSimMode('margin')}
                    className={`py-2 px-3 rounded-lg text-xs font-bold transition-colors ${
                      priceSimMode === 'margin' ? 'bg-white text-black' : 'text-[#9E9E9E] hover:text-white'
                    }`}
                  >
                    Margem desejada (%)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPriceSimMode('profit')}
                    className={`py-2 px-3 rounded-lg text-xs font-bold transition-colors ${
                      priceSimMode === 'profit' ? 'bg-white text-black' : 'text-[#9E9E9E] hover:text-white'
                    }`}
                  >
                    Lucro desejado (R$)
                  </button>
                </div>
              </div>

              {priceSimMode === 'margin' ? (
                <div>
                  <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Margem de lucro desejada (%)</label>
                  <input
                    type="number"
                    step="0.5"
                    max="99.9"
                    value={priceSimTargetMargin}
                    onChange={(e) => setPriceSimTargetMargin(e.target.value)}
                    className="w-full h-12 px-4 rounded-xl bg-black border border-white/25 text-base font-bold text-white tabular-nums focus:outline-none focus:border-white"
                  />
                  <div className="flex flex-wrap gap-2 mt-2">
                    {[25, 30, 40, 50, 60].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPriceSimTargetMargin(String(m))}
                        className="px-2.5 py-1 rounded-lg bg-black border border-white/15 text-xs text-[#E5E5E5] hover:border-white tabular-nums"
                      >
                        {m}%
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Lucro bruto desejado / un. (R$)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={priceSimTargetProfit}
                    onChange={(e) => setPriceSimTargetProfit(e.target.value)}
                    className="w-full h-12 px-4 rounded-xl bg-black border border-white/25 text-base font-bold text-white tabular-nums focus:outline-none focus:border-white"
                  />
                </div>
              )}
            </div>

            <div className="lg:col-span-7 rounded-xl border border-white/12 bg-[#0C0C0C] p-5 flex flex-col justify-between space-y-5">
              <div>
                <p className="text-xs text-[#9E9E9E]">Preço de venda recomendado</p>
                {priceSimCalculatedPrice === null || !priceSimCalculatedMetrics ? (
                  <div className="mt-4 p-4 rounded-xl bg-red-950/40 border border-red-500/40 text-xs text-red-200">
                    Para calcular por margem sobre o preço de venda, informe uma margem inferior a 100%.
                  </div>
                ) : (
                  <div className="space-y-4 mt-3">
                    <div className="p-5 rounded-xl bg-black border border-white/15 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <p className="text-xs text-[#9E9E9E]">Preço de venda calculado</p>
                        <p className="text-3xl font-extrabold text-white tabular-nums mt-1">
                          {formatBRL(priceSimCalculatedPrice)}
                        </p>
                        <p className="text-xs text-[#737373] mt-1 tabular-nums">
                          Sobre custo unitário total de {formatBRL(priceSimUnitCost)}
                        </p>
                      </div>

                      {priceSimProductId !== 'custom' && priceSimCalculatedPrice > 0 && (
                        <button
                          type="button"
                          disabled={applyingSimulatedPrice}
                          onClick={() => void handleApplySimulatedPrice(priceSimCalculatedPrice)}
                          className="h-10 px-4 rounded-xl bg-white text-black font-bold text-xs hover:bg-neutral-200 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                        >
                          {applyingSimulatedPrice ? 'Aplicando...' : 'Aplicar este preço ao produto'}
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-3.5 rounded-xl bg-black border border-white/10">
                        <p className="text-[11px] text-[#9E9E9E]">Lucro / unidade</p>
                        <p className="text-base font-bold text-emerald-400 tabular-nums mt-1">
                          {formatBRL(priceSimCalculatedMetrics.profitPerUnit)}
                        </p>
                      </div>
                      <div className="p-3.5 rounded-xl bg-black border border-white/10">
                        <p className="text-[11px] text-[#9E9E9E]">Margem real</p>
                        <p className="text-base font-bold text-white tabular-nums mt-1">
                          {formatPercent(priceSimCalculatedMetrics.marginPercent)}
                        </p>
                      </div>
                      <div className="p-3.5 rounded-xl bg-black border border-white/10">
                        <p className="text-[11px] text-[#9E9E9E]">Markup</p>
                        <p className="text-base font-bold text-white tabular-nums mt-1">
                          {formatPercent(priceSimCalculatedMetrics.markupPercent)}
                        </p>
                      </div>
                      <div className="p-3.5 rounded-xl bg-black border border-white/10">
                        <p className="text-[11px] text-[#9E9E9E]">Lucro estoque</p>
                        <p className="text-base font-bold text-emerald-400 tabular-nums mt-1">
                          {formatBRL(priceSimCalculatedMetrics.potentialProfit)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 rounded-xl bg-black border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-[#9E9E9E]">
                  Adicione preços alternativos abaixo para comparar lado a lado sem alterar o catálogo.
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={newComparePriceInput}
                    onChange={(e) => setNewComparePriceInput(e.target.value)}
                    placeholder="Ex: 19,90"
                    className="h-9 w-28 px-3 rounded-lg bg-[#0C0C0C] border border-white/15 text-xs text-white tabular-nums focus:outline-none focus:border-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const val = roundMoney(parseDecimalInput(newComparePriceInput));
                      if (val > 0) {
                        setCustomComparePrices((prev) => (prev.includes(val) ? prev : [...prev, val]));
                        setNewComparePriceInput('');
                      }
                    }}
                    className="h-9 px-3 rounded-lg bg-white text-black font-bold text-xs hover:bg-neutral-200 transition-colors whitespace-nowrap"
                  >
                    Comparar preço
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Comparison Table */}
          <div className="rounded-xl border border-white/12 bg-[#0C0C0C] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
              <h4 className="text-sm font-bold text-white">Comparativo de Preços Simulados</h4>
              {customComparePrices.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCustomComparePrices([])}
                  className="text-xs text-[#9E9E9E] hover:text-white"
                >
                  Limpar preços extras
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-[11px] text-[#9E9E9E]">
                    <th className="py-3 px-4">Cenário</th>
                    <th className="py-3 px-3 text-right">Preço simulado</th>
                    <th className="py-3 px-3 text-right">Custo unit.</th>
                    <th className="py-3 px-3 text-right">Lucro / un.</th>
                    <th className="py-3 px-3 text-right">Margem (%)</th>
                    <th className="py-3 px-3 text-right">Markup (%)</th>
                    <th className="py-3 px-4 text-right">Lucro potencial ({priceSimStockQty || 0} un.)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/8">
                  {priceComparisonScenarios.map((sc) => (
                    <tr key={`${sc.label}-${sc.price}`} className="hover:bg-white/[0.03]">
                      <td className="py-3 px-4 font-semibold text-white">{sc.label}</td>
                      <td className="py-3 px-3 text-right tabular-nums font-bold text-white">
                        {formatBRL(sc.price)}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums text-[#9E9E9E]">
                        {formatBRL(sc.metrics.totalUnitCost)}
                      </td>
                      <td
                        className={`py-3 px-3 text-right tabular-nums font-bold ${
                          sc.metrics.profitPerUnit >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {formatBRL(sc.metrics.profitPerUnit)}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums text-white font-semibold">
                        {formatPercent(sc.metrics.marginPercent)}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums text-[#E5E5E5]">
                        {formatPercent(sc.metrics.markupPercent)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums font-bold text-white">
                        {formatBRL(sc.metrics.potentialProfit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================= SUB-TAB 4: BATCHES & COST HISTORY ================= */}
      {subTab === 'history' && data && (
        <div className="space-y-5">
          <div className="rounded-xl border border-white/12 bg-[#0C0C0C] p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-white" />
                Método de Custeio: Custo Médio Ponderado (CMP)
              </h3>
              <p className="text-xs text-[#9E9E9E] max-w-3xl">{data.costingMethodNote}</p>
            </div>
            <select
              value={historyProductFilter}
              onChange={(e) => setHistoryProductFilter(e.target.value)}
              aria-label="Filtrar histórico por produto"
              className="h-10 px-3 rounded-xl bg-black border border-white/15 text-xs text-white focus:outline-none focus:border-white shrink-0"
            >
              <option value="all">Todos os produtos (incl. arquivados)</option>
              {historyProductOptions.map((opt) => (
                <option key={opt.id} value={String(opt.id)}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Purchase Batches */}
          <div className="rounded-xl border border-white/12 bg-[#0C0C0C] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/10">
              <h4 className="text-sm font-bold text-white">Lotes de Compra Registrados</h4>
            </div>
            {filteredBatches.length === 0 ? (
              <p className="p-8 text-center text-xs text-[#737373]">
                Nenhum lote de compra registrado ainda. Use o botão &ldquo;Lote&rdquo; na tabela de rentabilidade para adicionar compras com custos diferentes.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-[11px] text-[#9E9E9E]">
                      <th className="py-3 px-4">Data</th>
                      <th className="py-3 px-3">Produto</th>
                      <th className="py-3 px-3 text-right">Qtd. comprada</th>
                      <th className="py-3 px-3 text-right">Compra / un.</th>
                      <th className="py-3 px-3 text-right">Adicionais / un.</th>
                      <th className="py-3 px-3 text-right">Custo total / un.</th>
                      <th className="py-3 px-4">Observação / Fornecedor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/8">
                    {filteredBatches.map((b) => {
                      const addUnit = roundMoney(b.freightCostUnit + b.packagingCostUnit + b.otherCostUnit);
                      return (
                        <tr key={b.id}>
                          <td className="py-3 px-4 text-[#9E9E9E] tabular-nums whitespace-nowrap">
                            {formatDateTimeBR(b.purchasedAt)}
                          </td>
                          <td className="py-3 px-3 font-semibold text-white">
                            {b.productName}{' '}
                            <span className="text-[#737373] font-normal">
                              ({b.productSku}{b.productArchived ? ' · Arquivado' : ''})
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-white font-bold">
                            +{b.quantityPurchased} un.
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-white">
                            {formatBRL(b.unitPurchaseCost)}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-[#9E9E9E]">
                            {formatBRL(addUnit)}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-white font-bold">
                            {formatBRL(b.totalUnitCost)}
                          </td>
                          <td className="py-3 px-4 text-[#9E9E9E]">{b.supplierNote || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Immutable Cost & Price History */}
          <div className="rounded-xl border border-white/12 bg-[#0C0C0C] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/10">
              <h4 className="text-sm font-bold text-white">Histórico Imutável de Custos e Preços</h4>
            </div>
            {filteredHistory.length === 0 ? (
              <p className="p-8 text-center text-xs text-[#737373]">Sem registros no histórico.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-[11px] text-[#9E9E9E]">
                      <th className="py-3 px-4">Data / Hora</th>
                      <th className="py-3 px-3">Produto</th>
                      <th className="py-3 px-3">Evento</th>
                      <th className="py-3 px-3 text-right">Custo unit. total</th>
                      <th className="py-3 px-3 text-right">Preço venda</th>
                      <th className="py-3 px-3 text-right">Estoque</th>
                      <th className="py-3 px-4">Observação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/8">
                    {filteredHistory.map((h) => (
                      <tr key={h.id}>
                        <td className="py-3 px-4 text-[#9E9E9E] tabular-nums whitespace-nowrap">
                          {formatDateTimeBR(h.recordedAt)}
                        </td>
                        <td className="py-3 px-3 font-semibold text-white">
                          {h.productNameSnapshot}
                          {h.productArchived && (
                            <span className="text-[#737373] font-normal"> (Arquivado)</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-[#E5E5E5]">
                          {EVENT_TYPE_LABELS[h.eventType] || h.eventType}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums text-white font-semibold">
                          {formatBRL(h.totalUnitCost)}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums text-white">
                          {formatBRL(h.salePrice)}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums text-[#9E9E9E]">
                          {h.stockQuantity} un.
                        </td>
                        <td className="py-3 px-4 text-[#9E9E9E]">{h.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= MODAL 1: EDIT PRODUCT COSTS / PRICE / STOCK ================= */}
      {editingRow && editPreview && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveEdit}
            className="w-full max-w-2xl rounded-2xl border border-white/20 bg-[#0E0E0E] p-5 sm:p-6 space-y-5 my-auto"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-extrabold text-white">{editingRow.product.name}</h3>
                <p className="text-xs text-[#9E9E9E] mt-0.5">
                  {editingRow.product.category} · Calculadora automática de lucro e estoque
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingRow(null)}
                className="p-1.5 rounded-lg text-[#9E9E9E] hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">SKU</label>
                <input
                  type="text"
                  value={editingRow.sku}
                  onChange={(e) => setEditingRow({ ...editingRow, sku: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white uppercase focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                  Valor de compra / un. (R$) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={editingRow.costPrice}
                  onChange={(e) => setEditingRow({ ...editingRow, costPrice: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                  Preço de venda / un. (R$) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={editingRow.price}
                  onChange={(e) => setEditingRow({ ...editingRow, price: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Frete de compra / un. (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editingRow.freightCostUnit}
                  onChange={(e) => setEditingRow({ ...editingRow, freightCostUnit: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Embalagem / un. (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editingRow.packagingCostUnit}
                  onChange={(e) => setEditingRow({ ...editingRow, packagingCostUnit: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Outros custos / un. (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editingRow.otherCostUnit}
                  onChange={(e) => setEditingRow({ ...editingRow, otherCostUnit: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Quantidade comprada (un.)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={editingRow.purchasedQuantity}
                  onChange={(e) => setEditingRow({ ...editingRow, purchasedQuantity: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Estoque disponível (un.)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={editingRow.stockQuantity}
                  onChange={(e) => setEditingRow({ ...editingRow, stockQuantity: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Motivo / Observação</label>
                <input
                  type="text"
                  value={editingRow.note}
                  onChange={(e) => setEditingRow({ ...editingRow, note: e.target.value })}
                  placeholder="Opcional"
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                />
              </div>
            </div>

            {/* Automatic Live Profit Calculator inside Modal */}
            <div className="p-4 rounded-xl bg-black border border-white/15 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <p className="text-[#9E9E9E]">Custo unitário total</p>
                <p className="text-sm font-bold text-white tabular-nums mt-0.5">
                  {formatBRL(editPreview.totalUnitCost)}
                </p>
              </div>
              <div>
                <p className="text-[#9E9E9E]">Lucro bruto / un.</p>
                <p
                  className={`text-sm font-extrabold tabular-nums mt-0.5 ${
                    editPreview.profitPerUnit >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {formatBRL(editPreview.profitPerUnit)}
                </p>
              </div>
              <div>
                <p className="text-[#9E9E9E]">Margem · Markup</p>
                <p className="text-sm font-bold text-white tabular-nums mt-0.5">
                  {formatPercent(editPreview.marginPercent)} · {formatPercent(editPreview.markupPercent)}
                </p>
              </div>
              <div>
                <p className="text-[#9E9E9E]">Investido no estoque</p>
                <p className="text-sm font-bold text-white tabular-nums mt-0.5">
                  {formatBRL(editPreview.potentialCost)}
                </p>
              </div>
              <div>
                <p className="text-[#9E9E9E]">Faturamento potencial</p>
                <p className="text-sm font-bold text-white tabular-nums mt-0.5">
                  {formatBRL(editPreview.potentialRevenue)}
                </p>
              </div>
              <div>
                <p className="text-[#9E9E9E]">Lucro potencial total</p>
                <p
                  className={`text-sm font-extrabold tabular-nums mt-0.5 ${
                    editPreview.potentialProfit >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {formatBRL(editPreview.potentialProfit)}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditingRow(null)}
                className="h-10 px-4 rounded-xl border border-white/15 text-sm font-semibold text-[#9E9E9E] hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="h-10 px-6 rounded-xl bg-white text-black text-sm font-bold hover:bg-neutral-200 disabled:opacity-50"
              >
                {savingEdit ? 'Salvando...' : 'Salvar e sincronizar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ================= MODAL 2: REGISTER PURCHASE BATCH (WEIGHTED AVERAGE COST) ================= */}
      {batchModal && batchPreview && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveBatch}
            className="w-full max-w-xl rounded-2xl border border-white/20 bg-[#0E0E0E] p-5 sm:p-6 space-y-5 my-auto"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-extrabold text-white">Registrar Novo Lote (CMP)</h3>
                <p className="text-xs text-[#9E9E9E] mt-0.5">
                  {batchModal.product.name} · Estoque atual: {batchModal.product.stockQuantity} un. a{' '}
                  {formatBRL(batchModal.product.totalUnitCost)}/un.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBatchModal(null)}
                className="p-1.5 rounded-lg text-[#9E9E9E] hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                  Quantidade comprada no lote *
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  required
                  value={batchModal.quantityPurchased}
                  onChange={(e) => setBatchModal({ ...batchModal, quantityPurchased: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                  Valor de compra / un. do lote (R$) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={batchModal.unitPurchaseCost}
                  onChange={(e) => setBatchModal({ ...batchModal, unitPurchaseCost: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Frete de compra / un. (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={batchModal.freightCostUnit}
                  onChange={(e) => setBatchModal({ ...batchModal, freightCostUnit: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Embalagem / un. (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={batchModal.packagingCostUnit}
                  onChange={(e) => setBatchModal({ ...batchModal, packagingCostUnit: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Outros custos / un. (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={batchModal.otherCostUnit}
                  onChange={(e) => setBatchModal({ ...batchModal, otherCostUnit: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Fornecedor / Nota</label>
                <input
                  type="text"
                  value={batchModal.supplierNote}
                  onChange={(e) => setBatchModal({ ...batchModal, supplierNote: e.target.value })}
                  placeholder="Ex: Distribuidora Central NF 124"
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-black border border-white/15 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <p className="text-[#9E9E9E]">Investimento do lote</p>
                <p className="text-sm font-bold text-white tabular-nums mt-0.5">
                  {formatBRL(batchPreview.batchTotalInvestment)}
                </p>
              </div>
              <div>
                <p className="text-[#9E9E9E]">Novo custo médio (CMP)</p>
                <p className="text-sm font-extrabold text-white tabular-nums mt-0.5">
                  {formatBRL(batchPreview.nextTotalUnitCost)}/un.
                </p>
              </div>
              <div>
                <p className="text-[#9E9E9E]">Novo estoque</p>
                <p className="text-sm font-bold text-white tabular-nums mt-0.5">
                  {batchPreview.nextStockQuantity} un.
                </p>
              </div>
              <div>
                <p className="text-[#9E9E9E]">Novo lucro / un.</p>
                <p
                  className={`text-sm font-extrabold tabular-nums mt-0.5 ${
                    batchPreview.nextProfitUnit >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {formatBRL(batchPreview.nextProfitUnit)} ({formatPercent(batchPreview.nextMargin)})
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setBatchModal(null)}
                className="h-10 px-4 rounded-xl border border-white/15 text-sm font-semibold text-[#9E9E9E] hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingBatch}
                className="h-10 px-6 rounded-xl bg-white text-black text-sm font-bold hover:bg-neutral-200 disabled:opacity-50"
              >
                {savingBatch ? 'Registrando...' : 'Confirmar lote'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ================= MODAL 3: PRODUCT DETAIL HISTORY ================= */}
      {detailModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-3xl rounded-2xl border border-white/20 bg-[#0E0E0E] p-5 sm:p-6 space-y-4 my-auto">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-extrabold text-white">
                  Histórico de Custos — {detailModal.product.name}
                </h3>
                <p className="text-xs text-[#9E9E9E] mt-0.5">
                  {detailModal.product.sku} · Custo atual {formatBRL(detailModal.product.totalUnitCost)} · Venda{' '}
                  {formatBRL(detailModal.product.price)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailModal(null)}
                className="p-1.5 rounded-lg text-[#9E9E9E] hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto space-y-4 pr-1">
              <div>
                <h4 className="text-xs font-bold text-white mb-2">Lotes registrados ({detailModal.batches.length})</h4>
                {detailModal.batches.length === 0 ? (
                  <p className="text-xs text-[#737373]">Nenhum lote separado registrado para este produto.</p>
                ) : (
                  <div className="space-y-2">
                    {detailModal.batches.map((b) => (
                      <div
                        key={b.id}
                        className="p-3 rounded-xl bg-black border border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <div>
                          <span className="font-bold text-white tabular-nums">+{b.quantityPurchased} un.</span>
                          <span className="text-[#9E9E9E] ml-2">{formatDateTimeBR(b.purchasedAt)}</span>
                          {b.supplierNote && <span className="text-[#737373] ml-2">· {b.supplierNote}</span>}
                        </div>
                        <div className="tabular-nums font-semibold text-white">
                          Total {formatBRL(b.totalUnitCost)}/un.
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-xs font-bold text-white mb-2">
                  Linha do tempo de custos e preços ({detailModal.history.length})
                </h4>
                <div className="space-y-2">
                  {detailModal.history.map((h) => (
                    <div
                      key={h.id}
                      className="p-3 rounded-xl bg-black border border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <span className="font-semibold text-white">
                          {EVENT_TYPE_LABELS[h.eventType] || h.eventType}
                        </span>
                        <span className="text-[#9E9E9E] ml-2 tabular-nums">{formatDateTimeBR(h.recordedAt)}</span>
                        {h.note && <p className="text-[11px] text-[#737373] mt-0.5">{h.note}</p>}
                      </div>
                      <div className="text-right tabular-nums">
                        <span className="text-[#9E9E9E]">Custo </span>
                        <strong className="text-white">{formatBRL(h.totalUnitCost)}</strong>
                        <span className="text-[#9E9E9E]"> · Venda </span>
                        <strong className="text-white">{formatBRL(h.salePrice)}</strong>
                        <span className="text-[#737373]"> · Estoque {h.stockQuantity}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL 4: ADD NEW PRODUCT DIRECTLY TO STOCK ================= */}
      {newStockProduct && newProductPreview && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveNewStockProduct}
            className="w-full max-w-2xl rounded-2xl border border-white/20 bg-[#0E0E0E] p-5 sm:p-6 space-y-5 my-auto"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-extrabold text-white">Adicionar Produto no Estoque</h3>
                <p className="text-xs text-[#9E9E9E] mt-0.5">
                  Após salvar, o produto fica gravado no estoque e no catálogo até você clicar em &ldquo;Excluir&rdquo;.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNewStockProduct(null)}
                className="p-1.5 rounded-lg text-[#9E9E9E] hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Nome do produto *</label>
                <input
                  type="text"
                  required
                  value={newStockProduct.name}
                  onChange={(e) => setNewStockProduct({ ...newStockProduct, name: e.target.value })}
                  placeholder="Ex: Essência Ziggy Happy Frutti 50g"
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">SKU (opcional)</label>
                <input
                  type="text"
                  value={newStockProduct.sku}
                  onChange={(e) => setNewStockProduct({ ...newStockProduct, sku: e.target.value })}
                  placeholder="Automático se vazio"
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white uppercase focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Categoria *</label>
                <input
                  type="text"
                  required
                  value={newStockProduct.category}
                  onChange={(e) => setNewStockProduct({ ...newStockProduct, category: e.target.value })}
                  placeholder="Essências, Narguilés..."
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                  Valor de compra / un. (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={newStockProduct.costPrice}
                  onChange={(e) => setNewStockProduct({ ...newStockProduct, costPrice: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                  Preço de venda / un. (R$) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={newStockProduct.price}
                  onChange={(e) => setNewStockProduct({ ...newStockProduct, price: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Quantidade comprada (un.)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={newStockProduct.purchasedQuantity}
                  onChange={(e) =>
                    setNewStockProduct({ ...newStockProduct, purchasedQuantity: e.target.value })
                  }
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Estoque disponível (un.) *</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  required
                  value={newStockProduct.stockQuantity}
                  onChange={(e) => setNewStockProduct({ ...newStockProduct, stockQuantity: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Frete de compra / un. (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={newStockProduct.freightCostUnit}
                  onChange={(e) => setNewStockProduct({ ...newStockProduct, freightCostUnit: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Embalagem / un. (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={newStockProduct.packagingCostUnit}
                  onChange={(e) =>
                    setNewStockProduct({ ...newStockProduct, packagingCostUnit: e.target.value })
                  }
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Outros custos / un. (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={newStockProduct.otherCostUnit}
                  onChange={(e) => setNewStockProduct({ ...newStockProduct, otherCostUnit: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                  Título da 1ª seleção
                </label>
                <input
                  type="text"
                  value={newStockProduct.variationLabel}
                  onChange={(e) => setNewStockProduct({ ...newStockProduct, variationLabel: e.target.value })}
                  placeholder="Ex: Sabor"
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                  1ª Variação / Sabores (por vírgula)
                </label>
                <input
                  type="text"
                  value={newStockProduct.variationsText}
                  onChange={(e) => setNewStockProduct({ ...newStockProduct, variationsText: e.target.value })}
                  placeholder="Ex: Melancia, Tropical"
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                  Título da 2ª seleção (opcional)
                </label>
                <input
                  type="text"
                  value={newStockProduct.secondaryVariationLabel}
                  onChange={(e) =>
                    setNewStockProduct({ ...newStockProduct, secondaryVariationLabel: e.target.value })
                  }
                  placeholder="Ex: Gelo"
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">
                  2ª Variação / Sabores (por vírgula — opcional)
                </label>
                <input
                  type="text"
                  value={newStockProduct.secondaryVariationsText}
                  onChange={(e) =>
                    setNewStockProduct({ ...newStockProduct, secondaryVariationsText: e.target.value })
                  }
                  placeholder="Ex: Gelo de coco, Gelo de melancia, Gelo de maracujá"
                  className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                />
              </div>

              <div className="sm:col-span-3">
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1">Descrição</label>
                <textarea
                  rows={2}
                  value={newStockProduct.description}
                  onChange={(e) => setNewStockProduct({ ...newStockProduct, description: e.target.value })}
                  className="w-full p-3 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white resize-none"
                />
              </div>

              <div className="sm:col-span-3 space-y-2.5">
                <input
                  ref={newProductFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => void handleNewProductFileSelected(e)}
                  className="hidden"
                />
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    disabled={uploadingNewImage}
                    onClick={() => newProductFileInputRef.current?.click()}
                    className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-white text-black font-bold text-xs hover:bg-neutral-200 disabled:opacity-50 shrink-0"
                  >
                    <ImagePlus className="w-4 h-4" />
                    {uploadingNewImage ? 'Enviando...' : 'Escolher foto do celular'}
                  </button>
                  <input
                    type="text"
                    value={newStockProduct.imageUrl}
                    onChange={(e) => setNewStockProduct({ ...newStockProduct, imageUrl: e.target.value })}
                    placeholder="URL da foto (opcional)"
                    className="flex-1 h-10 px-3.5 rounded-xl bg-black border border-white/15 text-xs text-white focus:outline-none focus:border-white"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_PRODUCT_IMAGES.map((img) => (
                    <button
                      key={img.url}
                      type="button"
                      onClick={() => setNewStockProduct({ ...newStockProduct, imageUrl: img.url })}
                      className="px-2.5 py-1 rounded-lg bg-black border border-white/15 text-[11px] text-[#E5E5E5] hover:border-white"
                    >
                      {img.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-black border border-white/15 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <p className="text-[#9E9E9E]">Custo unit. total</p>
                <p className="text-sm font-bold text-white tabular-nums mt-0.5">
                  {formatBRL(newProductPreview.totalUnitCost)}
                </p>
              </div>
              <div>
                <p className="text-[#9E9E9E]">Lucro bruto / un.</p>
                <p
                  className={`text-sm font-extrabold tabular-nums mt-0.5 ${
                    newProductPreview.profitPerUnit >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {formatBRL(newProductPreview.profitPerUnit)}
                </p>
              </div>
              <div>
                <p className="text-[#9E9E9E]">Margem · Markup</p>
                <p className="text-sm font-bold text-white tabular-nums mt-0.5">
                  {formatPercent(newProductPreview.marginPercent)} · {formatPercent(newProductPreview.markupPercent)}
                </p>
              </div>
              <div>
                <p className="text-[#9E9E9E]">Lucro potencial</p>
                <p
                  className={`text-sm font-extrabold tabular-nums mt-0.5 ${
                    newProductPreview.potentialProfit >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {formatBRL(newProductPreview.potentialProfit)}
                </p>
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-sm text-white cursor-pointer">
              <input
                type="checkbox"
                checked={newStockProduct.active}
                onChange={(e) => setNewStockProduct({ ...newStockProduct, active: e.target.checked })}
                className="w-4 h-4 accent-white"
              />
              Produto visível no catálogo da loja
            </label>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setNewStockProduct(null)}
                className="h-10 px-4 rounded-xl border border-white/15 text-sm font-semibold text-[#9E9E9E] hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingNewProduct || uploadingNewImage}
                className="inline-flex items-center gap-2 h-10 px-6 rounded-xl bg-white text-black text-sm font-extrabold hover:bg-neutral-200 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {savingNewProduct ? 'Salvando...' : 'Salvar Produto no Estoque'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
