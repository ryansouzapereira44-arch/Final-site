import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateFallbackDistanceAndEta,
  formatEtaSummary,
  formatLastUpdatedLabel,
  haversineMeters,
  isLocationStale,
  isOrderDelivered,
  isTrackingAvailableForOrder,
  validateGpsCoordinates,
} from './tracking';

test('isTrackingAvailableForOrder enables tracking only when delivery is Saiu para entrega', () => {
  assert.equal(
    isTrackingAvailableForOrder({ deliveryMethod: 'Entrega', status: 'Saiu para entrega' }),
    true
  );
  assert.equal(
    isTrackingAvailableForOrder({ deliveryMethod: 'Entrega', status: 'Em preparo' }),
    false
  );
  assert.equal(
    isTrackingAvailableForOrder({ deliveryMethod: 'Entrega', status: 'Entregue' }),
    false
  );
  assert.equal(
    isTrackingAvailableForOrder({ deliveryMethod: 'Retirada na loja', status: 'Saiu para entrega' }),
    false
  );
});

test('isOrderDelivered recognizes Entregue and Concluído', () => {
  assert.equal(isOrderDelivered('Entregue'), true);
  assert.equal(isOrderDelivered('Concluído'), true);
  assert.equal(isOrderDelivered('Saiu para entrega'), false);
});

test('validateGpsCoordinates rejects invalid or zero coordinates and accepts valid coords', () => {
  assert.deepEqual(validateGpsCoordinates(-23.55052, -46.633308), {
    lat: -23.55052,
    lng: -46.633308,
  });
  assert.equal(validateGpsCoordinates(0, 0), null);
  assert.equal(validateGpsCoordinates(95, -46.6), null);
  assert.equal(validateGpsCoordinates(-23.5, 200), null);
  assert.equal(validateGpsCoordinates('abc', -46.6), null);
});

test('isLocationStale and formatLastUpdatedLabel reflect elapsed time accurately', () => {
  const now = new Date('2026-11-27T18:00:00.000Z').getTime();
  assert.equal(isLocationStale(null, now), true);
  assert.equal(isLocationStale('2026-11-27T17:59:50.000Z', now), false);
  assert.equal(isLocationStale('2026-11-27T17:59:00.000Z', now), true);

  assert.equal(formatLastUpdatedLabel(null, now), 'Aguardando sinal de GPS');
  assert.equal(formatLastUpdatedLabel('2026-11-27T17:59:58.000Z', now), 'Atualizado agora mesmo');
  assert.equal(formatLastUpdatedLabel('2026-11-27T17:59:45.000Z', now), 'Atualizado há 15s');
  assert.equal(formatLastUpdatedLabel('2026-11-27T17:57:00.000Z', now), 'Atualizado há 3 min');
});

test('haversineMeters, fallback ETA, and formatEtaSummary compute consistent values', () => {
  const a = { lat: -23.55052, lng: -46.633308 };
  const b = { lat: -23.561414, lng: -46.655881 };
  const dist = haversineMeters(a, b);
  assert.ok(dist > 2000 && dist < 3500);

  const fallback = estimateFallbackDistanceAndEta(a, b);
  assert.ok(fallback.distanceMeters > dist);
  assert.ok(fallback.durationMillis >= 60_000);

  const eta = formatEtaSummary(10 * 60_000, 2400, new Date(2026, 10, 27, 15, 0, 0).getTime());
  assert.equal(eta.etaText, 'Chega em ~10 min');
  assert.equal(eta.arrivalTimeText, 'Previsão ~15:10');
  assert.equal(eta.distanceText, '2,4 km');
});
