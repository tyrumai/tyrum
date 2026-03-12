import type { LocationCoords } from "@tyrum/schemas";
import { haversineDistanceMeters } from "./geo.js";

export interface PoiMatch {
  providerPlaceId: string;
  name: string;
  latitude: number;
  longitude: number;
  distanceM: number;
  categoryKey: string;
}

export interface PoiProvider {
  findNearestCategoryMatch(input: {
    coords: LocationCoords;
    categoryKey: string;
    radiusM: number;
  }): Promise<PoiMatch | null>;
}

const OSM_CATEGORY_TAGS: Record<string, readonly string[]> = {
  grocery: ['["shop"~"supermarket|grocery|convenience"]'],
  pharmacy: ['["amenity"="pharmacy"]', '["shop"="chemist"]'],
  gas_station: ['["amenity"="fuel"]'],
  cafe: ['["amenity"="cafe"]'],
  restaurant: ['["amenity"="restaurant"]'],
};

type OverpassResponse = {
  elements?: Array<{
    id?: number;
    lat?: number;
    lon?: number;
    center?: { lat?: number; lon?: number };
    tags?: Record<string, string>;
  }>;
};

export class NoopPoiProvider implements PoiProvider {
  async findNearestCategoryMatch(): Promise<PoiMatch | null> {
    return null;
  }
}

export class OsmOverpassPoiProvider implements PoiProvider {
  constructor(
    private readonly input: {
      fetchImpl?: typeof fetch;
      endpoint?: string;
    } = {},
  ) {}

  async findNearestCategoryMatch(input: {
    coords: LocationCoords;
    categoryKey: string;
    radiusM: number;
  }): Promise<PoiMatch | null> {
    const selectors = OSM_CATEGORY_TAGS[input.categoryKey];
    if (!selectors || selectors.length === 0) return null;

    const endpoint =
      this.input.endpoint?.trim() ||
      process.env["TYRUM_LOCATION_OSM_OVERPASS_URL"]?.trim() ||
      "https://overpass-api.de/api/interpreter";
    const fetchImpl = this.input.fetchImpl ?? fetch;
    const lat = input.coords.latitude;
    const lon = input.coords.longitude;
    const radius = Math.max(50, Math.min(500, Math.round(input.radiusM)));
    const query = [
      "[out:json][timeout:20];",
      "(",
      ...selectors.flatMap((selector) => [
        `node${selector}(around:${String(radius)},${String(lat)},${String(lon)});`,
        `way${selector}(around:${String(radius)},${String(lat)},${String(lon)});`,
        `relation${selector}(around:${String(radius)},${String(lat)},${String(lon)});`,
      ]),
      ");",
      "out center 20;",
    ].join("\n");

    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: query,
    });
    if (!response.ok) {
      throw new Error(`poi provider request failed with status ${String(response.status)}`);
    }
    const json = (await response.json()) as OverpassResponse;
    const elements = Array.isArray(json.elements) ? json.elements : [];
    let best: PoiMatch | null = null;

    for (const element of elements) {
      const point = element.center ?? { lat: element.lat, lon: element.lon };
      if (typeof point.lat !== "number" || typeof point.lon !== "number") continue;
      const distanceM = haversineDistanceMeters({
        latitudeA: lat,
        longitudeA: lon,
        latitudeB: point.lat,
        longitudeB: point.lon,
      });
      if (distanceM > radius) continue;
      const candidate: PoiMatch = {
        providerPlaceId: `osm:${String(element.id ?? `${point.lat}:${point.lon}`)}`,
        name: element.tags?.["name"]?.trim() || input.categoryKey,
        latitude: point.lat,
        longitude: point.lon,
        distanceM,
        categoryKey: input.categoryKey,
      };
      if (!best || candidate.distanceM < best.distanceM) {
        best = candidate;
      }
    }

    return best;
  }
}

export function createPoiProvider(kind: "none" | "osm_overpass"): PoiProvider {
  if (kind === "osm_overpass") {
    return new OsmOverpassPoiProvider();
  }
  return new NoopPoiProvider();
}
