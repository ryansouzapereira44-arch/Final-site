import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  Check,
  CreditCard,
  Crosshair,
  Lock,
  MapPin,
  QrCode,
  Store,
  Tag,
  Truck,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatBRL, formatCepInput, formatCpfInput, formatWhatsappInput, isValidCpf } from '../lib/format';
import type {
  CartItem,
  CheckoutDraft,
  Coupon,
  Order,
  PaymentMethod,
  ShippingEstimate,
  StoreSettings,
} from '../types';

interface CheckoutViewProps {
  token: string | null;
  items: CartItem[];
  subtotal: number;
  settings: StoreSettings;
  draft: CheckoutDraft;
  appliedCoupon: Coupon | null;
  discountAmount: number;
  onUpdateDraft: (updater: (prev: CheckoutDraft) => CheckoutDraft) => void;
  onApplyCouponState: (coupon: Coupon | null, discountAmount: number) => void;
  onBackToCart: () => void;
  onOrderCreated: (order: Order) => void;
}

const PAYMENT_OPTIONS: { value: PaymentMethod; label: string; hint: string }[] = [
  { value: 'PIX', label: 'PIX', hint: 'Aprovação rápida na entrega ou retirada' },
  { value: 'Cartão de crédito', label: 'Cartão de crédito', hint: 'Maquininha na entrega ou no balcão' },
  { value: 'Cartão de débito', label: 'Cartão de débito', hint: 'Maquininha na entrega ou no balcão' },
  { value: 'Dinheiro', label: 'Dinheiro', hint: 'Informe se precisar de troco' },
];

