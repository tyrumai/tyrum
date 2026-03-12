import { parsePersistedJson, type PersistedJsonObserver } from "../observability/persisted-json.js";
import type {
  LocationCoords,
  LocationEvent,
  LocationEventTransition,
  LocationPlace,
  LocationProfile,
} from "@tyrum/schemas";
import type {
  LocationAutomationTriggerRecord,
  LocationTriggerCondition,
  LocationTriggerExecution,
} from "./types.js";
import {
  LocationAutomationTriggerRecord as LocationAutomationTriggerRecordSchema,
  LocationTriggerCondition as LocationTriggerConditionSchema,
  LocationTriggerExecution as LocationTriggerExecutionSchema,
} from "./types.js";

export type RawProfileRow = {
  primary_node_id: string | null;
  stream_enabled: number | boolean;
  distance_filter_m: number;
  max_interval_ms: number;
  max_accuracy_m: number;
  background_enabled: number | boolean;
  poi_provider_kind: "none" | "osm_overpass";
  updated_at: string;
};

export type RawPlaceRow = {
  place_id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  tags_json: string;
  source: "manual" | "poi_provider";
  provider_place_id: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

export type RawStateRow = {
  subject_kind: "saved_place" | "poi_category";
  subject_ref: string;
  status: "inside" | "outside";
  entered_at: string | null;
  dwell_emitted_at: string | null;
};

export type RawTriggerRow = {
  trigger_id: string;
  agent_key: string;
  workspace_key: string;
  enabled: number | boolean;
  delivery_mode: "quiet" | "notify";
  trigger_type: "location";
  condition_json: string;
  execution_json: string;
  created_at: string;
  updated_at: string;
};

export type RawEventRow = {
  event_id: string;
  sample_id: string;
  node_id: string;
  event_type: LocationEvent["type"];
  transition: LocationEventTransition;
  place_id: string | null;
  place_name: string | null;
  provider_place_id: string | null;
  category_key: string | null;
  latitude: number;
  longitude: number;
  accuracy_m: number;
  altitude_m: number | null;
  altitude_accuracy_m: number | null;
  heading_deg: number | null;
  speed_mps: number | null;
  distance_m: number | null;
  metadata_json: string;
  occurred_at: string;
};

export function toBoolean(value: number | boolean): boolean {
  return value === true || value === 1;
}

export function parseStringArray(raw: string, observer: PersistedJsonObserver): string[] {
  return parsePersistedJson<string[]>({
    raw,
    fallback: [],
    table: "location_places",
    column: "tags_json",
    shape: "array",
    observer,
    validate: (value): value is string[] =>
      Array.isArray(value) && value.every((entry) => typeof entry === "string"),
  });
}

export function parseObject(
  raw: string,
  table: string,
  column: string,
  observer: PersistedJsonObserver,
) {
  return parsePersistedJson<Record<string, unknown>>({
    raw,
    fallback: {},
    table,
    column,
    shape: "object",
    observer,
  });
}

function toCoords(
  raw: Pick<
    RawEventRow,
    | "latitude"
    | "longitude"
    | "accuracy_m"
    | "altitude_m"
    | "altitude_accuracy_m"
    | "heading_deg"
    | "speed_mps"
  >,
): LocationCoords {
  return {
    latitude: raw.latitude,
    longitude: raw.longitude,
    accuracy_m: raw.accuracy_m,
    altitude_m: raw.altitude_m,
    altitude_accuracy_m: raw.altitude_accuracy_m,
    heading_deg: raw.heading_deg,
    speed_mps: raw.speed_mps,
  };
}

export function toLocationPlace(
  row: RawPlaceRow,
  agentKey: string,
  observer: PersistedJsonObserver,
): LocationPlace {
  return {
    place_id: row.place_id,
    agent_key: agentKey,
    name: row.name,
    point: { latitude: row.latitude, longitude: row.longitude },
    radius_m: row.radius_m,
    tags: parseStringArray(row.tags_json, observer),
    source: row.source,
    provider_place_id: row.provider_place_id,
    metadata: parseObject(row.metadata_json, "location_places", "metadata_json", observer),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toLocationProfile(row: RawProfileRow, agentKey: string): LocationProfile {
  return {
    agent_key: agentKey,
    primary_node_id: row.primary_node_id,
    stream_enabled: toBoolean(row.stream_enabled),
    distance_filter_m: row.distance_filter_m,
    max_interval_ms: row.max_interval_ms,
    max_accuracy_m: row.max_accuracy_m,
    background_enabled: toBoolean(row.background_enabled),
    poi_provider_kind: row.poi_provider_kind,
    updated_at: row.updated_at,
  };
}

export function parseLocationTriggerCondition(raw: string, observer: PersistedJsonObserver) {
  return parsePersistedJson<LocationTriggerCondition>({
    raw,
    fallback: { type: "poi_category", category_key: "invalid", transition: "enter" },
    table: "automation_triggers",
    column: "condition_json",
    shape: "object",
    observer,
    validate: (value): value is LocationTriggerCondition =>
      LocationTriggerConditionSchema.safeParse(value).success,
  });
}

export function parseLocationTriggerExecution(raw: string, observer: PersistedJsonObserver) {
  return parsePersistedJson<LocationTriggerExecution>({
    raw,
    fallback: { kind: "agent_turn" },
    table: "automation_triggers",
    column: "execution_json",
    shape: "object",
    observer,
    validate: (value): value is LocationTriggerExecution =>
      LocationTriggerExecutionSchema.safeParse(value).success,
  });
}

export function toLocationEvent(
  row: RawEventRow,
  agentKey: string,
  observer: PersistedJsonObserver,
): LocationEvent {
  return {
    event_id: row.event_id,
    agent_key: agentKey,
    node_id: row.node_id,
    sample_id: row.sample_id,
    type: row.event_type,
    transition: row.transition,
    occurred_at: row.occurred_at,
    place_id: row.place_id,
    place_name: row.place_name,
    provider_place_id: row.provider_place_id,
    category_key: row.category_key,
    distance_m: row.distance_m,
    coords: toCoords(row),
    metadata: parseObject(row.metadata_json, "location_events", "metadata_json", observer),
  };
}

export function toLocationAutomationTriggerRecord(
  row: RawTriggerRow,
  observer: PersistedJsonObserver,
): LocationAutomationTriggerRecord {
  return LocationAutomationTriggerRecordSchema.parse({
    trigger_id: row.trigger_id,
    agent_key: row.agent_key,
    workspace_key: row.workspace_key,
    enabled: toBoolean(row.enabled),
    delivery_mode: row.delivery_mode,
    trigger_type: row.trigger_type,
    condition: parseLocationTriggerCondition(row.condition_json, observer),
    execution: parseLocationTriggerExecution(row.execution_json, observer),
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}
