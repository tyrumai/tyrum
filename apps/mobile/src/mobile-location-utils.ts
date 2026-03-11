import type { LocationCoords } from "@tyrum/schemas";

type NativeLocationCoordsInput = {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null | undefined;
  heading: number | null;
  speed: number | null;
};

const EARTH_RADIUS_M = 6_371_000;

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function mapLocationCoords(coords: NativeLocationCoordsInput): LocationCoords {
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy_m: coords.accuracy,
    altitude_m: coords.altitude,
    altitude_accuracy_m: coords.altitudeAccuracy,
    heading_deg: coords.heading,
    speed_mps: coords.speed,
  };
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function calculateDistanceMeters(
  from: Pick<LocationCoords, "latitude" | "longitude">,
  to: Pick<LocationCoords, "latitude" | "longitude">,
): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}