export function CheckoutView({
  token,
  items,
  subtotal,
  settings,
  draft,
  appliedCoupon,
  discountAmount,
  onUpdateDraft,
  onApplyCouponState,
  onBackToCart,
  onOrderCreated,
}: CheckoutViewProps) {
  const [couponMessage, setCouponMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [locatingGps, setLocatingGps] = useState(false);

  const subtotalAfterDiscount = Math.max(0, subtotal - discountAmount);

  const [shippingEstimate, setShippingEstimate] = useState<ShippingEstimate>({
    distanceKm: null,
    shippingFee: draft.deliveryMethod === 'Retirada na loja' ? 0 : null,
    shippingLabel: draft.deliveryMethod === 'Retirada na loja' ? 'Grátis (Retirada)' : 'A confirmar',
  });
  const [calculatingShipping, setCalculatingShipping] = useState(false);
  const [lookingUpCep, setLookingUpCep] = useState(false);
  const [cepStatus, setCepStatus] = useState('');
  const lastFetchedCepRef = useRef<string>(draft.address.cep.replace(/\D/g, ''));
  const autoValidatedCouponRef = useRef<string>('');

  // Auto-fill Street and Neighborhood whenever the user enters a new 8-digit CEP
  useEffect(() => {
    const cleanCep = draft.address.cep.replace(/\D/g, '');
    if (cleanCep.length !== 8 || cleanCep === lastFetchedCepRef.current) return;

    let active = true;
    lastFetchedCepRef.current = cleanCep;
    setLookingUpCep(true);
    setCepStatus('');

    api
      .lookupCep(token, cleanCep)
      .then((res) => {
        if (!active) return;
        if (res.street || res.neighborhood) {
          onUpdateDraft((prev) => ({
            ...prev,
            address: {
              ...prev.address,
              street: res.street || prev.address.street,
              neighborhood: res.neighborhood || prev.address.neighborhood,
            },
          }));
        }
        setCepStatus(
          res.city && res.state ? `CEP localizado: ${res.city} - ${res.state}` : 'Rua e bairro preenchidos.'
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
  }, [draft.address.cep, token, onUpdateDraft]);

  // Auto-validate coupon if draft.couponCode was pre-populated (e.g. from Roulette prize)
  useEffect(() => {
    const code = draft.couponCode.trim().toUpperCase();
    if (!code || appliedCoupon || subtotal <= 0 || autoValidatedCouponRef.current === code) return;
    autoValidatedCouponRef.current = code;

    let active = true;
    setCheckingCoupon(true);
    api
      .validateCoupon(token, code, subtotal)
      .then((res) => {
        if (!active) return;
        if (res.valid && res.coupon) {
          onApplyCouponState(res.coupon, res.discountAmount || 0);
          setCouponMessage({ type: 'ok', text: res.message });
        }
      })
      .catch((err) => {
        if (!active) return;
        setCouponMessage({
          type: 'err',
          text: err instanceof Error ? err.message : 'Cupom inválido.',
        });
      })
      .finally(() => {
        if (active) setCheckingCoupon(false);
      });

    return () => {
      active = false;
    };
  }, [draft.couponCode, appliedCoupon, subtotal, token, onApplyCouponState]);

  // Automatic shipping estimation whenever CEP, GPS coords, delivery method, or subtotal changes
  useEffect(() => {
    let active = true;
    const cepDigits = draft.address.cep.replace(/\D/g, '');

    if (draft.deliveryMethod === 'Retirada na loja') {
      setShippingEstimate({
        distanceKm: null,
        shippingFee: 0,
        shippingLabel: 'Grátis (Retirada)',
      });
      return;
    }

    if (settings.shippingMode === 'per_km' && cepDigits.length !== 8 && !draft.coords) {
      setShippingEstimate({
        distanceKm: null,
        shippingFee: null,
        shippingLabel: 'A confirmar',
      });
      return;
    }

    const freeShippingByCoupon = Boolean(
      appliedCoupon?.freeShipping || appliedCoupon?.discountType === 'free_shipping'
    );

    setCalculatingShipping(true);
    api
      .estimateShipping(token, {
        cep: draft.address.cep,
        subtotalAfterDiscount,
        deliveryMethod: draft.deliveryMethod,
        coords: draft.coords,
        freeShippingByCoupon,
      })
      .then((res) => {
        if (!active) return;
        setShippingEstimate(res);
        // Auto-fill street & neighborhood if returned from CEP and fields are empty
        if (res.addressHint && (res.addressHint.street || res.addressHint.neighborhood)) {
          onUpdateDraft((prev) => ({
            ...prev,
            address: {
              ...prev.address,
              street: prev.address.street || res.addressHint?.street || '',
              neighborhood: prev.address.neighborhood || res.addressHint?.neighborhood || '',
            },
          }));
        }
      })
      .catch(() => {
        if (!active) return;
        setShippingEstimate({
          distanceKm: null,
          shippingFee: null,
          shippingLabel: 'A confirmar',
        });
      })
      .finally(() => {
        if (active) setCalculatingShipping(false);
      });

    return () => {
      active = false;
    };
  }, [
    token,
    draft.deliveryMethod,
    draft.address.cep,
    draft.coords,
    subtotalAfterDiscount,
    appliedCoupon?.freeShipping,
    appliedCoupon?.discountType,
    settings.shippingMode,
    settings.shippingPerKm,
    settings.freeShippingKm,
    settings.shippingFee,
    settings.freeShippingThreshold,
  ]);

  const totalAmount = subtotalAfterDiscount + (shippingEstimate.shippingFee ?? 0);

  function handleUseMyLocation() {
    if (!navigator.geolocation) {
      setFormError('Seu navegador não suporta geolocalização. Informe o CEP para calcular o frete.');
      return;
    }
    setLocatingGps(true);
    setFormError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onUpdateDraft((prev) => ({
          ...prev,
          coords: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          },
        }));
        setLocatingGps(false);
      },
      () => {
        setLocatingGps(false);
        setFormError('Não foi possível acessar sua localização. Digite o CEP acima para calcular o frete.');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  async function handleApplyCoupon() {
    const code = draft.couponCode.trim().toUpperCase();
    if (!code) {
      setCouponMessage({ type: 'err', text: 'Digite o código do cupom.' });
      return;
    }
    setCheckingCoupon(true);
    setCouponMessage(null);
    try {
      const res = await api.validateCoupon(token, code, subtotal);
      if (res.valid && res.coupon) {
        onApplyCouponState(res.coupon, res.discountAmount || 0);
        setCouponMessage({ type: 'ok', text: res.message });
      }
    } catch (err) {
      onApplyCouponState(null, 0);
      setCouponMessage({
        type: 'err',
        text: err instanceof Error ? err.message : 'Cupom inválido.',
      });
    } finally {
      setCheckingCoupon(false);
    }
  }

  function handleRemoveCoupon() {
    onApplyCouponState(null, 0);
    onUpdateDraft((prev) => ({ ...prev, couponCode: '' }));
    setCouponMessage(null);
  }

  function validateForm(): string | null {
    if (!settings.storeOpen) {
      return settings.closedMessage || 'A loja está fechada no momento.';
    }
    if (items.length === 0) return 'Seu carrinho está vazio.';
    if (draft.fullName.trim().length < 3) return 'Informe seu nome completo.';
    const phoneDigits = draft.whatsapp.replace(/\D/g, '');
    if (phoneDigits.length < 10 || phoneDigits.length > 13) {
      return 'Informe um WhatsApp válido com DDD.';
    }
    if (draft.cpf.trim() && !isValidCpf(draft.cpf)) {
      return 'O CPF informado não é válido (ou deixe em branco, pois é opcional).';
    }
    if (draft.deliveryMethod === 'Entrega') {
      if (!draft.address.street.trim()) return 'Informe a rua para entrega.';
      if (!draft.address.number.trim()) return 'Informe o número para entrega.';
      if (!draft.address.neighborhood.trim()) return 'Informe o bairro para entrega.';
      if (draft.address.cep.replace(/\D/g, '').length < 8) return 'Informe um CEP válido (8 dígitos).';
    }
    if (!draft.paymentMethod) {
      return 'Selecione uma forma de pagamento.';
    }
    return null;
  }

  async function handleFinishOrder(e?: FormEvent) {
    if (e) e.preventDefault();
    setFormError('');

    const validationError = validateForm();
    if (validationError) {
      setFormError(validationError);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setSubmitting(true);
    try {
      const { order } = await api.createOrder(token, {
        customerName: draft.fullName.trim(),
        customerWhatsapp: draft.whatsapp.trim(),
        customerCpf: draft.cpf.trim(),
        deliveryMethod: draft.deliveryMethod,
        address: draft.deliveryMethod === 'Entrega' ? draft.address : null,
        coords: draft.deliveryMethod === 'Entrega' ? draft.coords : null,
        paymentMethod: draft.paymentMethod as PaymentMethod,
        changeFor: draft.paymentMethod === 'Dinheiro' ? draft.changeFor.trim() : '',
        couponCode: appliedCoupon ? appliedCoupon.code : '',
        notes: draft.notes.trim(),
        items,
      });
      onOrderCreated(order);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao finalizar pedido.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSubmitting(false);
    }
  }

  function renderPaymentIcon(method: PaymentMethod) {
    switch (method) {
      case 'PIX':
        return <QrCode className="w-5 h-5" />;
      case 'Cartão de crédito':
      case 'Cartão de débito':
        return <CreditCard className="w-5 h-5" />;
      case 'Dinheiro':
        return <Banknote className="w-5 h-5" />;
    }
  }

  return (
    <div className="max-w-4xl mx-auto pb-52 sm:pb-44">
      <div className="mb-6">
        <button
          type="button"
          onClick={onBackToCart}
          className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-[#9E9E9E] hover:text-white transition-colors mb-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar ao carrinho
        </button>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Finalizar Pedido</h1>
        <p className="text-sm text-[#9E9E9E] mt-1">
          Preencha seus dados, escolha entrega ou retirada e selecione a forma de pagamento.
        </p>
      </div>

      {!settings.storeOpen && (
        <div className="mb-6 p-4 rounded-2xl bg-red-950/60 border border-red-500/40 text-sm text-red-200 flex items-start gap-3">
          <Lock className="w-5 h-5 shrink-0 mt-0.5 text-red-400" />
          <div>
            <p className="font-bold text-white">Loja fechada no momento</p>
            <p className="mt-0.5">{settings.closedMessage}</p>
          </div>
        </div>
      )}

      {formError && (
        <div
          role="alert"
          className="mb-6 p-4 rounded-2xl bg-red-950/60 border border-red-500/40 text-sm text-red-200 flex items-start gap-3"
        >
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-400" />
          <span>{formError}</span>
        </div>
      )}

      <form id="checkout-form" onSubmit={handleFinishOrder} className="space-y-6">
        {/* 1. Dados do Cliente */}
        <section className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-5 sm:p-7 space-y-4">
          <h2 className="text-lg font-extrabold text-white">1. Dados do Cliente</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="chk-name" className="block text-xs font-semibold text-[#E5E5E5] mb-1.5">
                Nome completo *
              </label>
              <input
                id="chk-name"
                type="text"
                required
                value={draft.fullName}
                onChange={(e) => onUpdateDraft((prev) => ({ ...prev, fullName: e.target.value }))}
                placeholder="Digite seu nome completo"
                className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white placeholder-[#9E9E9E]/60 focus:outline-none focus:border-white transition-colors"
              />
            </div>

            <div>
              <label htmlFor="chk-whatsapp" className="block text-xs font-semibold text-[#E5E5E5] mb-1.5">
                WhatsApp com DDD *
              </label>
              <input
                id="chk-whatsapp"
                type="tel"
                required
                value={draft.whatsapp}
                onChange={(e) =>
                  onUpdateDraft((prev) => ({ ...prev, whatsapp: formatWhatsappInput(e.target.value) }))
                }
                placeholder="(11) 99999-9999"
                className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white placeholder-[#9E9E9E]/60 focus:outline-none focus:border-white transition-colors tabular-nums"
              />
            </div>

            <div>
              <label htmlFor="chk-cpf" className="block text-xs font-semibold text-[#E5E5E5] mb-1.5">
                CPF (opcional)
              </label>
              <input
                id="chk-cpf"
                type="text"
                inputMode="numeric"
                value={draft.cpf}
                onChange={(e) => onUpdateDraft((prev) => ({ ...prev, cpf: formatCpfInput(e.target.value) }))}
                placeholder="000.000.000-00"
                className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white placeholder-[#9E9E9E]/60 focus:outline-none focus:border-white transition-colors tabular-nums"
              />
            </div>
          </div>
        </section>

        {/* 2. Forma de Recebimento */}
        <section className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-5 sm:p-7 space-y-5">
          <h2 className="text-lg font-extrabold text-white">2. Forma de Recebimento</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => onUpdateDraft((prev) => ({ ...prev, deliveryMethod: 'Entrega' }))}
              className={`flex items-center gap-3.5 p-4 rounded-2xl border text-left transition-all ${
                draft.deliveryMethod === 'Entrega'
                  ? 'bg-white text-black border-white'
                  : 'bg-black text-white border-white/15 hover:border-white/40'
              }`}
            >
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  draft.deliveryMethod === 'Entrega' ? 'bg-black text-white' : 'bg-white/10 text-white'
                }`}
              >
                <Truck className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-bold">Entrega</p>
                <p
                  className={`text-xs ${
                    draft.deliveryMethod === 'Entrega' ? 'text-black/70' : 'text-[#9E9E9E]'
                  }`}
                >
                  {settings.shippingMode === 'per_km'
                    ? `Grátis até ${settings.freeShippingKm.toFixed(1).replace('.', ',')} km · ${formatBRL(settings.shippingPerKm)}/km`
                    : 'Receba no seu endereço'}
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onUpdateDraft((prev) => ({ ...prev, deliveryMethod: 'Retirada na loja' }))}
              className={`flex items-center gap-3.5 p-4 rounded-2xl border text-left transition-all ${
                draft.deliveryMethod === 'Retirada na loja'
                  ? 'bg-white text-black border-white'
                  : 'bg-black text-white border-white/15 hover:border-white/40'
              }`}
            >
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  draft.deliveryMethod === 'Retirada na loja' ? 'bg-black text-white' : 'bg-white/10 text-white'
                }`}
              >
                <Store className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-bold">Retirada na loja</p>
                <p
                  className={`text-xs ${
                    draft.deliveryMethod === 'Retirada na loja' ? 'text-black/70' : 'text-[#9E9E9E]'
                  }`}
                >
                  Sem taxa de frete
                </p>
              </div>
            </button>
          </div>

          {draft.deliveryMethod === 'Entrega' ? (
            <div className="space-y-4 pt-2">

              {settings.shippingMode === 'per_km' && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl bg-black border border-white/10 text-xs">
                  <div className="space-y-0.5">
                    <p className="font-semibold text-white">
                      Cálculo automático de frete por distância
                    </p>
                    <p className="text-[#9E9E9E]">
                      Até {settings.freeShippingKm.toFixed(1).replace('.', ',')} km:{' '}
                      <strong className="text-white">Grátis</strong> · Acima disso:{' '}
                      <strong className="text-white">{formatBRL(settings.shippingPerKm)} por km</strong>.
                      {shippingEstimate.distanceKm !== null && (
                        <span className="text-emerald-400 font-semibold ml-1.5 tabular-nums">
                          (Distância: {shippingEstimate.distanceKm.toFixed(1).replace('.', ',')} km)
                        </span>
                      )}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleUseMyLocation}
                    disabled={locatingGps}
                    className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-xl border border-white/20 text-white font-semibold hover:bg-white hover:text-black transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    {locatingGps ? 'Localizando...' : 'Usar localização GPS'}
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="sm:col-span-2">
                  <label htmlFor="chk-cep" className="block text-xs font-semibold text-[#E5E5E5] mb-1.5">
                    CEP *
                  </label>
                  <input
                    id="chk-cep"
                    type="text"
                    inputMode="numeric"
                    required
                    value={draft.address.cep}
                    onChange={(e) =>
                      onUpdateDraft((prev) => ({
                        ...prev,
                        address: { ...prev.address, cep: formatCepInput(e.target.value) },
                      }))
                    }
                    placeholder="00000-000"
                    className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white placeholder-[#9E9E9E]/60 focus:outline-none focus:border-white transition-colors tabular-nums"
                  />
                  {(lookingUpCep || cepStatus) && (
                    <p className="text-[11px] text-[#9E9E9E] mt-1">
                      {lookingUpCep ? 'Buscando rua e bairro pelo CEP...' : cepStatus}
                    </p>
                  )}
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="chk-neighborhood" className="block text-xs font-semibold text-[#E5E5E5] mb-1.5">
                    Bairro *
                  </label>
                  <input
                    id="chk-neighborhood"
                    type="text"
                    required
                    value={draft.address.neighborhood}
                    onChange={(e) =>
                      onUpdateDraft((prev) => ({
                        ...prev,
                        address: { ...prev.address, neighborhood: e.target.value },
                      }))
                    }
                    placeholder="Seu bairro"
                    className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white placeholder-[#9E9E9E]/60 focus:outline-none focus:border-white transition-colors"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label htmlFor="chk-street" className="block text-xs font-semibold text-[#E5E5E5] mb-1.5">
                    Rua *
                  </label>
                  <input
                    id="chk-street"
                    type="text"
                    required
                    value={draft.address.street}
                    onChange={(e) =>
                      onUpdateDraft((prev) => ({
                        ...prev,
                        address: { ...prev.address, street: e.target.value },
                      }))
                    }
                    placeholder="Nome da rua ou avenida"
                    className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white placeholder-[#9E9E9E]/60 focus:outline-none focus:border-white transition-colors"
                  />
                </div>

                <div>
                  <label htmlFor="chk-number" className="block text-xs font-semibold text-[#E5E5E5] mb-1.5">
                    Número *
                  </label>
                  <input
                    id="chk-number"
                    type="text"
                    required
                    value={draft.address.number}
                    onChange={(e) =>
                      onUpdateDraft((prev) => ({
                        ...prev,
                        address: { ...prev.address, number: e.target.value },
                      }))
                    }
                    placeholder="Ex: 120"
                    className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white placeholder-[#9E9E9E]/60 focus:outline-none focus:border-white transition-colors"
                  />
                </div>

                <div className="sm:col-span-4">
                  <label htmlFor="chk-complement" className="block text-xs font-semibold text-[#E5E5E5] mb-1.5">
                    Complemento (opcional)
                  </label>
                  <input
                    id="chk-complement"
                    type="text"
                    value={draft.address.complement}
                    onChange={(e) =>
                      onUpdateDraft((prev) => ({
                        ...prev,
                        address: { ...prev.address, complement: e.target.value },
                      }))
                    }
                    placeholder="Apartamento, bloco, ponto de referência..."
                    className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white placeholder-[#9E9E9E]/60 focus:outline-none focus:border-white transition-colors"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 sm:p-5 rounded-2xl bg-black border border-white/15 space-y-2.5">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <MapPin className="w-4 h-4 shrink-0" />
                <span>Informações para Retirada — {settings.storeName}</span>
              </div>
              <p className="text-sm text-[#E5E5E5]">{settings.storeAddress}</p>
              <p className="text-xs text-[#9E9E9E]">Horário: {settings.storeHours}</p>
              <p className="text-xs text-[#9E9E9E]">WhatsApp da loja: {settings.storeWhatsapp}</p>
              {settings.pickupInstructions && (
                <p className="text-xs text-[#E5E5E5] pt-1 border-t border-white/10">
                  {settings.pickupInstructions}
                </p>
              )}
            </div>
          )}
        </section>

        {/* Cupom de Desconto */}
        <section className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-5 sm:p-7 space-y-3">
          <h2 className="text-base font-extrabold text-white flex items-center gap-2">
            <Tag className="w-4 h-4" />
            Cupom de Desconto
          </h2>

          {appliedCoupon ? (
            <div className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-emerald-950/40 border border-emerald-500/30">
              <div className="text-xs sm:text-sm text-emerald-200">
                Cupom <strong className="font-bold">{appliedCoupon.code}</strong> aplicado ·{' '}
                {appliedCoupon.freeShipping || appliedCoupon.discountType === 'free_shipping' ? (
                  <strong>Frete Grátis</strong>
                ) : (
                  <>
                    Desconto de <strong className="tabular-nums">{formatBRL(discountAmount)}</strong>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={handleRemoveCoupon}
                aria-label="Remover cupom"
                className="p-1.5 rounded-lg text-emerald-200 hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                value={draft.couponCode}
                onChange={(e) =>
                  onUpdateDraft((prev) => ({ ...prev, couponCode: e.target.value.toUpperCase() }))
                }
                placeholder="Digite seu cupom (ex: RP10)"
                className="flex-1 h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white placeholder-[#9E9E9E]/60 focus:outline-none focus:border-white transition-colors uppercase"
              />
              <button
                type="button"
                onClick={handleApplyCoupon}
                disabled={checkingCoupon}
                className="h-11 px-5 rounded-xl border border-white/25 text-white font-bold text-sm hover:bg-white hover:text-black transition-colors whitespace-nowrap disabled:opacity-50"
              >
                {checkingCoupon ? 'Verificando...' : 'Aplicar cupom'}
              </button>
            </div>
          )}

          {couponMessage && (
            <p className={`text-xs ${couponMessage.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
              {couponMessage.text}
            </p>
          )}
        </section>

        {/* 3. Pagamento */}
        <section className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-5 sm:p-7 space-y-4">
          <h2 className="text-lg font-extrabold text-white">3. Forma de Pagamento</h2>
          <p className="text-xs text-[#9E9E9E]">Selecione apenas uma opção.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PAYMENT_OPTIONS.map((option) => {
              const selected = draft.paymentMethod === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onUpdateDraft((prev) => ({ ...prev, paymentMethod: option.value }))}
                  className={`flex items-center justify-between gap-3 p-4 rounded-2xl border text-left transition-all ${
                    selected
                      ? 'bg-white text-black border-white'
                      : 'bg-black text-white border-white/15 hover:border-white/40'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        selected ? 'bg-black text-white' : 'bg-white/10 text-white'
                      }`}
                    >
                      {renderPaymentIcon(option.value)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold">{option.label}</p>
                      <p className={`text-xs truncate ${selected ? 'text-black/70' : 'text-[#9E9E9E]'}`}>
                        {option.hint}
                      </p>
                    </div>
                  </div>

                  <div
                    className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                      selected ? 'bg-black border-black text-white' : 'border-white/30'
                    }`}
                  >
                    {selected && <Check className="w-3 h-3" />}
                  </div>
                </button>
              );
            })}
          </div>

          {draft.paymentMethod === 'Dinheiro' && (
            <div className="pt-2">
              <label htmlFor="chk-change" className="block text-xs font-semibold text-[#E5E5E5] mb-1.5">
                Troco para quanto? (opcional)
              </label>
              <input
                id="chk-change"
                type="text"
                value={draft.changeFor}
                onChange={(e) => onUpdateDraft((prev) => ({ ...prev, changeFor: e.target.value }))}
                placeholder="Ex: R$ 100,00 ou Não preciso de troco"
                className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-sm text-white placeholder-[#9E9E9E]/60 focus:outline-none focus:border-white transition-colors"
              />
            </div>
          )}

          <div className="pt-2">
            <label htmlFor="chk-notes" className="block text-xs font-semibold text-[#E5E5E5] mb-1.5">
              Observações do pedido (opcional)
            </label>
            <textarea
              id="chk-notes"
              rows={2}
              value={draft.notes}
              onChange={(e) => onUpdateDraft((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Alguma observação sobre o pedido ou entrega?"
              className="w-full p-3.5 rounded-xl bg-black border border-white/15 text-sm text-white placeholder-[#9E9E9E]/60 focus:outline-none focus:border-white transition-colors resize-none"
            />
          </div>
        </section>
      </form>

      {/* 4. Resumo do Pedido Fixo na Parte Inferior */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-[#0A0A0A]/95 backdrop-blur-md border-t border-white/15">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3.5 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="grid grid-cols-3 sm:flex sm:items-center gap-3 sm:gap-6 text-xs sm:text-sm">
            <div>
              <p className="text-[#9E9E9E]">Subtotal</p>
              <p className="font-bold text-white tabular-nums">{formatBRL(subtotal)}</p>
              {discountAmount > 0 && (
                <p className="text-[11px] text-emerald-400 tabular-nums">-{formatBRL(discountAmount)}</p>
              )}
            </div>

            <div>
              <p className="text-[#9E9E9E]">Frete</p>
              <p className="font-bold text-white tabular-nums">
                {calculatingShipping ? 'Calculando...' : shippingEstimate.shippingLabel}
              </p>
            </div>

            <div>
              <p className="text-[#9E9E9E]">Total</p>
              <p className="text-base sm:text-lg font-extrabold text-white tabular-nums">
                {formatBRL(totalAmount)}
                {shippingEstimate.shippingFee === null && (
                  <span className="text-[11px] font-medium text-[#9E9E9E] block sm:inline sm:ml-1">
                    (+ frete)
                  </span>
                )}
              </p>
            </div>
          </div>

          <button
            type="submit"
            form="checkout-form"
            disabled={submitting || items.length === 0 || !settings.storeOpen}
            className="w-full sm:w-auto h-12 px-8 rounded-xl bg-white text-black font-extrabold text-sm hover:bg-neutral-200 active:scale-[0.99] transition-all disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            {submitting ? 'ENVIANDO...' : !settings.storeOpen ? 'LOJA FECHADA' : 'FINALIZAR'}
          </button>
        </div>
      </div>
    </div>
  );
}
