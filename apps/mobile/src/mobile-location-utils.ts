import { haversineDistanceMeters, type LocationCoords } from "@tyrum/schemas";

type NativeLocationCoordsInput = {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null | undefined;
  heading: number | null;
  speed: number | null;
};

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

export function calculateDistanceMeters(
  from: Pick<LocationCoords, "latitude" | "longitude">,
  to: Pick<LocationCoords, "latitude" | "longitude">,
): number {
  return haversineDistanceMeters({
    latitudeA: from.latitude,
    longitudeA: from.longitude,
    latitudeB: to.latitude,
    longitudeB: to.longitude,
  });
}
