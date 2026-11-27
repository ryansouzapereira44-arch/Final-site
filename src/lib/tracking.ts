import type { Coordinates, Order } from '../types';

export const GPS_STALE_THRESHOLD_MS = 45_000;

export function isTrackingAvailableForOrder(
  order: Pick<Order, 'deliveryMethod' | 'status'>
): boolean {
  return order.deliveryMethod === 'Entrega' && order.status === 'Saiu para entrega';
}

export function isOrderDelivered(status: Order['status']): boolean {
  return status === 'Entregue' || status === 'Concluído';
}

export function validateGpsCoordinates(lat: unknown, lng: unknown): Coordinates | null {
  const parsedLat = typeof lat === 'number' ? lat : Number(lat);
  const parsedLng = typeof lng === 'number' ? lng : Number(lng);
  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return null;
  if (parsedLat < -90 || parsedLat > 90) return null;
  if (parsedLng < -180 || parsedLng > 180) return null;
  if (parsedLat === 0 && parsedLng === 0) return null;
  return { lat: parsedLat, lng: parsedLng };
}

export function haversineMeters(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Math.round(R * c);
}

export function isLocationStale(
  lastLocationAt: string | null,
  nowMs = Date.now(),
  maxAgeMs = GPS_STALE_THRESHOLD_MS
): boolean {
  if (!lastLocationAt) return true;
  const parsed = new Date(lastLocationAt).getTime();
  if (!Number.isFinite(parsed)) return true;
  return nowMs - parsed > maxAgeMs;
}

export function formatLastUpdatedLabel(lastLocationAt: string | null, nowMs = Date.now()): string {
  if (!lastLocationAt) return 'Aguardando sinal de GPS';
  const parsed = new Date(lastLocationAt).getTime();
  if (!Number.isFinite(parsed)) return 'Aguardando sinal de GPS';

  const diffSec = Math.max(0, Math.floor((nowMs - parsed) / 1000));
  if (diffSec < 5) return 'Atualizado agora mesmo';
  if (diffSec < 60) return `Atualizado há ${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Atualizado há ${diffMin} min`;
  return `Atualizado há ${Math.floor(diffMin / 60)}h`;
}

export function estimateFallbackDistanceAndEta(
  from: Coordinates,
  to: Coordinates
): { distanceMeters: number; durationMillis: number } {
  const straightMeters = haversineMeters(from, to);
  const roadMeters = Math.round(straightMeters * 1.25);
  // 28 km/h (~7.78 m/s) realistic urban motorcycle average
  const durationSeconds = Math.max(60, Math.round(roadMeters / 7.78));
  return {
    distanceMeters: roadMeters,
    durationMillis: durationSeconds * 1000,
  };
}

export function formatEtaSummary(
  durationMillis: number | null,
  distanceMeters: number | null,
  nowMs = Date.now()
): { etaText: string; arrivalTimeText: string | null; distanceText: string | null } {
  const distanceText =
    distanceMeters !== null && Number.isFinite(distanceMeters)
      ? distanceMeters >= 1000
        ? `${(distanceMeters / 1000).toFixed(1).replace('.', ',')} km`
        : `${Math.max(50, Math.round(distanceMeters))} m`
      : null;

  if (durationMillis === null || !Number.isFinite(durationMillis) || durationMillis <= 0) {
    return {
      etaText: 'Calculando previsão...',
      arrivalTimeText: null,
      distanceText,
    };
  }

  const mins = Math.max(1, Math.round(durationMillis / 60_000));
  const etaText = mins === 1 ? 'Chega em ~1 min' : `Chega em ~${mins} min`;
  const arrivalDate = new Date(nowMs + durationMillis);
  const hh = String(arrivalDate.getHours()).padStart(2, '0');
  const mm = String(arrivalDate.getMinutes()).padStart(2, '0');
  return {
    etaText,
    arrivalTimeText: `Previsão ~${hh}:${mm}`,
    distanceText,
  };
}
