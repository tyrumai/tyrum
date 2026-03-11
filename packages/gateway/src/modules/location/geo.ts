export const LOCATION_EXIT_HYSTERESIS_M = 50;
export const LOCATION_DWELL_MS = 10 * 60_000;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function haversineDistanceMeters(input: {
  latitudeA: number;
  longitudeA: number;
  latitudeB: number;
  longitudeB: number;
}): number {
  const earthRadiusM = 6_371_000;
  const dLat = toRadians(input.latitudeB - input.latitudeA);
  const dLon = toRadians(input.longitudeB - input.longitudeA);
  const latA = toRadians(input.latitudeA);
  const latB = toRadians(input.latitudeB);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusM * c;
}
