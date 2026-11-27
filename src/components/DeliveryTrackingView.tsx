import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  AlertTriangle,
  ArrowLeft,
  Bike,
  CheckCircle2,
  Clock,
  Crosshair,
  MapPin,
  Navigation,
  RefreshCw,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatDateTimeBR } from '../lib/format';
import {
  estimateFallbackDistanceAndEta,
  formatEtaSummary,
  formatLastUpdatedLabel,
  haversineMeters,
  isLocationStale,
  isOrderDelivered,
} from '../lib/tracking';
import type { Coordinates, DeliveryTrackingInfo } from '../types';

interface DeliveryTrackingViewProps {
  token: string | null;
  orderId: number;
  liveTrackingUpdate: DeliveryTrackingInfo | null;
  onBack: () => void;
}

interface RouteMetrics {
  distanceMeters: number | null;
  durationMillis: number | null;
  source: 'osrm' | 'estimate';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatClockTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function createStoreIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [90, 56],
    iconAnchor: [45, 20],
    html: `
      <div class="flex flex-col items-center pointer-events-none select-none">
        <div class="w-8 h-8 rounded-full bg-black border-2 border-white text-white flex items-center justify-center shadow-lg">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/><path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7"/></svg>
        </div>
        <span class="mt-1 px-2 py-0.5 rounded bg-black/90 border border-white/25 text-[10px] font-bold text-white whitespace-nowrap shadow">
          R&amp;P Loja
        </span>
      </div>
    `,
  });
}

function createDestinationIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [100, 68],
    iconAnchor: [50, 22],
    html: `
      <div class="flex flex-col items-center pointer-events-none select-none">
        <div class="w-10 h-10 rounded-full bg-white border-2 border-black text-black flex items-center justify-center shadow-xl">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
        </div>
        <span class="mt-1 px-2.5 py-0.5 rounded bg-white text-black border border-black text-[10px] font-extrabold whitespace-nowrap shadow">
          Seu destino
        </span>
      </div>
    `,
  });
}

function createCourierIcon(courierName: string, unavailable: boolean): L.DivIcon {
  const safeName = escapeHtml(courierName || 'Motoboy R&P');
  const bgClass = unavailable ? 'bg-amber-500' : 'bg-emerald-500';
  const pulseHtml = unavailable
    ? ''
    : '<span class="absolute w-12 h-12 rounded-full bg-emerald-400/40 animate-ping"></span>';
  return L.divIcon({
    className: '',
    iconSize: [130, 72],
    iconAnchor: [65, 24],
    html: `
      <div class="flex flex-col items-center pointer-events-none select-none">
        <div class="relative flex items-center justify-center">
          ${pulseHtml}
          <div class="relative w-11 h-11 rounded-full border-2 border-black ${bgClass} text-black flex items-center justify-center shadow-2xl">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>
          </div>
        </div>
        <span class="mt-1 px-2.5 py-0.5 rounded bg-black text-white border border-emerald-400/70 text-[10px] font-extrabold whitespace-nowrap shadow">
          ${safeName}
        </span>
      </div>
    `,
  });
}

