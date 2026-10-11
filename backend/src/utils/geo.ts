export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [lng, lat]
}

export const point = (lat: number, lng: number): GeoPoint => ({ type: 'Point', coordinates: [lng, lat] });

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Straight-line ETA. Good enough for a demo; a real system would call a routing engine. */
export const etaMinutes = (meters: number, kmh = 25): number => Math.max(1, Math.round(meters / 1000 / kmh * 60));
