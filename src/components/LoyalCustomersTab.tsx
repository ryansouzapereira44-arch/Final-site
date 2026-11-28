import { useCallback, useEffect, useState } from 'react';
import {
  Award,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crown,
  Download,
  ExternalLink,
  Eye,
  Filter,
  MapPin,
  MessageCircle,
  Package,
  Search,
  ShoppingBag,
  Users,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatBRL, formatDateTimeBR } from '../lib/format';
import { formatCartItemVariationLine } from '../lib/whatsappOrder';
import type {
  LoyalCustomerDetail,
  LoyalCustomerPeriod,
  LoyalCustomerRow,
  LoyalCustomerSortBy,
  LoyalCustomersResponse,
} from '../types';
import { BrandLogoSVG } from './BrandMark';

interface LoyalCustomersTabProps {
  token: string | null;
  liveSyncTrigger?: number;
}

const PERIOD_OPTIONS: { value: LoyalCustomerPeriod; label: string }[] = [
  { value: 'all', label: 'Todo o período' },
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: 'current_month', label: 'Mês atual' },
  { value: 'custom', label: 'Personalizado' },
];

const SORT_OPTIONS: { value: LoyalCustomerSortBy; label: string }[] = [
  { value: 'total_spent', label: 'Maior total gasto' },
  { value: 'orders_count', label: 'Mais pedidos' },
  { value: 'avg_ticket', label: 'Maior ticket médio' },
  { value: 'last_order_at', label: 'Último pedido' },
];

function normalizeBrazilWhatsAppDigits(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length < 10) return '';
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return digits;
}

