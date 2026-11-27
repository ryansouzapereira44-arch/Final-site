import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bike,
  CheckCircle2,
  MapPin,
  Navigation,
  Pause,
  Phone,
  Play,
  RefreshCw,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatBRL, formatDateTimeBR } from '../lib/format';
import { formatLastUpdatedLabel, isOrderDelivered } from '../lib/tracking';
import type { Order, User } from '../types';

interface CourierDeliveryViewProps {
  token: string | null;
  user: User;
  liveSyncTrigger: number;
}

interface GpsTelemetry {
  orderId: number;
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  sentAt: string;
}

export function CourierDeliveryView({
  token,
  user,
  liveSyncTrigger,
}: CourierDeliveryViewProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [gpsError, setGpsError] = useState('');

  const [activeSharingOrderId, setActiveSharingOrderId] = useState<number | null>(null);
  const [telemetry, setTelemetry] = useState<GpsTelemetry | null>(null);
  const [confirmDeliverOrderId, setConfirmDeliverOrderId] = useState<number | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const watchIdRef = useRef<number | null>(null);
  const intervalIdRef = useRef<number | null>(null);
  const lastSentAtMsRef = useRef<number>(0);

  const loadAssignedOrders = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await api.getCourierOrders(token);
        setOrders(res.orders);
        setError('');
      } catch (err) {
        if (!silent) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar suas entregas.');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [token]
  );

  const clearGpsWatchers = useCallback(() => {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (intervalIdRef.current !== null) {
      window.clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    void loadAssignedOrders(false);
  }, [loadAssignedOrders, liveSyncTrigger]);

  useEffect(() => {
    const tick = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      window.clearInterval(tick);
      clearGpsWatchers();
    };
  }, [clearGpsWatchers]);

  // Stop sharing automatically if the active order is no longer "Saiu para entrega"
  useEffect(() => {
    if (activeSharingOrderId === null) return;
    const target = orders.find((o) => o.id === activeSharingOrderId);
    if (!target || target.status !== 'Saiu para entrega') {
      clearGpsWatchers();
      setActiveSharingOrderId(null);
    }
  }, [orders, activeSharingOrderId, clearGpsWatchers]);

  const sendCoordinates = useCallback(
    async (orderId: number, position: GeolocationPosition, force = false) => {
      const now = Date.now();
      if (!force && now - lastSentAtMsRef.current < 3000) return;
      lastSentAtMsRef.current = now;

      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const accuracy = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null;
      const heading = Number.isFinite(position.coords.heading) ? position.coords.heading : null;
      const speed = Number.isFinite(position.coords.speed) ? position.coords.speed : null;

      try {
        const res = await api.sendCourierLocation(token, orderId, {
          lat,
          lng,
          accuracy,
          heading,
          speed,
        });
        setGpsError('');
        setTelemetry({
          orderId,
          lat,
          lng,
          accuracy,
          speed,
          sentAt: res.tracking.lastLocationAt || new Date().toISOString(),
        });
        setOrders((prev) =>
          prev.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  trackingActive: res.tracking.trackingActive,
                  courierGpsStatus: res.tracking.courierGpsStatus,
                  lastLocationAt: res.tracking.lastLocationAt,
                }
              : o
          )
        );
      } catch (err) {
        setGpsError(err instanceof Error ? err.message : 'Falha ao enviar localização.');
      }
    },
    [token]
  );

  const handleGeolocationError = useCallback(
    async (orderId: number, geoErr: GeolocationPositionError) => {
      let msg = 'Sinal de GPS indisponível no momento.';
      if (geoErr.code === 1) {
        msg =
          'Permissão de GPS negada. Habilite o acesso à localização no navegador ou dispositivo para compartilhar seu trajeto.';
      } else if (geoErr.code === 2) {
        msg = 'Localização indisponível. Verifique se o GPS do dispositivo está ligado.';
      } else if (geoErr.code === 3) {
        msg = 'Tempo limite atingido ao buscar sinal de GPS. Tentando novamente...';
      }
      setGpsError(msg);
      try {
        await api.sendCourierLocation(token, orderId, { gpsStatus: 'unavailable' });
      } catch {
        // ignore transient error
      }
    },
    [token]
  );

  async function handleStartSharing(order: Order) {
    setError('');
    setGpsError('');
    setFeedback('');

    if (!navigator.geolocation) {
      setGpsError('Este dispositivo ou navegador não possui suporte a geolocalização (GPS).');
      return;
    }

    clearGpsWatchers();
    setBusyOrderId(order.id);
    try {
      await api.startCourierTracking(token, order.id);
      setActiveSharingOrderId(order.id);
      setFeedback(`Compartilhamento iniciado para o Pedido #${order.orderNumber}.`);

      // Request immediate GPS fix (triggers browser permission prompt)
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          void sendCoordinates(order.id, pos, true);
        },
        (geoErr) => {
          void handleGeolocationError(order.id, geoErr);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );

      // Continuous position watch
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          void sendCoordinates(order.id, pos, false);
        },
        (geoErr) => {
          void handleGeolocationError(order.id, geoErr);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 3000 }
      );

      // Periodic 5-second heartbeat fallback while delivery is active
      intervalIdRef.current = window.setInterval(() => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            void sendCoordinates(order.id, pos, true);
          },
          (geoErr) => {
            void handleGeolocationError(order.id, geoErr);
          },
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 4000 }
        );
      }, 5000);

      await loadAssignedOrders(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível iniciar o compartilhamento.');
      clearGpsWatchers();
      setActiveSharingOrderId(null);
    } finally {
      setBusyOrderId(null);
    }
  }

  async function handleStopSharing(orderId: number, markDelivered: boolean) {
    setBusyOrderId(orderId);
    setError('');
    try {
      clearGpsWatchers();
      if (activeSharingOrderId === orderId) {
        setActiveSharingOrderId(null);
      }
      const res = await api.stopCourierTracking(token, orderId, markDelivered);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? res.order : o)));
      setConfirmDeliverOrderId(null);
      setFeedback(
        markDelivered
          ? `Pedido #${res.order.orderNumber} marcado como ENTREGUE e rastreamento encerrado.`
          : `Compartilhamento de localização pausado para o Pedido #${res.order.orderNumber}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao encerrar rastreamento.');
    } finally {
      setBusyOrderId(null);
    }
  }

  const activeDeliveries = orders.filter((o) => o.status === 'Saiu para entrega');
  const upcomingDeliveries = orders.filter(
    (o) => !isOrderDelivered(o.status) && o.status !== 'Saiu para entrega' && o.status !== 'Cancelado'
  );
  const completedDeliveries = orders.filter((o) => isOrderDelivered(o.status));

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.15em] text-[#9E9E9E]">ÁREA DO MOTOBOY</p>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mt-0.5">
            Olá, {user.name}
          </h1>
          <p className="text-sm text-[#9E9E9E] mt-1">
            Inicie o GPS apenas nas entregas atribuídas a você e finalize ao entregar ao cliente.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadAssignedOrders(false)}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-white/15 text-xs font-semibold text-white hover:bg-white hover:text-black transition-colors self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Atualizar entregas
        </button>
      </div>

      {feedback && (
        <div className="p-3.5 rounded-2xl bg-emerald-950/60 border border-emerald-500/40 text-xs sm:text-sm text-emerald-200">
          {feedback}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-2xl bg-red-950/60 border border-red-500/40 text-xs sm:text-sm text-red-200"
        >
          {error}
        </div>
      )}

      {gpsError && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-amber-950/45 border border-amber-500/45 text-xs sm:text-sm text-amber-100 flex items-start gap-3"
        >
          <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-white">Atenção com o sinal de GPS</p>
            <p className="mt-0.5">{gpsError}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-10 text-center text-sm text-[#9E9E9E]">
          Carregando entregas atribuídas...
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-3xl border border-white/12 bg-[#0C0C0C] p-12 text-center space-y-3">
          <Bike className="w-9 h-9 mx-auto text-[#9E9E9E]" />
          <p className="text-base font-bold text-white">Nenhuma entrega atribuída ainda</p>
          <p className="text-sm text-[#9E9E9E]">
            Quando o administrador atribuir um pedido a você, ele aparecerá automaticamente aqui.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* ACTIVE DELIVERIES */}
          {activeDeliveries.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-sm font-bold tracking-[0.12em] uppercase text-white">
                Em rota de entrega ({activeDeliveries.length})
              </h2>

              {activeDeliveries.map((order) => {
                const isSharingHere = activeSharingOrderId === order.id;
                const isBusy = busyOrderId === order.id;
                const showConfirm = confirmDeliverOrderId === order.id;
                const lastSentLabel =
                  telemetry && telemetry.orderId === order.id
                    ? formatLastUpdatedLabel(telemetry.sentAt, nowMs)
                    : formatLastUpdatedLabel(order.lastLocationAt, nowMs);

                return (
                  <article
                    key={order.id}
                    className="rounded-3xl border border-white/25 bg-[#0C0C0C] p-5 sm:p-6 space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10">
                      <div>
                        <h3 className="text-lg font-extrabold text-white tabular-nums">
                          Pedido #{order.orderNumber}
                        </h3>
                        <p className="text-xs text-[#9E9E9E] mt-0.5">
                          Cliente: <strong className="text-white">{order.customerName}</strong> ·{' '}
                          {order.paymentMethod}
                          {order.changeFor ? ` (Troco p/ ${order.changeFor})` : ''}
                        </p>
                      </div>

                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold ${
                          isSharingHere
                            ? 'bg-emerald-500 text-black'
                            : 'bg-white text-black'
                        }`}
                      >
                        <Bike className="w-3.5 h-3.5" />
                        {isSharingHere ? 'GPS Ativo (Compartilhando)' : order.status}
                      </span>
                    </div>

                    {order.address && (
                      <div className="rounded-2xl bg-black border border-white/10 p-4 space-y-1">
                        <div className="flex items-center gap-2 text-xs text-[#9E9E9E]">
                          <MapPin className="w-3.5 h-3.5 text-white" />
                          <span>Endereço de entrega</span>
                        </div>
                        <p className="text-sm sm:text-base font-bold text-white">
                          {order.address.street}, {order.address.number} — {order.address.neighborhood}
                        </p>
                        <p className="text-xs text-[#9E9E9E] tabular-nums">
                          CEP {order.address.cep}
                          {order.address.complement ? ` · ${order.address.complement}` : ''}
                        </p>
                        <div className="pt-1 flex items-center gap-2 text-xs text-[#E5E5E5] tabular-nums">
                          <Phone className="w-3.5 h-3.5 text-[#9E9E9E]" />
                          <span>WhatsApp: {order.customerWhatsapp}</span>
                        </div>
                      </div>
                    )}

                    {/* Live GPS telemetry readout when active */}
                    {isSharingHere && (
                      <div className="rounded-2xl bg-emerald-950/30 border border-emerald-500/35 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 text-emerald-200 font-semibold">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                          <span>{lastSentLabel}</span>
                        </div>
                        {telemetry && telemetry.orderId === order.id && (
                          <span className="text-emerald-200/90 tabular-nums">
                            {telemetry.lat.toFixed(5)}, {telemetry.lng.toFixed(5)}
                            {telemetry.accuracy !== null ? ` (±${Math.round(telemetry.accuracy)} m)` : ''}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Controls */}
                    <div className="space-y-3 pt-1">
                      <div className="flex flex-col sm:flex-row gap-3">
                        {!isSharingHere ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleStartSharing(order)}
                            className="flex-1 min-h-12 py-3 px-5 rounded-xl bg-white text-black font-extrabold text-sm inline-flex items-center justify-center gap-2 hover:bg-neutral-200 transition-colors disabled:opacity-50 text-center"
                          >
                            <Play className="w-4 h-4 shrink-0" />
                            <span>{isBusy ? 'Ativando GPS...' : 'Iniciar Compartilhamento de Localização'}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleStopSharing(order.id, false)}
                            className="flex-1 min-h-12 py-3 px-5 rounded-xl border border-white/25 bg-black text-white font-bold text-sm inline-flex items-center justify-center gap-2 hover:bg-white/10 transition-colors disabled:opacity-50 text-center"
                          >
                            <Pause className="w-4 h-4 shrink-0" />
                            <span>Pausar Localização</span>
                          </button>
                        )}

                        {!showConfirm ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setConfirmDeliverOrderId(order.id)}
                            className="min-h-12 py-3 px-5 rounded-xl bg-emerald-500 text-black font-extrabold text-sm inline-flex items-center justify-center gap-2 hover:bg-emerald-400 transition-colors disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                            <span>Encerrar / Marcar Entregue</span>
                          </button>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleStopSharing(order.id, true)}
                              className="min-h-12 py-3 px-4 rounded-xl bg-emerald-500 text-black font-extrabold text-xs sm:text-sm hover:bg-emerald-400 transition-colors"
                            >
                              Confirmar Entrega
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => setConfirmDeliverOrderId(null)}
                              className="min-h-12 py-3 px-4 rounded-xl border border-white/20 text-xs font-semibold text-[#9E9E9E] hover:text-white"
                            >
                              Cancelar
                            </button>
                          </div>
                        )}
                      </div>

                      <p className="text-[11px] text-[#9E9E9E] leading-relaxed">
                        Ao iniciar o compartilhamento, o GPS do seu dispositivo enviará sua posição automaticamente
                        apenas para o cliente deste pedido e para o painel da loja até você pausar ou concluir a
                        entrega.
                      </p>
                    </div>
                  </article>
                );
              })}
            </section>
          )}

          {/* UPCOMING ASSIGNED ORDERS */}
          {upcomingDeliveries.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold tracking-[0.12em] uppercase text-[#9E9E9E]">
                Aguardando liberação para entrega ({upcomingDeliveries.length})
              </h2>
              <div className="space-y-3">
                {upcomingDeliveries.map((order) => (
                  <div
                    key={order.id}
                    className="rounded-2xl border border-white/12 bg-[#0C0C0C] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <p className="text-base font-extrabold text-white tabular-nums">
                        Pedido #{order.orderNumber} · {order.customerName}
                      </p>
                      {order.address && (
                        <p className="text-xs text-[#9E9E9E] mt-0.5">
                          {order.address.street}, {order.address.number} — {order.address.neighborhood}
                        </p>
                      )}
                      <p className="text-xs text-[#9E9E9E] mt-1">
                        Total: <strong className="text-white">{formatBRL(order.total)}</strong> · Status atual:{' '}
                        <strong className="text-white">{order.status}</strong>
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/15 text-xs text-[#9E9E9E] self-start sm:self-auto">
                      <Navigation className="w-3.5 h-3.5" />
                      Aguardando &quot;Saiu para entrega&quot;
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* COMPLETED DELIVERIES */}
          {completedDeliveries.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold tracking-[0.12em] uppercase text-[#9E9E9E]">
                Entregas concluídas ({completedDeliveries.length})
              </h2>
              <div className="space-y-2.5">
                {completedDeliveries.map((order) => (
                  <div
                    key={order.id}
                    className="rounded-2xl border border-white/10 bg-[#0C0C0C] p-4 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm"
                  >
                    <div>
                      <p className="font-bold text-white tabular-nums">
                        Pedido #{order.orderNumber} · {order.customerName}
                      </p>
                      <p className="text-xs text-[#9E9E9E] mt-0.5">
                        {order.deliveredAt
                          ? `Entregue em ${formatDateTimeBR(order.deliveredAt)}`
                          : formatDateTimeBR(order.createdAt)}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 text-xs font-bold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {order.status}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
