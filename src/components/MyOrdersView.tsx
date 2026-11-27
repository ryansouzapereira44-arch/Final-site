import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Bike,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Gift,
  MapPin,
  PackageCheck,
  RotateCw,
  Ticket,
  User as UserIcon,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  formatBRL,
  formatCepInput,
  formatCpfInput,
  formatDateTimeBR,
  formatWhatsappInput,
  isValidCpf,
} from '../lib/format';
import { isOrderDelivered, isTrackingAvailableForOrder } from '../lib/tracking';
import type { Order, RoulettePrize, RouletteStateResponse, User } from '../types';

export type AccountSubTab = 'profile' | 'orders' | 'roulette';

interface MyAccountViewProps {
  token: string | null;
  user: User;
  subTab: AccountSubTab;
  onSubTabChange: (tab: AccountSubTab) => void;
  orders: Order[];
  ordersLoading: boolean;
  onTrackDelivery: (orderId: number) => void;
  rouletteState: RouletteStateResponse | null;
  onProfileSaved: (updatedUser: User) => void;
  onRouletteUpdated: (nextState: RouletteStateResponse) => void;
  onApplyPrizeCoupon: (code: string) => void;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeSlice(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
}

export function MyAccountView({
  token,
  user,
  subTab,
  onSubTabChange,
  orders,
  ordersLoading,
  onTrackDelivery,
  rouletteState,
  onProfileSaved,
  onRouletteUpdated,
  onApplyPrizeCoupon,
}: MyAccountViewProps) {

  // Profile / Address form state
  const [name, setName] = useState(user.name);
  const [whatsapp, setWhatsapp] = useState(user.whatsapp || '');
  const [cpf, setCpf] = useState(user.cpf || '');
  const [cep, setCep] = useState(user.savedAddress?.cep || '');
  const [street, setStreet] = useState(user.savedAddress?.street || '');
  const [number, setNumber] = useState(user.savedAddress?.number || '');
  const [neighborhood, setNeighborhood] = useState(user.savedAddress?.neighborhood || '');
  const [complement, setComplement] = useState(user.savedAddress?.complement || '');
  const [lookingUpCep, setLookingUpCep] = useState(false);
  const [cepStatus, setCepStatus] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNotice, setProfileNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const lastFetchedCepRef = useRef<string>(user.savedAddress?.cep.replace(/\D/g, '') || '');

  // Roulette wheel state
  const [spinning, setSpinning] = useState(false);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [spinResult, setSpinResult] = useState<{
    prize: RoulettePrize;
    couponCode: string | null;
    couponExpiresAt: string | null;
  } | null>(null);
  const [rouletteError, setRouletteError] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    setName(user.name);
    setWhatsapp(user.whatsapp || '');
    setCpf(user.cpf || '');
    if (user.savedAddress) {
      setCep(user.savedAddress.cep || '');
      setStreet(user.savedAddress.street || '');
      setNumber(user.savedAddress.number || '');
      setNeighborhood(user.savedAddress.neighborhood || '');
      setComplement(user.savedAddress.complement || '');
    }
  }, [user]);

  // Auto-fill street and neighborhood as soon as 8 digits of CEP are entered
  useEffect(() => {
    const cleanCep = cep.replace(/\D/g, '');
    if (cleanCep.length !== 8 || cleanCep === lastFetchedCepRef.current) return;

    let active = true;
    lastFetchedCepRef.current = cleanCep;
    setLookingUpCep(true);
    setCepStatus('');

    api
      .lookupCep(token, cleanCep)
      .then((res) => {
        if (!active) return;
        if (res.street) setStreet(res.street);
        if (res.neighborhood) setNeighborhood(res.neighborhood);
        setCepStatus(
          res.city && res.state
            ? `CEP localizado: ${res.city} - ${res.state}`
            : 'Endereço preenchido automaticamente.'
        );
      })
      .catch(() => {
        if (!active) return;
        setCepStatus('CEP não encontrado automaticamente. Preencha rua e bairro.');
      })
      .finally(() => {
        if (active) setLookingUpCep(false);
      });

    return () => {
      active = false;
    };
  }, [cep, token]);

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setProfileNotice(null);

    if (name.trim().length < 2) {
      setProfileNotice({ type: 'err', text: 'Informe seu nome completo.' });
      return;
    }
    if (cpf.trim() && !isValidCpf(cpf)) {
      setProfileNotice({ type: 'err', text: 'O CPF informado é inválido.' });
      return;
    }

    setSavingProfile(true);
    try {
      const hasAnyAddress = Boolean(
        cep.trim() || street.trim() || number.trim() || neighborhood.trim() || complement.trim()
      );
      const res = await api.updateProfile(token, {
        name: name.trim(),
        whatsapp: whatsapp.trim(),
        cpf: cpf.trim(),
        savedAddress: hasAnyAddress
          ? {
              cep: cep.trim(),
              street: street.trim(),
              number: number.trim(),
              neighborhood: neighborhood.trim(),
              complement: complement.trim(),
            }
          : null,
      });
      onProfileSaved(res.user);
      setProfileNotice({
        type: 'ok',
        text: 'Dados e endereço salvos! Eles já irão preenchidos automaticamente no seu carrinho/checkout.',
      });
    } catch (err) {
      setProfileNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erro ao salvar dados.',
      });
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSpinRoulette() {
    if (spinning || !rouletteState || rouletteState.chances.available <= 0) return;
    setRouletteError('');
    setSpinResult(null);
    setSpinning(true);

    try {
      const res = await api.spinRoulette(token);
      const count = res.state.prizes.length || 5;
      const sliceDeg = 360 / count;
      // Target angle so that slice center aligns with top pointer (0 deg)
      const sliceCenterAngle = res.prizeIndex * sliceDeg + sliceDeg / 2;
      const targetOffset = (360 - sliceCenterAngle) % 360;
      const currentMod = ((wheelRotation % 360) + 360) % 360;
      const delta = (targetOffset - currentMod + 360) % 360;
      const nextRotation = wheelRotation + 360 * 6 + delta;

      setWheelRotation(nextRotation);

      window.setTimeout(() => {
        setSpinning(false);
        setSpinResult({
          prize: res.prize,
          couponCode: res.couponCode,
          couponExpiresAt: res.couponExpiresAt,
        });
        onRouletteUpdated(res.state);
      }, 4300);
    } catch (err) {
      setSpinning(false);
      setRouletteError(err instanceof Error ? err.message : 'Não foi possível girar a roleta.');
    }
  }

  function handleCopyCoupon(code: string) {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopiedCode(code);
    window.setTimeout(() => setCopiedCode(null), 2000);
  }

  const prizes = rouletteState?.prizes || [];
  const sliceDeg = prizes.length > 0 ? 360 / prizes.length : 72;
  const activeDeliveries = orders.filter((o) => isTrackingAvailableForOrder(o));

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Minha Conta</h1>
        <p className="text-sm text-[#9E9E9E] mt-1">
          Gerencie seu endereço salvo, acompanhe entregas em tempo real e gire a Roleta R&amp;P.
        </p>
      </div>

      {/* Automatic active delivery callout inside Minha Conta */}
      {activeDeliveries.length > 0 && (
        <div className="rounded-2xl border border-white/25 bg-[#111111] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Bike className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-extrabold text-white">
                Pedido #{activeDeliveries[0].orderNumber} saiu para entrega!
              </p>
              <p className="text-xs text-[#9E9E9E] mt-0.5">
                Acompanhe o motoboy pelo mapa em tempo real até o seu endereço.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onTrackDelivery(activeDeliveries[0].id)}
            className="h-10 px-4 rounded-xl bg-white text-black font-extrabold text-xs inline-flex items-center justify-center gap-2 hover:bg-neutral-200 transition-colors whitespace-nowrap shrink-0"
          >
            <Bike className="w-4 h-4" />
            ACOMPANHAR ENTREGA
          </button>
        </div>
      )}

      {/* Sub-tabs: Dados & Endereço | Pedidos & Entrega | ROLETA */}
      <div className="flex flex-wrap items-center gap-2 p-1.5 bg-[#0C0C0C] border border-white/12 rounded-2xl w-fit max-w-full">
        <button
          type="button"
          onClick={() => onSubTabChange('profile')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-colors whitespace-nowrap ${
            subTab === 'profile' ? 'bg-white text-black' : 'text-[#9E9E9E] hover:text-white'
          }`}
        >
          <UserIcon className="w-4 h-4" />
          Dados e Endereço
        </button>

        <button
          type="button"
          onClick={() => onSubTabChange('orders')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-colors whitespace-nowrap tabular-nums ${
            subTab === 'orders' ? 'bg-white text-black' : 'text-[#9E9E9E] hover:text-white'
          }`}
        >
          <PackageCheck className="w-4 h-4" />
          Meus Pedidos ({orders.length})
        </button>

        <button
          type="button"
          onClick={() => onSubTabChange('roulette')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-colors whitespace-nowrap tabular-nums ${
            subTab === 'roulette' ? 'bg-white text-black' : 'text-[#9E9E9E] hover:text-white'
          }`}
        >
          <Gift className="w-4 h-4" />
          ROLETA ({rouletteState?.chances.available ?? 0})
        </button>
      </div>

      {/* PROFILE & SAVED ADDRESS TAB */}
      {subTab === 'profile' && (
        <form
          onSubmit={handleSaveProfile}
          className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-6 sm:p-8 space-y-6"
        >
          <div className="flex items-start gap-3 pb-4 border-b border-white/10">
            <MapPin className="w-5 h-5 text-white shrink-0 mt-0.5" />
            <div>
              <h2 className="text-lg font-extrabold text-white">Cadastro Automático para Carrinho e Entrega</h2>
              <p className="text-xs sm:text-sm text-[#9E9E9E] mt-0.5">
                Salve seu telefone e endereço uma única vez. Ao digitar o CEP, rua e bairro são preenchidos
                automaticamente.
              </p>
            </div>
          </div>

          {profileNotice && (
            <div
              role="alert"
              className={`p-3.5 rounded-2xl text-xs sm:text-sm border ${
                profileNotice.type === 'ok'
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
                  : 'bg-red-950/60 border-red-500/40 text-red-200'
              }`}
            >
              {profileNotice.text}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="acc-name" className="block text-xs font-semibold text-[#E5E5E5] mb-1.5">
                Nome completo *
              </label>
              <input
                id="acc-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
              />
            </div>

            <div>
              <label htmlFor="acc-whatsapp" className="block text-xs font-semibold text-[#E5E5E5] mb-1.5">
                Telefone / WhatsApp com DDD
              </label>
              <input
                id="acc-whatsapp"
                type="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(formatWhatsappInput(e.target.value))}
                placeholder="(11) 99999-9999"
                className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
              />
            </div>

            <div>
              <label htmlFor="acc-cpf" className="block text-xs font-semibold text-[#E5E5E5] mb-1.5">
                CPF (opcional)
              </label>
              <input
                id="acc-cpf"
                type="text"
                inputMode="numeric"
                value={cpf}
                onChange={(e) => setCpf(formatCpfInput(e.target.value))}
                placeholder="000.000.000-00"
                className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-white/10 space-y-4">
            <h3 className="text-base font-bold text-white">Endereço de Entrega</h3>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor="acc-cep" className="block text-xs font-semibold text-[#E5E5E5] mb-1.5">
                  CEP
                </label>
                <input
                  id="acc-cep"
                  type="text"
                  inputMode="numeric"
                  value={cep}
                  onChange={(e) => setCep(formatCepInput(e.target.value))}
                  placeholder="00000-000"
                  className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white tabular-nums focus:outline-none focus:border-white"
                />
                {(lookingUpCep || cepStatus) && (
                  <p className="text-[11px] text-[#9E9E9E] mt-1">
                    {lookingUpCep ? 'Buscando endereço pelo CEP...' : cepStatus}
                  </p>
                )}
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="acc-neighborhood" className="block text-xs font-semibold text-[#E5E5E5] mb-1.5">
                  Bairro
                </label>
                <input
                  id="acc-neighborhood"
                  type="text"
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                  placeholder="Bairro"
                  className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                />
              </div>

              <div className="sm:col-span-3">
                <label htmlFor="acc-street" className="block text-xs font-semibold text-[#E5E5E5] mb-1.5">
                  Rua / Avenida
                </label>
                <input
                  id="acc-street"
                  type="text"
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  placeholder="Nome da rua"
                  className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label htmlFor="acc-number" className="block text-xs font-semibold text-[#E5E5E5] mb-1.5">
                  Número
                </label>
                <input
                  id="acc-number"
                  type="text"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="Ex: 120"
                  className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                />
              </div>

              <div className="sm:col-span-4">
                <label htmlFor="acc-complement" className="block text-xs font-semibold text-[#E5E5E5] mb-1.5">
                  Complemento (opcional)
                </label>
                <input
                  id="acc-complement"
                  type="text"
                  value={complement}
                  onChange={(e) => setComplement(e.target.value)}
                  placeholder="Apartamento, bloco, referência..."
                  className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white focus:outline-none focus:border-white"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={savingProfile}
            className="h-12 px-7 rounded-xl bg-white text-black font-extrabold text-sm hover:bg-neutral-200 transition-colors disabled:opacity-50"
          >
            {savingProfile ? 'Salvando...' : 'Salvar Dados e Endereço'}
          </button>
        </form>
      )}

      {/* ORDER DETAILS & LIVE DELIVERY TRACKING TAB */}
      {subTab === 'orders' && (
        <div className="space-y-4">
          {ordersLoading ? (
            <div className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-10 text-center text-sm text-[#9E9E9E]">
              Carregando detalhes dos seus pedidos...
            </div>
          ) : orders.length === 0 ? (
            <div className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-12 text-center space-y-2">
              <PackageCheck className="w-9 h-9 mx-auto text-[#9E9E9E]" />
              <p className="text-base font-bold text-white">Você ainda não possui pedidos</p>
              <p className="text-sm text-[#9E9E9E]">
                Seus pedidos e o rastreamento de entregas aparecerão aqui.
              </p>
            </div>
          ) : (
            orders.map((order) => {
              const canTrack = isTrackingAvailableForOrder(order);
              const delivered = isOrderDelivered(order.status);

              return (
                <article
                  key={order.id}
                  className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-5 sm:p-6 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10">
                    <div>
                      <h2 className="text-base sm:text-lg font-extrabold text-white tabular-nums">
                        Detalhes do Pedido #{order.orderNumber}
                      </h2>
                      <p className="text-xs text-[#9E9E9E] mt-0.5">
                        {formatDateTimeBR(order.createdAt)} · {order.deliveryMethod} · {order.paymentMethod}
                      </p>
                    </div>
                    <span
                      className={`text-xs sm:text-sm font-bold px-3 py-1.5 rounded-lg ${
                        canTrack
                          ? 'bg-white text-black'
                          : delivered
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/35'
                            : 'bg-white/10 text-white'
                      }`}
                    >
                      {order.status}
                    </span>
                  </div>

                  {order.address && (
                    <div className="rounded-2xl bg-black border border-white/10 p-3.5 flex items-start gap-2.5 text-xs sm:text-sm">
                      <MapPin className="w-4 h-4 text-white shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-white">
                          {order.address.street}, {order.address.number} — {order.address.neighborhood}
                        </p>
                        <p className="text-xs text-[#9E9E9E] tabular-nums">
                          CEP {order.address.cep}
                          {order.address.complement ? ` · ${order.address.complement}` : ''}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    {order.items.map((item, idx) => (
                      <div key={`${item.productId}-${idx}`} className="flex justify-between text-sm">
                        <span className="text-[#E5E5E5]">
                          {item.quantity}x {item.name}{' '}
                          <span className="text-[#9E9E9E]">({item.variation})</span>
                        </span>
                        <span className="font-semibold text-white tabular-nums">
                          {formatBRL(item.price * item.quantity)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 text-sm">
                    <span className="text-xs text-[#9E9E9E]">
                      Frete: <strong className="text-white">{order.shippingLabel}</strong>
                      {order.couponCode ? ` · Cupom: ${order.couponCode}` : ''}
                    </span>
                    <span className="text-base font-extrabold text-white tabular-nums">
                      Total: {formatBRL(order.total)}
                    </span>
                  </div>

                  {canTrack && (
                    <div className="pt-3 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="text-xs">
                        <p className="font-bold text-white">Entrega em deslocamento</p>
                        <p className="text-[#9E9E9E]">
                          {order.assignedCourierName
                            ? `Motoboy: ${order.assignedCourierName} · `
                            : ''}
                          Clique para abrir o mapa em tempo real.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onTrackDelivery(order.id)}
                        className="h-11 px-5 rounded-xl bg-white text-black font-extrabold text-xs sm:text-sm inline-flex items-center justify-center gap-2 hover:bg-neutral-200 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Bike className="w-4 h-4" />
                        ACOMPANHAR ENTREGA
                      </button>
                    </div>
                  )}

                  {order.status === 'Entregue' && (
                    <div className="pt-2 flex items-center gap-2 text-xs text-emerald-300">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        Entrega concluída{order.deliveredAt ? ` em ${formatDateTimeBR(order.deliveredAt)}` : ''}.
                      </span>
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>
      )}

      {/* ROLETA TAB */}
      {subTab === 'roulette' && (
        <div className="space-y-6">
          {/* Chances Summary Strip */}
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <div className="rounded-2xl border border-white/15 bg-[#0C0C0C] p-4 sm:p-5">
              <p className="text-xs text-[#9E9E9E]">Disponíveis</p>
              <p className="text-2xl sm:text-3xl font-extrabold text-white mt-1 tabular-nums">
                {rouletteState?.chances.available ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-white/12 bg-[#0C0C0C] p-4 sm:p-5">
              <p className="text-xs text-[#9E9E9E]">Utilizadas</p>
              <p className="text-2xl sm:text-3xl font-extrabold text-white mt-1 tabular-nums">
                {rouletteState?.chances.used ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-white/12 bg-[#0C0C0C] p-4 sm:p-5">
              <p className="text-xs text-[#9E9E9E]">Expiradas</p>
              <p className="text-2xl sm:text-3xl font-extrabold text-[#9E9E9E] mt-1 tabular-nums">
                {rouletteState?.chances.expired ?? 0}
              </p>
            </div>
          </div>

          {/* Wheel + Action Card */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-center rounded-3xl border border-white/15 bg-[#0C0C0C] p-6 sm:p-8">
            <div className="flex flex-col items-center justify-center relative">
              {/* Top Pointer */}
              <div className="z-20 -mb-3">
                <div className="w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-t-[20px] border-t-white drop-shadow" />
              </div>

              {/* SVG Wheel */}
              <div className="relative w-64 h-64 sm:w-80 sm:h-80 rounded-full border-4 border-white/25 bg-black shadow-2xl overflow-hidden">
                <svg
                  viewBox="0 0 300 300"
                  className="w-full h-full"
                  style={{
                    transform: `rotate(${wheelRotation}deg)`,
                    transition: spinning ? 'transform 4.2s cubic-bezier(0.12, 0.85, 0.16, 1)' : 'none',
                  }}
                >
                  {prizes.map((prize, idx) => {
                    const start = idx * sliceDeg;
                    const end = start + sliceDeg;
                    const mid = start + sliceDeg / 2;
                    const isLight = idx % 2 === 0;
                    const fill = isLight ? '#FFFFFF' : '#141414';
                    const textColor = isLight ? '#000000' : '#FFFFFF';
                    const textPos = polarToCartesian(150, 150, 96, mid);

                    return (
                      <g key={prize.id}>
                        <path
                          d={describeSlice(150, 150, 150, start, end)}
                          fill={fill}
                          stroke="#2A2A2A"
                          strokeWidth="1.5"
                        />
                        <text
                          x={textPos.x}
                          y={textPos.y}
                          fill={textColor}
                          fontSize="11"
                          fontWeight="800"
                          fontFamily="Montserrat, sans-serif"
                          textAnchor="middle"
                          dominantBaseline="middle"
                          transform={`rotate(${mid}, ${textPos.x}, ${textPos.y})`}
                        >
                          {prize.shortLabel}
                        </text>
                      </g>
                    );
                  })}
                  <circle cx="150" cy="150" r="24" fill="#000000" stroke="#FFFFFF" strokeWidth="3" />
                  <text
                    x="150"
                    y="151"
                    fill="#FFFFFF"
                    fontSize="10"
                    fontWeight="800"
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    R&amp;P
                  </text>
                </svg>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold tracking-[0.15em] text-[#9E9E9E]">ROLETA DE PRÊMIOS R&amp;P</p>
                <h2 className="text-2xl font-extrabold text-white mt-1">Gire e ganhe cupons exclusivos</h2>
                <p className="text-sm text-[#9E9E9E] mt-2 leading-relaxed">
                  A cada <strong className="text-white">R$ 50,00</strong> em produtos no pedido confirmado pelo
                  administrador, você recebe <strong className="text-white">1 chance</strong> válida por 7 dias.
                </p>
              </div>

              {rouletteError && (
                <div role="alert" className="p-3.5 rounded-xl bg-red-950/60 border border-red-500/40 text-xs text-red-200">
                  {rouletteError}
                </div>
              )}

              {spinResult && (
                <div className="p-4 rounded-2xl bg-black border border-white/25 space-y-3">
                  <div>
                    <p className="text-xs text-[#9E9E9E]">Resultado do giro</p>
                    <p className="text-xl font-extrabold text-white mt-0.5">{spinResult.prize.label}</p>
                  </div>

                  {spinResult.couponCode ? (
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-3 py-1.5 rounded-lg bg-white text-black font-extrabold text-sm tracking-wide">
                          {spinResult.couponCode}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyCoupon(spinResult.couponCode!)}
                          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-white/20 text-xs font-semibold text-white hover:bg-white hover:text-black transition-colors"
                        >
                          {copiedCode === spinResult.couponCode ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              Copiado
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              Copiar
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onApplyPrizeCoupon(spinResult.couponCode!)}
                          className="h-9 px-3.5 rounded-lg bg-emerald-500 text-black text-xs font-bold hover:bg-emerald-400 transition-colors"
                        >
                          Usar no Checkout
                        </button>
                      </div>
                      {spinResult.couponExpiresAt && (
                        <p className="text-xs text-[#9E9E9E] tabular-nums">
                          Cupom válido por 7 dias (expira em {formatDateTimeBR(spinResult.couponExpiresAt)}).
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-[#9E9E9E]">
                      Não gerou cupom desta vez. Continue acumulando chances nos próximos pedidos confirmados!
                    </p>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={() => void handleSpinRoulette()}
                disabled={spinning || !rouletteState || rouletteState.chances.available <= 0}
                className="w-full h-12 rounded-xl bg-white text-black font-extrabold text-sm inline-flex items-center justify-center gap-2 hover:bg-neutral-200 active:scale-[0.99] transition-all disabled:opacity-40"
              >
                <RotateCw className={`w-4 h-4 ${spinning ? 'animate-spin' : ''}`} />
                {spinning
                  ? 'GIRANDO...'
                  : rouletteState && rouletteState.chances.available > 0
                    ? `GIRAR ROLETA (${rouletteState.chances.available} disponível)`
                    : 'SEM CHANCES DISPONÍVEIS'}
              </button>
            </div>
          </div>

          {/* Active Chances & Expiration Dates + Spin History */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Validade das chances */}
            <section className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-5 sm:p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-white" />
                <h3 className="text-base font-extrabold text-white">Validade das Chances Disponíveis</h3>
              </div>

              {!rouletteState || rouletteState.chances.activeList.length === 0 ? (
                <p className="text-xs sm:text-sm text-[#9E9E9E]">
                  Nenhuma chance disponível no momento. Faça um pedido a partir de R$ 50,00 em produtos e aguarde a
                  confirmação do administrador.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {rouletteState.chances.activeList.map((chance, index) => (
                    <div
                      key={chance.id}
                      className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-black border border-white/10 text-xs sm:text-sm"
                    >
                      <div>
                        <p className="font-bold text-white">
                          Chance #{index + 1} · Pedido #{chance.orderNumber}
                        </p>
                        <p className="text-xs text-[#9E9E9E] mt-0.5 tabular-nums">
                          Liberada em {formatDateTimeBR(chance.grantedAt)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-[#9E9E9E]">Válida até</p>
                        <p className="font-semibold text-white tabular-nums">
                          {formatDateTimeBR(chance.expiresAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Histórico de giros e prêmios */}
            <section className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-5 sm:p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Ticket className="w-4 h-4 text-white" />
                <h3 className="text-base font-extrabold text-white">Histórico de Giros e Prêmios</h3>
              </div>

              {!rouletteState || rouletteState.spins.length === 0 ? (
                <p className="text-xs sm:text-sm text-[#9E9E9E]">Você ainda não girou a roleta.</p>
              ) : (
                <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                  {rouletteState.spins.map((spin) => {
                    const couponExpired =
                      spin.couponExpiresAt !== null &&
                      new Date(spin.couponExpiresAt).getTime() <= Date.now();
                    return (
                      <div
                        key={spin.id}
                        className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-black border border-white/10 text-xs sm:text-sm"
                      >
                        <div>
                          <p className="font-bold text-white">{spin.prizeLabel}</p>
                          <p className="text-xs text-[#9E9E9E] mt-0.5 tabular-nums">
                            {formatDateTimeBR(spin.createdAt)}
                            {spin.couponCode && spin.couponExpiresAt && (
                              <>
                                {' · '}
                                <span className={couponExpired ? 'text-red-400' : 'text-[#9E9E9E]'}>
                                  {couponExpired
                                    ? `Cupom expirado (${formatDateTimeBR(spin.couponExpiresAt)})`
                                    : `Cupom válido até ${formatDateTimeBR(spin.couponExpiresAt)}`}
                                </span>
                              </>
                            )}
                          </p>
                        </div>

                        {spin.couponCode ? (
                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={`px-2.5 py-1 rounded-lg font-bold text-xs ${
                                couponExpired
                                  ? 'bg-white/10 text-[#9E9E9E] line-through'
                                  : 'bg-white text-black'
                              }`}
                            >
                              {spin.couponCode}
                            </span>
                            {!couponExpired && (
                              <button
                                type="button"
                                onClick={() => handleCopyCoupon(spin.couponCode!)}
                                aria-label={`Copiar cupom ${spin.couponCode}`}
                                className="p-1.5 rounded-lg border border-white/15 text-[#9E9E9E] hover:text-white"
                              >
                                {copiedCode === spin.couponCode ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-[#9E9E9E]">Sem cupom</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
