import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "./common.js";
import { AgentKey, NodeId } from "./keys.js";

export const LocationPlaceId = UuidSchema;
export type LocationPlaceId = z.infer<typeof LocationPlaceId>;

export const LocationSampleId = UuidSchema;
export type LocationSampleId = z.infer<typeof LocationSampleId>;

export const LocationEventId = UuidSchema;
export type LocationEventId = z.infer<typeof LocationEventId>;

export const LocationTriggerId = UuidSchema;
export type LocationTriggerId = z.infer<typeof LocationTriggerId>;

export const LocationPoint = z
  .object({
    latitude: z.number().gte(-90).lte(90),
    longitude: z.number().gte(-180).lte(180),
  })
  .strict();
export type LocationPoint = z.infer<typeof LocationPoint>;

export const LocationCoords = LocationPoint.extend({
  accuracy_m: z.number().nonnegative(),
  altitude_m: z.number().nullable().optional(),
  altitude_accuracy_m: z.number().nonnegative().nullable().optional(),
  heading_deg: z.number().nullable().optional(),
  speed_mps: z.number().nullable().optional(),
}).strict();
export type LocationCoords = z.infer<typeof LocationCoords>;

export const LocationSampleSource = z.enum(["gps", "network", "passive", "unknown"]);
export type LocationSampleSource = z.infer<typeof LocationSampleSource>;

export const LocationPoiProviderKind = z.enum(["none", "osm_overpass"]);
export type LocationPoiProviderKind = z.infer<typeof LocationPoiProviderKind>;

export const LocationProfile = z
  .object({
    agent_key: AgentKey,
    primary_node_id: NodeId.nullable(),
    stream_enabled: z.boolean(),
    distance_filter_m: z.number().int().positive(),
    max_interval_ms: z.number().int().positive(),
    max_accuracy_m: z.number().int().positive(),
    background_enabled: z.boolean(),
    poi_provider_kind: LocationPoiProviderKind,
    updated_at: DateTimeSchema,
  })
  .strict();
export type LocationProfile = z.infer<typeof LocationProfile>;

export const LocationProfileUpdateRequest = z
  .object({
    agent_key: AgentKey.optional(),
    primary_node_id: NodeId.nullable().optional(),
    stream_enabled: z.boolean().optional(),
    distance_filter_m: z.number().int().positive().optional(),
    max_interval_ms: z.number().int().positive().optional(),
    max_accuracy_m: z.number().int().positive().optional(),
    background_enabled: z.boolean().optional(),
    poi_provider_kind: LocationPoiProviderKind.optional(),
  })
  .strict();
export type LocationProfileUpdateRequest = z.infer<typeof LocationProfileUpdateRequest>;

export const LocationPlaceSource = z.enum(["manual", "poi_provider"]);
export type LocationPlaceSource = z.infer<typeof LocationPlaceSource>;

export const LocationPlace = z
  .object({
    place_id: LocationPlaceId,
    agent_key: AgentKey,
    name: z.string().trim().min(1),
    point: LocationPoint,
    radius_m: z.number().int().positive(),
    tags: z.array(z.string().trim().min(1)).default([]),
    source: LocationPlaceSource,
    provider_place_id: z.string().trim().min(1).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
    created_at: DateTimeSchema,
    updated_at: DateTimeSchema,
  })
  .strict();
export type LocationPlace = z.infer<typeof LocationPlace>;

export const LocationPlaceCreateRequest = z
  .object({
    agent_key: AgentKey.optional(),
    name: z.string().trim().min(1),
    latitude: z.number().gte(-90).lte(90),
    longitude: z.number().gte(-180).lte(180),
    radius_m: z.number().int().positive().default(100),
    tags: z.array(z.string().trim().min(1)).default([]),
    source: LocationPlaceSource.default("manual"),
    provider_place_id: z.string().trim().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type LocationPlaceCreateRequest = z.infer<typeof LocationPlaceCreateRequest>;

export const LocationPlacePatchRequest = z
  .object({
    name: z.string().trim().min(1).optional(),
    latitude: z.number().gte(-90).lte(90).optional(),
    longitude: z.number().gte(-180).lte(180).optional(),
    radius_m: z.number().int().positive().optional(),
    tags: z.array(z.string().trim().min(1)).optional(),
    source: LocationPlaceSource.optional(),
    provider_place_id: z.string().trim().min(1).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type LocationPlacePatchRequest = z.infer<typeof LocationPlacePatchRequest>;

export const LocationSample = z
  .object({
    sample_id: LocationSampleId,
    agent_key: AgentKey,
    node_id: NodeId,
    recorded_at: DateTimeSchema,
    coords: LocationCoords,
    source: LocationSampleSource,
    is_background: z.boolean().default(false),
    accepted: z.boolean(),
  })
  .strict();
export type LocationSample = z.infer<typeof LocationSample>;

export const LocationBeacon = z
  .object({
    sample_id: LocationSampleId,
    agent_key: AgentKey.optional(),
    recorded_at: DateTimeSchema,
    coords: LocationCoords,
    source: LocationSampleSource.default("unknown"),
    is_background: z.boolean().default(false),
  })
  .strict();
export type LocationBeacon = z.infer<typeof LocationBeacon>;

export const LocationEventType = z.enum([
  "saved_place.enter",
  "saved_place.exit",
  "saved_place.dwell",
  "poi_category.enter",
  "poi_category.exit",
  "poi_category.dwell",
]);
export type LocationEventType = z.infer<typeof LocationEventType>;

export const LocationEventTransition = z.enum(["enter", "exit", "dwell"]);
export type LocationEventTransition = z.infer<typeof LocationEventTransition>;

export const LocationEvent = z
  .object({
    event_id: LocationEventId,
    agent_key: AgentKey,
    node_id: NodeId,
    sample_id: LocationSampleId,
    type: LocationEventType,
    transition: LocationEventTransition,
    occurred_at: DateTimeSchema,
    place_id: LocationPlaceId.nullable().optional(),
    place_name: z.string().trim().min(1).nullable().optional(),
    provider_place_id: z.string().trim().min(1).nullable().optional(),
    category_key: z.string().trim().min(1).nullable().optional(),
    distance_m: z.number().nonnegative().nullable().optional(),
    coords: LocationCoords,
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type LocationEvent = z.infer<typeof LocationEvent>;

export const LocationBeaconResult = z
  .object({
    sample: LocationSample,
    events: z.array(LocationEvent),
  })
  .strict();
export type LocationBeaconResult = z.infer<typeof LocationBeaconResult>;