function buildWhatsAppUrl(rawPhone: string, message: string): string {
  const digits = normalizeBrazilWhatsAppDigits(rawPhone);
  if (!digits) return '#';
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function getDefaultWhatsAppMessage(customerName: string, topProduct?: string): string {
  const firstName = (customerName || 'cliente').trim().split(/\s+/)[0] || 'cliente';
  if (topProduct && topProduct !== '—') {
    return `Olá, ${firstName}! Aqui é da R&P Tabacaria. Vimos que você curte bastante ${topProduct} e separamos novidades especiais para você!`;
  }
  return `Olá, ${firstName}! Aqui é da R&P Tabacaria. Passando para agradecer a preferência e mostrar as novidades da loja!`;
}

function getRankVisuals(rank: number): {
  badgeClass: string;
  rowAccentClass: string;
  cardAccentClass: string;
  label: string;
} {
  if (rank === 1) {
    return {
      badgeClass: 'border-[#F5C451]/70 bg-[#F5C451]/15 text-[#F5C451]',
      rowAccentClass: 'bg-[#F5C451]/[0.05]',
      cardAccentClass: 'border-[#F5C451]/50 bg-gradient-to-b from-[#F5C451]/[0.08] to-[#0C0C0C]',
      label: 'Ouro',
    };
  }
  if (rank === 2) {
    return {
      badgeClass: 'border-[#D4D4D8]/60 bg-[#D4D4D8]/15 text-[#E4E4E7]',
      rowAccentClass: 'bg-[#D4D4D8]/[0.04]',
      cardAccentClass: 'border-[#D4D4D8]/45 bg-gradient-to-b from-[#D4D4D8]/[0.06] to-[#0C0C0C]',
      label: 'Prata',
    };
  }
  if (rank === 3) {
    return {
      badgeClass: 'border-[#D97706]/60 bg-[#D97706]/15 text-[#F59E0B]',
      rowAccentClass: 'bg-[#D97706]/[0.04]',
      cardAccentClass: 'border-[#D97706]/45 bg-gradient-to-b from-[#D97706]/[0.06] to-[#0C0C0C]',
      label: 'Bronze',
    };
  }
  return {
    badgeClass: 'border-white/15 bg-black text-[#E5E5E5]',
    rowAccentClass: '',
    cardAccentClass: 'border-white/12 bg-[#0C0C0C]',
    label: '',
  };
}

export function LoyalCustomersTab({ token, liveSyncTrigger = 0 }: LoyalCustomersTabProps) {
  const [period, setPeriod] = useState<LoyalCustomerPeriod>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortBy, setSortBy] = useState<LoyalCustomerSortBy>('total_spent');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [inactiveOnly, setInactiveOnly] = useState(false);
  const [page, setPage] = useState(1);

  const [data, setData] = useState<LoyalCustomersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const [detailTarget, setDetailTarget] = useState<LoyalCustomerRow | null>(null);
  const [detailData, setDetailData] = useState<LoyalCustomerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const [whatsappModal, setWhatsappModal] = useState<{
    name: string;
    whatsapp: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadRanking = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError('');
      try {
        const res = await api.getLoyalCustomers(token, {
          period,
          startDate: period === 'custom' ? startDate : undefined,
          endDate: period === 'custom' ? endDate : undefined,
          sortBy,
          search: debouncedSearch || undefined,
          neighborhood: neighborhood || undefined,
          inactiveOnly,
          page,
          pageSize: 15,
        });
        setData(res);
      } catch (err) {
        if (!silent) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar ranking de clientes fiéis.');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [token, period, startDate, endDate, sortBy, debouncedSearch, neighborhood, inactiveOnly, page]
  );

  useEffect(() => {
    void loadRanking(false);
  }, [loadRanking]);

  useEffect(() => {
    if (liveSyncTrigger > 0) {
      void loadRanking(true);
    }
  }, [liveSyncTrigger, loadRanking]);

  async function handleOpenDetail(row: LoyalCustomerRow) {
    setDetailTarget(row);
    setDetailData(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const res = await api.getLoyalCustomerDetail(token, row.userId);
      setDetailData(res);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Erro ao carregar ficha do cliente.');
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleExportCsv() {
    if (exporting) return;
    setError('');
    setExporting(true);
    try {
      const { blob, filename } = await api.exportLoyalCustomersCsv(token, {
        period,
        startDate: period === 'custom' ? startDate : undefined,
        endDate: period === 'custom' ? endDate : undefined,
        sortBy,
        search: debouncedSearch || undefined,
        neighborhood: neighborhood || undefined,
        inactiveOnly,
      });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao exportar CSV.');
    } finally {
      setExporting(false);
    }
  }

  function openWhatsAppComposer(name: string, whatsapp: string, topProduct?: string) {
    setWhatsappModal({
      name,
      whatsapp,
      message: getDefaultWhatsAppMessage(name, topProduct),
    });
  }

  const summary = data?.summary ?? {
    totalCustomers: 0,
    recurringCustomers: 0,
    overallAvgTicket: 0,
    top10Revenue: 0,
  };
  const customers = data?.customers ?? [];
  const neighborhoods = data?.neighborhoods ?? [];
  const pagination = data?.pagination ?? {
    page: 1,
    pageSize: 15,
    totalCount: 0,
    totalPages: 1,
  };

  const hasActiveFilters =
    period !== 'all' ||
    Boolean(debouncedSearch) ||
    Boolean(neighborhood) ||
    inactiveOnly ||
    sortBy !== 'total_spent';

  function handleClearFilters() {
    setPeriod('all');
    setStartDate('');
    setEndDate('');
    setSortBy('total_spent');
    setSearchInput('');
    setDebouncedSearch('');
    setNeighborhood('');
    setInactiveOnly(false);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      {/* Header with Official Logo */}
      <div className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <BrandLogoSVG size={44} />
          <div>
            <h2 className="text-lg sm:text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
              Clientes Mais Fiéis
            </h2>
            <p className="text-xs text-[#9E9E9E] mt-0.5">
              Ranking real calculado no servidor · Somente pedidos confirmados (frete não entra na soma).
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleExportCsv()}
          disabled={exporting || loading}
          className="inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-xl bg-white text-black font-extrabold text-xs sm:text-sm hover:bg-neutral-200 transition-colors disabled:opacity-50 self-start sm:self-auto shrink-0"
        >
          <Download className="w-4 h-4" />
          {exporting ? 'Exportando CSV...' : 'Exportar CSV'}
        </button>
      </div>

      {/* Top 4 Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-2xl border border-white/12 bg-[#0C0C0C] p-4 sm:p-5">
          <div className="flex items-center justify-between text-[#9E9E9E] text-xs">
            <span>Total de clientes</span>
            <Users className="w-4 h-4" />
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold text-white mt-2 tabular-nums">
            {summary.totalCustomers}
          </p>
          <p className="text-[11px] text-[#737373] mt-1">Com pedidos confirmados no filtro</p>
        </div>

        <div className="rounded-2xl border border-white/12 bg-[#0C0C0C] p-4 sm:p-5">
          <div className="flex items-center justify-between text-[#9E9E9E] text-xs">
            <span>Com + de 1 compra</span>
            <Award className="w-4 h-4" />
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold text-white mt-2 tabular-nums">
            {summary.recurringCustomers}
          </p>
          <p className="text-[11px] text-[#737373] mt-1">Clientes recorrentes</p>
        </div>

        <div className="rounded-2xl border border-white/12 bg-[#0C0C0C] p-4 sm:p-5">
          <div className="flex items-center justify-between text-[#9E9E9E] text-xs">
            <span>Ticket médio geral</span>
            <ShoppingBag className="w-4 h-4" />
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold text-white mt-2 tabular-nums">
            {formatBRL(summary.overallAvgTicket)}
          </p>
          <p className="text-[11px] text-[#737373] mt-1">Média por pedido (sem frete)</p>
        </div>

        <div className="rounded-2xl border border-[#F5C451]/30 bg-gradient-to-br from-[#F5C451]/[0.08] to-[#0C0C0C] p-4 sm:p-5">
          <div className="flex items-center justify-between text-[#F5C451] text-xs font-semibold">
            <span>Receita Top 10</span>
            <Crown className="w-4 h-4" />
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold text-white mt-2 tabular-nums">
            {formatBRL(summary.top10Revenue)}
          </p>
          <p className="text-[11px] text-[#9E9E9E] mt-1">10 maiores compradores</p>
        </div>
      </div>

      {/* Filters & Sorting Bar */}
      <div className="rounded-2xl border border-white/12 bg-[#0C0C0C] p-4 sm:p-5 space-y-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wider">
            <Filter className="w-3.5 h-3.5" />
            <span>Filtros e Ordenação</span>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="text-xs font-semibold text-[#9E9E9E] hover:text-white underline"
            >
              Limpar filtros
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-[#9E9E9E] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Nome, telefone ou e-mail..."
              aria-label="Buscar cliente por nome, telefone ou e-mail"
              className="w-full h-11 pl-10 pr-3.5 rounded-xl bg-black border border-white/15 text-xs sm:text-sm text-white placeholder-[#737373] focus:outline-none focus:border-white"
            />
          </div>

          <div>
            <select
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value as LoyalCustomerPeriod);
                setPage(1);
              }}
              aria-label="Filtrar por período"
              className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-xs sm:text-sm text-white focus:outline-none focus:border-white"
            >
              {PERIOD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  Período: {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <select
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value as LoyalCustomerSortBy);
                setPage(1);
              }}
              aria-label="Ordenar ranking"
              className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-xs sm:text-sm text-white focus:outline-none focus:border-white"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  Ordenar: {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <select
              value={neighborhood}
              onChange={(e) => {
                setNeighborhood(e.target.value);
                setPage(1);
              }}
              aria-label="Filtrar por bairro"
              className="w-full h-11 px-3.5 rounded-xl bg-black border border-white/15 text-xs sm:text-sm text-white focus:outline-none focus:border-white"
            >
              <option value="">Todos os bairros</option>
              {neighborhoods.map((b) => (
                <option key={b} value={b}>
                  Bairro: {b}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {period === 'custom' ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#9E9E9E]" />
                <label htmlFor="loyal-start-date" className="text-xs text-[#9E9E9E]">
                  De:
                </label>
                <input
                  id="loyal-start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setPage(1);
                  }}
                  className="h-9 px-2.5 rounded-lg bg-black border border-white/15 text-xs text-white focus:outline-none focus:border-white"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <label htmlFor="loyal-end-date" className="text-xs text-[#9E9E9E]">
                  Até:
                </label>
                <input
                  id="loyal-end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setPage(1);
                  }}
                  className="h-9 px-2.5 rounded-lg bg-black border border-white/15 text-xs text-white focus:outline-none focus:border-white"
                />
              </div>
            </div>
          ) : (
            <div />
          )}

          <button
            type="button"
            onClick={() => {
              setInactiveOnly((prev) => !prev);
              setPage(1);
            }}
            className={`inline-flex items-center gap-2 h-10 px-4 rounded-xl border text-xs font-bold transition-colors ${
              inactiveOnly
                ? 'bg-white text-black border-white'
                : 'bg-black text-[#E5E5E5] border-white/15 hover:border-white/40'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Clientes inativos (+30 dias sem comprar)</span>
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3.5 rounded-2xl bg-red-950/60 border border-red-500/40 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Ranking Results */}
      {loading ? (
        <div className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-12 text-center text-sm text-[#9E9E9E]">
          Calculando ranking de clientes mais fiéis...
        </div>
      ) : customers.length === 0 ? (
        <div className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-10 text-center space-y-2">
          <Users className="w-8 h-8 text-[#737373] mx-auto" />
          <p className="text-sm font-bold text-white">Nenhum cliente encontrado com esses critérios.</p>
          <p className="text-xs text-[#9E9E9E] max-w-md mx-auto">
            Somente pedidos confirmados pelo administrador entram no ranking. Experimente ampliar o período ou limpar os filtros.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden lg:block rounded-3xl border border-white/12 bg-[#0C0C0C] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-[#9E9E9E] bg-black/40">
                    <th className="py-3.5 px-4 font-bold">Pos.</th>
                    <th className="py-3.5 px-4 font-bold">Cliente</th>
                    <th className="py-3.5 px-4 font-bold">Telefone / WhatsApp</th>
                    <th className="py-3.5 px-4 font-bold">Bairro Principal</th>
                    <th className="py-3.5 px-4 font-bold text-center">Pedidos</th>
                    <th className="py-3.5 px-4 font-bold text-right">Total Gasto</th>
                    <th className="py-3.5 px-4 font-bold text-right">Ticket Médio</th>
                    <th className="py-3.5 px-4 font-bold">Último Pedido</th>
                    <th className="py-3.5 px-4 font-bold">Mais Comprado</th>
                    <th className="py-3.5 px-4 font-bold text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/8 text-xs">
                  {customers.map((c) => {
                    const visuals = getRankVisuals(c.rank);
                    const hasPhone = normalizeBrazilWhatsAppDigits(c.whatsapp).length >= 10;
                    return (
                      <tr
                        key={c.userId}
                        onClick={() => void handleOpenDetail(c)}
                        className={`cursor-pointer hover:bg-white/[0.04] transition-colors ${visuals.rowAccentClass}`}
                      >
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-extrabold tabular-nums ${visuals.badgeClass}`}
                          >
                            {c.rank <= 3 && <Crown className="w-3 h-3" />}#{c.rank}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 min-w-[180px]">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-white text-sm">{c.name}</span>
                            {c.isInactive30d && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/35 text-[10px] font-bold text-amber-300">
                                +30d inativo
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-[#9E9E9E] truncate max-w-[220px]">{c.email}</p>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap tabular-nums text-[#E5E5E5]">
                          {c.whatsapp || 'Não informado'}
                        </td>
                        <td className="py-3.5 px-4 text-[#E5E5E5]">{c.mainNeighborhood}</td>
                        <td className="py-3.5 px-4 text-center font-bold text-white tabular-nums">
                          {c.ordersCount}
                        </td>
                        <td className="py-3.5 px-4 text-right font-extrabold text-white tabular-nums whitespace-nowrap">
                          {formatBRL(c.totalSpent)}
                        </td>
                        <td className="py-3.5 px-4 text-right text-[#E5E5E5] tabular-nums whitespace-nowrap">
                          {formatBRL(c.avgTicket)}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap tabular-nums text-[#9E9E9E]">
                          {formatDateTimeBR(c.lastOrderAt)}
                        </td>
                        <td className="py-3.5 px-4 max-w-[190px]">
                          <span className="text-[#E5E5E5] line-clamp-2" title={c.topProduct}>
                            {c.topProduct}
                          </span>
                        </td>
                        <td
                          className="py-3.5 px-4 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleOpenDetail(c)}
                              title="Ver ficha do cliente"
                              className="h-9 px-2.5 rounded-lg border border-white/15 text-xs font-semibold text-white hover:bg-white hover:text-black transition-colors inline-flex items-center gap-1"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Ficha
                            </button>
                            <button
                              type="button"
                              disabled={!hasPhone}
                              onClick={() => openWhatsAppComposer(c.name, c.whatsapp, c.topProduct)}
                              title={hasPhone ? 'Chamar no WhatsApp' : 'Cliente sem WhatsApp válido'}
                              className="h-9 px-2.5 rounded-lg bg-emerald-500 text-black text-xs font-extrabold hover:bg-emerald-400 transition-colors disabled:opacity-35 disabled:cursor-not-allowed inline-flex items-center gap-1"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              WhatsApp
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Cards */}
          <div className="lg:hidden space-y-3">
            {customers.map((c) => {
              const visuals = getRankVisuals(c.rank);
              const hasPhone = normalizeBrazilWhatsAppDigits(c.whatsapp).length >= 10;
              return (
                <div
                  key={c.userId}
                  className={`rounded-2xl border p-4 space-y-3 ${visuals.cardAccentClass}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-extrabold tabular-nums shrink-0 ${visuals.badgeClass}`}
                      >
                        {c.rank <= 3 && <Crown className="w-3 h-3" />}#{c.rank}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="text-sm font-extrabold text-white truncate">{c.name}</h3>
                          {c.isInactive30d && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/35 text-[10px] font-bold text-amber-300">
                              +30d inativo
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#9E9E9E] truncate">{c.email}</p>
                        <p className="text-xs text-[#E5E5E5] tabular-nums mt-0.5">
                          {c.whatsapp || 'WhatsApp não informado'} · {c.mainNeighborhood}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-[#9E9E9E] uppercase">Total gasto</p>
                      <p className="text-base font-extrabold text-white tabular-nums">
                        {formatBRL(c.totalSpent)}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 rounded-xl bg-black/70 border border-white/10 p-2.5 text-center">
                    <div>
                      <p className="text-[10px] text-[#9E9E9E]">Pedidos</p>
                      <p className="text-xs font-bold text-white tabular-nums mt-0.5">{c.ordersCount}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-[#9E9E9E]">Ticket Médio</p>
                      <p className="text-xs font-bold text-white tabular-nums mt-0.5">
                        {formatBRL(c.avgTicket)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-[#9E9E9E]">Último Pedido</p>
                      <p className="text-[11px] font-semibold text-[#E5E5E5] tabular-nums mt-0.5">
                        {formatDateTimeBR(c.lastOrderAt)}
                      </p>
                    </div>
                  </div>

                  <div className="text-xs text-[#9E9E9E] flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5 shrink-0 text-white/70" />
                    <span className="truncate">
                      Mais comprado: <strong className="text-white">{c.topProduct}</strong>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => void handleOpenDetail(c)}
                      className="min-h-11 px-3 rounded-xl border border-white/15 text-xs font-bold text-white hover:bg-white hover:text-black transition-colors inline-flex items-center justify-center gap-1.5"
                    >
                      <Eye className="w-4 h-4" />
                      Ver Ficha
                    </button>
                    <button
                      type="button"
                      disabled={!hasPhone}
                      onClick={() => openWhatsAppComposer(c.name, c.whatsapp, c.topProduct)}
                      className="min-h-11 px-3 rounded-xl bg-emerald-500 text-black text-xs font-extrabold hover:bg-emerald-400 transition-colors disabled:opacity-35 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
                    >
                      <MessageCircle className="w-4 h-4" />
                      Chamar no WhatsApp
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
              <p className="text-xs text-[#9E9E9E] tabular-nums">
                Página {pagination.page} de {pagination.totalPages} · {pagination.totalCount} cliente(s)
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 h-10 px-3.5 rounded-xl border border-white/15 text-xs font-bold text-white hover:bg-white hover:text-black transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  className="inline-flex items-center gap-1 h-10 px-3.5 rounded-xl border border-white/15 text-xs font-bold text-white hover:bg-white hover:text-black transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  Próxima
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* CUSTOMER DETAIL MODAL */}
      {detailTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="loyal-customer-detail-title"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5"
        >
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl border border-white/20 bg-[#0C0C0C] p-5 sm:p-7 space-y-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <BrandLogoSVG size={40} />
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 id="loyal-customer-detail-title" className="text-lg sm:text-xl font-extrabold text-white">
                      {detailData?.customer.name || detailTarget.name}
                    </h3>
                    {(detailData?.customer.isInactive30d ?? detailTarget.isInactive30d) && (
                      <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/35 text-[11px] font-bold text-amber-300">
                        Inativo há +30 dias
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#9E9E9E] mt-0.5">
                    {detailData?.customer.email || detailTarget.email}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDetailTarget(null);
                  setDetailData(null);
                }}
                aria-label="Fechar ficha do cliente"
                className="p-2 rounded-xl text-[#9E9E9E] hover:text-white border border-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {detailLoading ? (
              <div className="py-12 text-center text-sm text-[#9E9E9E]">
                Carregando ficha completa do cliente...
              </div>
            ) : detailError ? (
              <div role="alert" className="p-4 rounded-2xl bg-red-950/60 border border-red-500/40 text-sm text-red-200">
                {detailError}
              </div>
            ) : detailData ? (
              <div className="space-y-6">
                {/* Contact & Summary */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-white/12 bg-black p-4 space-y-2 text-xs">
                    <p className="text-[#9E9E9E] font-bold uppercase tracking-wider">Contato</p>
                    <p className="text-sm text-white font-semibold tabular-nums">
                      WhatsApp: {detailData.customer.whatsapp || 'Não informado'}
                    </p>
                    {detailData.customer.cpf && (
                      <p className="text-[#E5E5E5] tabular-nums">CPF: {detailData.customer.cpf}</p>
                    )}
                    <p className="text-[#E5E5E5]">
                      Bairro principal: <strong className="text-white">{detailData.customer.mainNeighborhood}</strong>
                    </p>
                    <div className="pt-2">
                      <button
                        type="button"
                        disabled={normalizeBrazilWhatsAppDigits(detailData.customer.whatsapp).length < 10}
                        onClick={() =>
                          openWhatsAppComposer(
                            detailData.customer.name,
                            detailData.customer.whatsapp,
                            detailData.favoriteProducts[0]?.productName
                          )
                        }
                        className="inline-flex items-center gap-2 min-h-10 px-4 rounded-xl bg-emerald-500 text-black text-xs font-extrabold hover:bg-emerald-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <MessageCircle className="w-4 h-4" />
                        Chamar no WhatsApp
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/12 bg-black p-4 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-[#9E9E9E]">Pedidos confirmados</p>
                      <p className="text-xl font-extrabold text-white tabular-nums mt-0.5">
                        {detailData.customer.ordersCount}
                      </p>
                    </div>
                    <div>
                      <p className="text-[#9E9E9E]">Total gasto (sem frete)</p>
                      <p className="text-xl font-extrabold text-white tabular-nums mt-0.5">
                        {formatBRL(detailData.customer.totalSpent)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[#9E9E9E]">Ticket médio</p>
                      <p className="text-base font-bold text-white tabular-nums mt-0.5">
                        {formatBRL(detailData.customer.avgTicket)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[#9E9E9E]">Última compra</p>
                      <p className="text-xs font-semibold text-[#E5E5E5] tabular-nums mt-1">
                        {formatDateTimeBR(detailData.customer.lastOrderAt)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Addresses */}
                <div className="space-y-2.5">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    Endereços Utilizados ({detailData.addresses.length})
                  </h4>
                  {detailData.addresses.length === 0 ? (
                    <p className="text-xs text-[#9E9E9E]">Somente pedidos com retirada na loja.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {detailData.addresses.map((addr, idx) => (
                        <div
                          key={`${addr.cep}-${addr.street}-${addr.number}-${idx}`}
                          className="rounded-xl border border-white/10 bg-black p-3 text-xs space-y-0.5"
                        >
                          <p className="font-semibold text-white">
                            {addr.street}, {addr.number}
                          </p>
                          <p className="text-[#9E9E9E]">
                            {addr.neighborhood} · CEP {addr.cep}
                          </p>
                          {addr.complement && <p className="text-[#737373]">{addr.complement}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Favorite Products */}
                <div className="space-y-2.5">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5" />
                    Produtos e Sabores Favoritos
                  </h4>
                  {detailData.favoriteProducts.length === 0 ? (
                    <p className="text-xs text-[#9E9E9E]">Sem itens registrados.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {detailData.favoriteProducts.map((fav, idx) => (
                        <div
                          key={`${fav.productName}-${fav.variation}-${idx}`}
                          className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black p-3 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="font-bold text-white truncate">{fav.productName}</p>
                            {fav.variation && fav.variation !== 'Padrão' && (
                              <p className="text-[#9E9E9E] truncate">{fav.variation}</p>
                            )}
                          </div>
                          <div className="text-right shrink-0 tabular-nums">
                            <p className="font-extrabold text-white">{fav.totalQuantity} un.</p>
                            <p className="text-[11px] text-[#9E9E9E]">{formatBRL(fav.totalSpent)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Full Confirmed Order History */}
                <div className="space-y-2.5">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <ShoppingBag className="w-3.5 h-3.5" />
                    Histórico Completo de Pedidos Confirmados ({detailData.orders.length})
                  </h4>
                  <div className="space-y-2.5">
                    {detailData.orders.map((order) => (
                      <div
                        key={order.id}
                        className="rounded-2xl border border-white/12 bg-black p-4 space-y-2.5 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/10">
                          <div>
                            <span className="font-extrabold text-white text-sm tabular-nums">
                              Pedido #{order.orderNumber}
                            </span>
                            <span className="text-[#9E9E9E] ml-2 tabular-nums">
                              {formatDateTimeBR(order.createdAt)} · {order.deliveryMethod}
                            </span>
                          </div>
                          <span className="px-2 py-0.5 rounded bg-white/10 text-white font-bold">
                            {order.status}
                          </span>
                        </div>

                        <div className="space-y-1">
                          {order.items.map((item, idx) => {
                            const optionLine = formatCartItemVariationLine(item);
                            return (
                              <div key={`${item.productId}-${idx}`} className="flex justify-between gap-3">
                                <span className="text-[#E5E5E5]">
                                  <strong className="text-white tabular-nums">{item.quantity}x</strong> {item.name}
                                  {optionLine ? <span className="text-[#9E9E9E]"> — {optionLine}</span> : null}
                                </span>
                                <span className="font-semibold text-white tabular-nums shrink-0">
                                  {formatBRL(item.price * item.quantity)}
                                </span>
                              </div>
                            );
                          })}
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/10 text-[11px] text-[#9E9E9E]">
                          <span>
                            Produtos: <strong className="text-white">{formatBRL(order.subtotal)}</strong> · Frete:{' '}
                            {order.shippingLabel}
                          </span>
                          <span className="text-xs font-extrabold text-white tabular-nums">
                            Total pago: {formatBRL(order.total)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* WHATSAPP MESSAGE MODAL */}
      {whatsappModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="loyal-whatsapp-title"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-3xl border border-white/20 bg-[#111111] p-6 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="loyal-whatsapp-title" className="text-base font-extrabold text-white">
                  Chamar {whatsappModal.name} no WhatsApp
                </h3>
                <p className="text-xs text-[#9E9E9E] mt-0.5 tabular-nums">
                  Número: {whatsappModal.whatsapp || 'Não informado'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWhatsappModal(null)}
                aria-label="Fechar janela do WhatsApp"
                className="p-1.5 rounded-lg text-[#9E9E9E] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {normalizeBrazilWhatsAppDigits(whatsappModal.whatsapp).length < 10 ? (
              <div role="alert" className="p-3 rounded-xl bg-red-950/70 border border-red-500/40 text-xs text-red-200">
                Este cliente não possui um telefone/WhatsApp válido cadastrado.
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor="loyal-wa-message" className="block text-xs font-semibold text-[#E5E5E5] mb-1.5">
                    Mensagem pronta (você pode editar antes de enviar)
                  </label>
                  <textarea
                    id="loyal-wa-message"
                    rows={4}
                    value={whatsappModal.message}
                    onChange={(e) =>
                      setWhatsappModal({ ...whatsappModal, message: e.target.value })
                    }
                    className="w-full p-3.5 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white resize-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setWhatsappModal(null)}
                    className="h-10 px-4 rounded-xl border border-white/15 text-xs font-semibold text-[#9E9E9E] hover:text-white"
                  >
                    Cancelar
                  </button>
                  <a
                    href={buildWhatsAppUrl(whatsappModal.whatsapp, whatsappModal.message)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setWhatsappModal(null)}
                    className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-emerald-500 text-black text-xs sm:text-sm font-extrabold hover:bg-emerald-400 transition-colors"
                  >
                    <span>Abrir no WhatsApp</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