export function DeliveryTrackingView({
  token,
  orderId,
  liveTrackingUpdate,
  onBack,
}: DeliveryTrackingViewProps) {
  const [tracking, setTracking] = useState<DeliveryTrackingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [routeMetrics, setRouteMetrics] = useState<RouteMetrics>({
    distanceMeters: null,
    durationMillis: null,
    source: 'estimate',
  });
  const [fitTrigger, setFitTrigger] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const storeMarkerRef = useRef<L.Marker | null>(null);
  const destMarkerRef = useRef<L.Marker | null>(null);
  const courierMarkerRef = useRef<L.Marker | null>(null);
  const routeCasingRef = useRef<L.Polyline | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const fittedPhaseRef = useRef<'none' | 'initial' | 'with_courier'>('none');
  const lastRouteRequestRef = useRef<{
    origin: Coordinates;
    dest: Coordinates;
    atMs: number;
  } | null>(null);

  const fetchTracking = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await api.getOrderTracking(token, orderId);
        setTracking(res.tracking);
        setError('');
      } catch (err) {
        if (!silent) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar rastreamento.');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [token, orderId]
  );

  useEffect(() => {
    void fetchTracking(false);
  }, [fetchTracking]);

  // Apply real-time SSE updates pushed from App.tsx
  useEffect(() => {
    if (liveTrackingUpdate && liveTrackingUpdate.orderId === orderId) {
      setTracking(liveTrackingUpdate);
      setNowMs(Date.now());
    }
  }, [liveTrackingUpdate, orderId]);

  // Fallback sync every 5 seconds while order is active
  useEffect(() => {
    if (!tracking || isOrderDelivered(tracking.status)) return;
    const syncTimer = window.setInterval(() => {
      void fetchTracking(true);
    }, 5000);
    return () => window.clearInterval(syncTimer);
  }, [tracking, fetchTracking]);

  // Tick every second for relative timestamp ("Atualizado há X s")
  useEffect(() => {
    const tick = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(tick);
  }, []);

  // Always compute fallback ETA/distance if courier & dest coords exist
  const effectiveMetrics = useMemo(() => {
    if (!tracking?.destCoords) return routeMetrics;
    if (routeMetrics.distanceMeters !== null && routeMetrics.durationMillis !== null) {
      return routeMetrics;
    }
    const origin = tracking.courierCoords ?? tracking.storeCoords;
    const est = estimateFallbackDistanceAndEta(origin, tracking.destCoords);
    return {
      distanceMeters: est.distanceMeters,
      durationMillis: est.durationMillis,
      source: 'estimate' as const,
    };
  }, [tracking, routeMetrics]);

  const etaSummary = useMemo(
    () => formatEtaSummary(effectiveMetrics.durationMillis, effectiveMetrics.distanceMeters, nowMs),
    [effectiveMetrics, nowMs]
  );

  const delivered = tracking ? isOrderDelivered(tracking.status) : false;
  const gpsUnavailable =
    Boolean(tracking) &&
    !delivered &&
    (tracking!.courierGpsStatus === 'unavailable' ||
      (tracking!.courierGpsStatus === 'active' && isLocationStale(tracking!.lastLocationAt, nowMs)));

  const waitingForCourierGps =
    Boolean(tracking) &&
    !delivered &&
    !tracking!.courierCoords &&
    tracking!.courierGpsStatus === 'waiting';

  const defaultMapCenter = useMemo<Coordinates>(() => {
    if (tracking?.courierCoords) return tracking.courierCoords;
    if (tracking?.destCoords) return tracking.destCoords;
    if (tracking?.storeCoords) return tracking.storeCoords;
    return { lat: -23.55052, lng: -46.633308 };
  }, [tracking]);

  // Initialize Leaflet + OpenStreetMap map once when active
  useEffect(() => {
    if (delivered || !tracking) return;
    const container = mapContainerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, {
      center: [defaultMapCenter.lat, defaultMapCenter.lng],
      zoom: 14,
      zoomControl: true,
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;
    fittedPhaseRef.current = 'none';

    return () => {
      map.remove();
      mapRef.current = null;
      storeMarkerRef.current = null;
      destMarkerRef.current = null;
      courierMarkerRef.current = null;
      routeCasingRef.current = null;
      routeLineRef.current = null;
      fittedPhaseRef.current = 'none';
      lastRouteRequestRef.current = null;
    };
  }, [delivered, Boolean(tracking)]);

  // Update markers & fitBounds smoothly without reloading the map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !tracking || delivered) return;

    // Store marker
    const storeLatLng: L.LatLngExpression = [tracking.storeCoords.lat, tracking.storeCoords.lng];
    if (!storeMarkerRef.current) {
      storeMarkerRef.current = L.marker(storeLatLng, {
        icon: createStoreIcon(),
        zIndexOffset: 100,
      }).addTo(map);
    } else {
      storeMarkerRef.current.setLatLng(storeLatLng);
    }

    // Destination marker
    if (tracking.destCoords) {
      const destLatLng: L.LatLngExpression = [tracking.destCoords.lat, tracking.destCoords.lng];
      if (!destMarkerRef.current) {
        destMarkerRef.current = L.marker(destLatLng, {
          icon: createDestinationIcon(),
          zIndexOffset: 200,
        }).addTo(map);
      } else {
        destMarkerRef.current.setLatLng(destLatLng);
      }
    } else if (destMarkerRef.current) {
      destMarkerRef.current.remove();
      destMarkerRef.current = null;
    }

    // Courier live marker
    if (tracking.courierCoords) {
      const courierLatLng: L.LatLngExpression = [tracking.courierCoords.lat, tracking.courierCoords.lng];
      const icon = createCourierIcon(tracking.assignedCourierName || 'Motoboy R&P', gpsUnavailable);
      if (!courierMarkerRef.current) {
        courierMarkerRef.current = L.marker(courierLatLng, {
          icon,
          zIndexOffset: 500,
        }).addTo(map);
      } else {
        courierMarkerRef.current.setLatLng(courierLatLng);
        courierMarkerRef.current.setIcon(icon);
      }
    } else if (courierMarkerRef.current) {
      courierMarkerRef.current.remove();
      courierMarkerRef.current = null;
    }

    // Fit map bounds initially, when courier first appears, or when "Centralizar rota" is pressed
    const hasCourier = Boolean(tracking.courierCoords);
    const neededPhase = hasCourier ? 'with_courier' : 'initial';
    if (
      fitTrigger === 0 &&
      (fittedPhaseRef.current === neededPhase ||
        (fittedPhaseRef.current === 'with_courier' && hasCourier))
    ) {
      return;
    }

    const points: L.LatLngExpression[] = [];
    if (tracking.courierCoords) {
      points.push([tracking.courierCoords.lat, tracking.courierCoords.lng]);
    } else {
      points.push([tracking.storeCoords.lat, tracking.storeCoords.lng]);
    }
    if (tracking.destCoords) {
      points.push([tracking.destCoords.lat, tracking.destCoords.lng]);
    }

    if (points.length === 1) {
      map.setView(points[0], 15, { animate: true });
    } else if (points.length >= 2) {
      map.fitBounds(L.latLngBounds(points), {
        padding: [56, 56],
        maxZoom: 16,
        animate: true,
      });
    }
    fittedPhaseRef.current = neededPhase;
  }, [tracking, delivered, gpsUnavailable, fitTrigger]);

  // Compute street route polyline + ETA via free OSRM public router (with Haversine fallback)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !tracking || delivered || !tracking.destCoords) return;

    const originCoords = tracking.courierCoords ?? tracking.storeCoords;
    const destCoords = tracking.destCoords;

    const clearRouteLayers = () => {
      if (routeCasingRef.current) {
        routeCasingRef.current.remove();
        routeCasingRef.current = null;
      }
      if (routeLineRef.current) {
        routeLineRef.current.remove();
        routeLineRef.current = null;
      }
    };

    const drawPolylines = (latLngs: L.LatLngExpression[], dashed: boolean) => {
      clearRouteLayers();
      routeCasingRef.current = L.polyline(latLngs, {
        color: '#ffffff',
        weight: 8,
        opacity: 0.85,
        dashArray: dashed ? '8 8' : undefined,
      }).addTo(map);
      routeLineRef.current = L.polyline(latLngs, {
        color: '#111111',
        weight: 5,
        opacity: 0.95,
        dashArray: dashed ? '8 8' : undefined,
      }).addTo(map);
    };

    const applyFallbackRoute = () => {
      drawPolylines(
        [
          [originCoords.lat, originCoords.lng],
          [destCoords.lat, destCoords.lng],
        ],
        true
      );
      const est = estimateFallbackDistanceAndEta(originCoords, destCoords);
      setRouteMetrics({
        distanceMeters: est.distanceMeters,
        durationMillis: est.durationMillis,
        source: 'estimate',
      });
    };

    const currentMs = Date.now();
    const prev = lastRouteRequestRef.current;
    const movedEnough =
      !prev ||
      haversineMeters(prev.origin, originCoords) >= 35 ||
      haversineMeters(prev.dest, destCoords) >= 20;
    const elapsedEnough = !prev || currentMs - prev.atMs >= 10_000;

    if (!movedEnough && !elapsedEnough && routeLineRef.current) {
      return;
    }

    lastRouteRequestRef.current = {
      origin: originCoords,
      dest: destCoords,
      atMs: currentMs,
    };

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 5000);
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${originCoords.lng},${originCoords.lat};${destCoords.lng},${destCoords.lat}?overview=full&geometries=geojson`;

    fetch(osrmUrl, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('OSRM HTTP error');
        return (await res.json()) as {
          code?: string;
          routes?: Array<{
            distance?: number;
            duration?: number;
            geometry?: { coordinates?: Array<[number, number]> };
          }>;
        };
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        const primaryRoute = data.routes?.[0];
        const coords = primaryRoute?.geometry?.coordinates;
        if (data.code !== 'Ok' || !primaryRoute || !coords || coords.length < 2) {
          applyFallbackRoute();
          return;
        }

        const latLngs: L.LatLngExpression[] = coords.map(([lng, lat]) => [lat, lng]);
        drawPolylines(latLngs, false);

        const fallback = estimateFallbackDistanceAndEta(originCoords, destCoords);
        setRouteMetrics({
          distanceMeters:
            typeof primaryRoute.distance === 'number'
              ? Math.round(primaryRoute.distance)
              : fallback.distanceMeters,
          durationMillis:
            typeof primaryRoute.duration === 'number'
              ? Math.round(primaryRoute.duration * 1000)
              : fallback.durationMillis,
          source: 'osrm',
        });
      })
      .catch(() => {
        if (controller.signal.aborted && !mapRef.current) return;
        applyFallbackRoute();
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
      });

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [tracking, delivered]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto rounded-3xl border border-white/12 bg-[#0C0C0C] p-12 text-center text-sm text-[#9E9E9E]">
        Carregando rastreamento da entrega em tempo real...
      </div>
    );
  }

  if (error || !tracking) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-white/15 text-xs sm:text-sm font-semibold text-white hover:bg-white hover:text-black transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar
        </button>
        <div
          role="alert"
          className="rounded-3xl border border-red-500/40 bg-red-950/30 p-8 text-center space-y-2"
        >
          <p className="text-base font-bold text-white">Rastreamento indisponível</p>
          <p className="text-sm text-red-200">{error || 'Não foi possível carregar este pedido.'}</p>
        </div>
      </div>
    );
  }

  const lastUpdateClock = formatClockTime(tracking.lastLocationAt);
  const lastUpdateRelative = formatLastUpdatedLabel(tracking.lastLocationAt, nowMs);

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-white/15 text-xs sm:text-sm font-semibold text-white hover:bg-white hover:text-black transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight tabular-nums">
              Acompanhar Entrega · Pedido #{tracking.orderNumber}
            </h1>
            <p className="text-xs text-[#9E9E9E]">
              Atualização automática em tempo real · R&amp;P Tabacaria
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border ${
              delivered
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-white text-black border-white'
            }`}
          >
            {delivered ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Bike className="w-3.5 h-3.5" />}
            {tracking.status}
          </span>
          <button
            type="button"
            onClick={() => void fetchTracking(true)}
            aria-label="Sincronizar localização agora"
            className="h-9 w-9 rounded-xl border border-white/15 text-[#9E9E9E] hover:text-white hover:border-white/40 flex items-center justify-center transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Delivery Finished Banner */}
      {delivered && (
        <div className="rounded-3xl border border-emerald-500/35 bg-emerald-950/25 p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <CheckCircle2 className="w-7 h-7 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-lg font-extrabold text-white">Entrega concluída!</h2>
              <p className="text-sm text-[#E5E5E5] mt-1">
                Este pedido foi marcado como <strong>{tracking.status}</strong>
                {tracking.deliveredAt ? ` em ${formatDateTimeBR(tracking.deliveredAt)}` : ''}. O rastreamento em
                tempo real foi encerrado.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="h-11 px-5 rounded-xl bg-white text-black font-bold text-xs sm:text-sm hover:bg-neutral-200 whitespace-nowrap shrink-0"
          >
            Voltar para Minha Conta
          </button>
        </div>
      )}

      {/* GPS Unavailable / No Signal Alert */}
      {gpsUnavailable && (
        <div
          role="alert"
          className="rounded-2xl border border-amber-500/45 bg-amber-950/35 p-4 flex items-start gap-3 text-xs sm:text-sm text-amber-100"
        >
          <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-white">Localização temporariamente indisponível</p>
            <p className="mt-0.5 text-amber-200/90">
              O GPS do motoboy está desligado, pausado ou momentaneamente sem sinal. Assim que a conexão for
              restabelecida, o marcador será atualizado automaticamente no mapa.
            </p>
          </div>
        </div>
      )}

      {/* Waiting for Courier to Start GPS */}
      {waitingForCourierGps && !gpsUnavailable && (
        <div className="rounded-2xl border border-white/15 bg-[#111111] p-4 flex items-start gap-3 text-xs sm:text-sm text-[#E5E5E5]">
          <Navigation className="w-5 h-5 text-white shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-white">Aguardando ativação do GPS do motoboy</p>
            <p className="mt-0.5 text-[#9E9E9E]">
              Seu pedido já saiu para entrega. Assim que o entregador iniciar o compartilhamento de localização,
              você verá o deslocamento dele em tempo real até o endereço abaixo.
            </p>
          </div>
        </div>
      )}

      {/* Live Map Section (OpenStreetMap + Leaflet) */}
      {!delivered && (
        <div className="rounded-3xl border border-white/15 bg-[#0C0C0C] overflow-hidden">
          <div className="px-4 sm:px-5 py-3 border-b border-white/10 flex flex-wrap items-center justify-between gap-2 bg-black">
            <div className="flex items-center gap-4 text-xs text-[#9E9E9E]">
              <span className="inline-flex items-center gap-1.5 text-white font-semibold">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    tracking.courierCoords && !gpsUnavailable
                      ? 'bg-emerald-400 animate-pulse'
                      : 'bg-neutral-500'
                  }`}
                />
                {tracking.courierCoords && !gpsUnavailable
                  ? 'Motoboy em movimento'
                  : 'Última posição / Destino'}
              </span>
              {tracking.courierSpeed !== null && tracking.courierSpeed > 0.5 && (
                <span className="tabular-nums hidden sm:inline">
                  Velocidade: {Math.round(tracking.courierSpeed * 3.6)} km/h
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => setFitTrigger((v) => v + 1)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-white/15 text-xs font-semibold text-white hover:bg-white hover:text-black transition-colors"
            >
              <Crosshair className="w-3.5 h-3.5" />
              Centralizar rota
            </button>
          </div>

          <div
            ref={mapContainerRef}
            aria-label="Mapa de rastreamento da entrega em tempo real"
            className="w-full h-[380px] sm:h-[480px] relative bg-[#080808] z-0"
          />
        </div>
      )}

      {/* Telemetry & Destination Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* ETA Card */}
        <div className="rounded-2xl border border-white/12 bg-[#0C0C0C] p-5 space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-[#9E9E9E]">
            <Navigation className="w-4 h-4 text-white" />
            <span>Previsão de chegada</span>
          </div>
          <p className="text-lg font-extrabold text-white tabular-nums">
            {delivered
              ? 'Entregue'
              : tracking.courierCoords
                ? etaSummary.etaText
                : tracking.destCoords
                  ? `Estimativa da loja: ${etaSummary.etaText}`
                  : 'Calculando rota...'}
          </p>
          <p className="text-xs text-[#9E9E9E] tabular-nums">
            {delivered
              ? 'Entrega finalizada'
              : [etaSummary.arrivalTimeText, etaSummary.distanceText ? `Distância: ${etaSummary.distanceText}` : null]
                  .filter(Boolean)
                  .join(' · ') || 'Aguardando coordenadas'}
          </p>
        </div>

        {/* Last Update Card */}
        <div className="rounded-2xl border border-white/12 bg-[#0C0C0C] p-5 space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-[#9E9E9E]">
            <Clock className="w-4 h-4 text-white" />
            <span>Última atualização</span>
          </div>
          <p className="text-lg font-extrabold text-white tabular-nums">
            {gpsUnavailable ? 'Sinal indisponível' : lastUpdateRelative}
          </p>
          <p className="text-xs text-[#9E9E9E] tabular-nums">
            {lastUpdateClock
              ? `Registro mais recente às ${lastUpdateClock}`
              : 'Nenhum sinal recebido ainda'}
          </p>
        </div>

        {/* Courier & Destination Address Card */}
        <div className="rounded-2xl border border-white/12 bg-[#0C0C0C] p-5 space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-[#9E9E9E]">
            <MapPin className="w-4 h-4 text-white" />
            <span>Destino · {tracking.assignedCourierName || 'Motoboy R&P'}</span>
          </div>
          {tracking.address ? (
            <>
              <p className="text-sm font-bold text-white leading-snug">
                {tracking.address.street}, {tracking.address.number} — {tracking.address.neighborhood}
              </p>
              <p className="text-xs text-[#9E9E9E] tabular-nums">
                CEP {tracking.address.cep}
                {tracking.address.complement ? ` · ${tracking.address.complement}` : ''}
              </p>
            </>
          ) : (
            <p className="text-sm text-[#9E9E9E]">Endereço não informado</p>
          )}
        </div>
      </div>
    </div>
  );
}
