import type { SqlDb } from "../../statestore/types.js";
import {
  stringifyPersistedJson,
  type PersistedJsonObserver,
} from "../observability/persisted-json.js";
import { gatewayMetrics } from "../observability/metrics.js";
import { Logger } from "../observability/logger.js";
import type { LocationBeacon, LocationEvent, LocationPlace, LocationProfile } from "@tyrum/schemas";
import type {
  LocationAutomationTriggerCreateRequest,
  LocationAutomationTriggerPatchRequest,
  LocationAutomationTriggerRecord,
} from "./types.js";
import {
  type RawEventRow,
  type RawPlaceRow,
  type RawProfileRow,
  type RawStateRow,
  type RawTriggerRow,
  parseObject,
  parseLocationTriggerCondition,
  parseLocationTriggerExecution,
  parseStringArray,
  toBoolean,
  toLocationAutomationTriggerRecord,
  toLocationEvent,
  toLocationPlace,
  toLocationProfile,
} from "./dal-helpers.js";

const logger = new Logger({ base: { module: "location.dal" } });

export class LocationDal {
  private readonly observer: PersistedJsonObserver;

  constructor(private readonly db: SqlDb) {
    this.observer = { logger, metrics: gatewayMetrics };
  }

  async getProfile(input: {
    tenantId: string;
    agentId: string;
    agentKey: string;
  }): Promise<LocationProfile> {
    const row = await this.db.get<RawProfileRow>(
      `SELECT primary_node_id, stream_enabled, distance_filter_m, max_interval_ms, max_accuracy_m,
              background_enabled, poi_provider_kind, updated_at
         FROM location_profiles
        WHERE tenant_id = ? AND agent_id = ?`,
      [input.tenantId, input.agentId],
    );
    if (!row) {
      return {
        agent_key: input.agentKey,
        primary_node_id: null,
        stream_enabled: true,
        distance_filter_m: 100,
        max_interval_ms: 900_000,
        max_accuracy_m: 100,
        background_enabled: true,
        poi_provider_kind: "none",
        updated_at: new Date(0).toISOString(),
      };
    }
    return toLocationProfile(row, input.agentKey);
  }

  async upsertProfile(input: {
    tenantId: string;
    agentId: string;
    profile: Omit<LocationProfile, "agent_key" | "updated_at">;
  }): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      `INSERT INTO location_profiles (
         tenant_id, agent_id, primary_node_id, stream_enabled, distance_filter_m, max_interval_ms,
         max_accuracy_m, background_enabled, poi_provider_kind, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, agent_id) DO UPDATE SET
         primary_node_id = excluded.primary_node_id,
         stream_enabled = excluded.stream_enabled,
         distance_filter_m = excluded.distance_filter_m,
         max_interval_ms = excluded.max_interval_ms,
         max_accuracy_m = excluded.max_accuracy_m,
         background_enabled = excluded.background_enabled,
         poi_provider_kind = excluded.poi_provider_kind,
         updated_at = excluded.updated_at`,
      [
        input.tenantId,
        input.agentId,
        input.profile.primary_node_id,
        input.profile.stream_enabled ? 1 : 0,
        input.profile.distance_filter_m,
        input.profile.max_interval_ms,
        input.profile.max_accuracy_m,
        input.profile.background_enabled ? 1 : 0,
        input.profile.poi_provider_kind,
        nowIso,
        nowIso,
      ],
    );
  }

  async listPlaces(input: {
    tenantId: string;
    agentId: string;
    agentKey: string;
  }): Promise<LocationPlace[]> {
    const rows = await this.db.all<RawPlaceRow>(
      `SELECT place_id, name, latitude, longitude, radius_m, tags_json, source, provider_place_id,
              metadata_json, created_at, updated_at
         FROM location_places
        WHERE tenant_id = ? AND agent_id = ?
        ORDER BY updated_at DESC, name ASC`,
      [input.tenantId, input.agentId],
    );
    return rows.map((row) => toLocationPlace(row, input.agentKey, this.observer));
  }

  async createPlace(input: {
    tenantId: string;
    agentId: string;
    place: LocationPlace;
  }): Promise<void> {
    await this.db.run(
      `INSERT INTO location_places (
         tenant_id, agent_id, place_id, name, latitude, longitude, radius_m, tags_json, source,
         provider_place_id, metadata_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.tenantId,
        input.agentId,
        input.place.place_id,
        input.place.name,
        input.place.point.latitude,
        input.place.point.longitude,
        input.place.radius_m,
        stringifyPersistedJson({
          value: input.place.tags,
          table: "location_places",
          column: "tags_json",
          shape: "array",
        }),
        input.place.source,
        input.place.provider_place_id ?? null,
        stringifyPersistedJson({
          value: input.place.metadata,
          table: "location_places",
          column: "metadata_json",
          shape: "object",
        }),
        input.place.created_at,
        input.place.updated_at,
      ],
    );
  }

  async updatePlace(input: {
    tenantId: string;
    agentId: string;
    placeId: string;
    patch: Partial<LocationPlace>;
  }): Promise<void> {
    const current = await this.db.get<RawPlaceRow>(
      `SELECT place_id, name, latitude, longitude, radius_m, tags_json, source, provider_place_id,
              metadata_json, created_at, updated_at
         FROM location_places
        WHERE tenant_id = ? AND agent_id = ? AND place_id = ?`,
      [input.tenantId, input.agentId, input.placeId],
    );
    if (!current) throw new Error("place not found");
    await this.db.run(
      `UPDATE location_places
          SET name = ?, latitude = ?, longitude = ?, radius_m = ?, tags_json = ?, source = ?,
              provider_place_id = ?, metadata_json = ?, updated_at = ?
        WHERE tenant_id = ? AND agent_id = ? AND place_id = ?`,
      [
        input.patch.name ?? current.name,
        input.patch.point?.latitude ?? current.latitude,
        input.patch.point?.longitude ?? current.longitude,
        input.patch.radius_m ?? current.radius_m,
        stringifyPersistedJson({
          value: input.patch.tags ?? parseStringArray(current.tags_json, this.observer),
          table: "location_places",
          column: "tags_json",
          shape: "array",
        }),
        input.patch.source ?? current.source,
        input.patch.provider_place_id ?? current.provider_place_id,
        stringifyPersistedJson({
          value:
            input.patch.metadata ??
            parseObject(current.metadata_json, "location_places", "metadata_json", this.observer),
          table: "location_places",
          column: "metadata_json",
          shape: "object",
        }),
        new Date().toISOString(),
        input.tenantId,
        input.agentId,
        input.placeId,
      ],
    );
  }

  async deletePlace(input: {
    tenantId: string;
    agentId: string;
    placeId: string;
  }): Promise<boolean> {
    const result = await this.db.run(
      `DELETE FROM location_places WHERE tenant_id = ? AND agent_id = ? AND place_id = ?`,
      [input.tenantId, input.agentId, input.placeId],
    );
    return result.changes === 1;
  }

  async insertSampleIfAbsent(input: {
    tenantId: string;
    agentId: string;
    nodeId: string;
    payload: LocationBeacon;
    accepted: boolean;
  }): Promise<void> {
    await this.db.run(
      `INSERT INTO location_samples (
         tenant_id, agent_id, sample_id, node_id, recorded_at, latitude, longitude, accuracy_m,
         altitude_m, altitude_accuracy_m, heading_deg, speed_mps, source, is_background, accepted
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, sample_id) DO NOTHING`,
      [
        input.tenantId,
        input.agentId,
        input.payload.sample_id,
        input.nodeId,
        input.payload.recorded_at,
        input.payload.coords.latitude,
        input.payload.coords.longitude,
        input.payload.coords.accuracy_m,
        input.payload.coords.altitude_m ?? null,
        input.payload.coords.altitude_accuracy_m ?? null,
        input.payload.coords.heading_deg ?? null,
        input.payload.coords.speed_mps ?? null,
        input.payload.source,
        input.payload.is_background ? 1 : 0,
        input.accepted ? 1 : 0,
      ],
    );
  }

  async listStates(input: {
    tenantId: string;
    agentId: string;
    nodeId: string;
  }): Promise<RawStateRow[]> {
    return await this.db.all<RawStateRow>(
      `SELECT subject_kind, subject_ref, status, entered_at, dwell_emitted_at
         FROM location_subject_states
        WHERE tenant_id = ? AND agent_id = ? AND node_id = ?`,
      [input.tenantId, input.agentId, input.nodeId],
    );
  }

  async upsertState(input: {
    tenantId: string;
    agentId: string;
    nodeId: string;
    subjectKind: "saved_place" | "poi_category";
    subjectRef: string;
    status: "inside" | "outside";
    enteredAt: string | null;
    dwellEmittedAt: string | null;
  }): Promise<void> {
    await this.db.run(
      `INSERT INTO location_subject_states (
         tenant_id, agent_id, node_id, subject_kind, subject_ref, status, entered_at,
         dwell_emitted_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, agent_id, node_id, subject_kind, subject_ref) DO UPDATE SET
         status = excluded.status,
         entered_at = excluded.entered_at,
         dwell_emitted_at = excluded.dwell_emitted_at,
         updated_at = excluded.updated_at`,
      [
        input.tenantId,
        input.agentId,
        input.nodeId,
        input.subjectKind,
        input.subjectRef,
        input.status,
        input.enteredAt,
        input.dwellEmittedAt,
        new Date().toISOString(),
      ],
    );
  }

  async insertEventIfAbsent(input: {
    tenantId: string;
    agentId: string;
    event: LocationEvent;
    subjectKind: "saved_place" | "poi_category";
    subjectRef: string;
  }): Promise<boolean> {
    const result = await this.db.run(
      `INSERT INTO location_events (
         tenant_id, agent_id, event_id, sample_id, node_id, event_type, transition, subject_kind,
         subject_ref, place_id, place_name, provider_place_id, category_key, latitude, longitude,
         accuracy_m, altitude_m, altitude_accuracy_m, heading_deg, speed_mps, distance_m,
         metadata_json, occurred_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, agent_id, node_id, sample_id, event_type, subject_kind, subject_ref)
       DO NOTHING`,
      [
        input.tenantId,
        input.agentId,
        input.event.event_id,
        input.event.sample_id,
        input.event.node_id,
        input.event.type,
        input.event.transition,
        input.subjectKind,
        input.subjectRef,
        input.event.place_id ?? null,
        input.event.place_name ?? null,
        input.event.provider_place_id ?? null,
        input.event.category_key ?? null,
        input.event.coords.latitude,
        input.event.coords.longitude,
        input.event.coords.accuracy_m,
        input.event.coords.altitude_m ?? null,
        input.event.coords.altitude_accuracy_m ?? null,
        input.event.coords.heading_deg ?? null,
        input.event.coords.speed_mps ?? null,
        input.event.distance_m ?? null,
        stringifyPersistedJson({
          value: input.event.metadata,
          table: "location_events",
          column: "metadata_json",
          shape: "object",
        }),
        input.event.occurred_at,
      ],
    );
    return result.changes === 1;
  }

  async listEvents(input: {
    tenantId: string;
    agentId: string;
    agentKey: string;
    limit: number;
  }): Promise<LocationEvent[]> {
    const rows = await this.db.all<RawEventRow>(
      `SELECT event_id, sample_id, node_id, event_type, transition, place_id, place_name,
              provider_place_id, category_key, latitude, longitude, accuracy_m, altitude_m,
              altitude_accuracy_m, heading_deg, speed_mps, distance_m, metadata_json, occurred_at
         FROM location_events
        WHERE tenant_id = ? AND agent_id = ?
        ORDER BY occurred_at DESC
        LIMIT ?`,
      [input.tenantId, input.agentId, Math.max(1, Math.min(200, input.limit))],
    );
    return rows.map((row) => toLocationEvent(row, input.agentKey, this.observer));
  }

  async listAutomationTriggers(input: {
    tenantId: string;
    agentId?: string;
    workspaceId?: string;
  }): Promise<LocationAutomationTriggerRecord[]> {
    const rows = await this.db.all<RawTriggerRow>(
      `SELECT t.trigger_id, ag.agent_key, ws.workspace_key, t.enabled, t.delivery_mode,
              t.trigger_type, t.condition_json, t.execution_json, t.created_at, t.updated_at
         FROM automation_triggers t
         JOIN agents ag ON ag.tenant_id = t.tenant_id AND ag.agent_id = t.agent_id
         JOIN workspaces ws ON ws.tenant_id = t.tenant_id AND ws.workspace_id = t.workspace_id
        WHERE t.tenant_id = ?
          AND (? IS NULL OR t.agent_id = ?)
          AND (? IS NULL OR t.workspace_id = ?)
        ORDER BY t.updated_at DESC`,
      [
        input.tenantId,
        input.agentId ?? null,
        input.agentId ?? null,
        input.workspaceId ?? null,
        input.workspaceId ?? null,
      ],
    );
    return rows.map((row) => toLocationAutomationTriggerRecord(row, this.observer));
  }

  async createAutomationTrigger(input: {
    tenantId: string;
    agentId: string;
    workspaceId: string;
    triggerId: string;
    body: LocationAutomationTriggerCreateRequest;
  }): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      `INSERT INTO automation_triggers (
         tenant_id, trigger_id, agent_id, workspace_id, trigger_type, condition_json,
         execution_json, delivery_mode, enabled, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'location', ?, ?, ?, ?, ?, ?)`,
      [
        input.tenantId,
        input.triggerId,
        input.agentId,
        input.workspaceId,
        stringifyPersistedJson({
          value: input.body.condition,
          table: "automation_triggers",
          column: "condition_json",
          shape: "object",
        }),
        stringifyPersistedJson({
          value: input.body.execution,
          table: "automation_triggers",
          column: "execution_json",
          shape: "object",
        }),
        input.body.delivery_mode,
        input.body.enabled ? 1 : 0,
        nowIso,
        nowIso,
      ],
    );
  }

  async updateAutomationTrigger(input: {
    tenantId: string;
    triggerId: string;
    patch: LocationAutomationTriggerPatchRequest;
  }): Promise<boolean> {
    const current = await this.db.get<{
      enabled: number | boolean;
      delivery_mode: "quiet" | "notify";
      condition_json: string;
      execution_json: string;
    }>(
      `SELECT enabled, delivery_mode, condition_json, execution_json
         FROM automation_triggers
        WHERE tenant_id = ? AND trigger_id = ?`,
      [input.tenantId, input.triggerId],
    );
    if (!current) return false;
    await this.db.run(
      `UPDATE automation_triggers
          SET enabled = ?, delivery_mode = ?, condition_json = ?, execution_json = ?, updated_at = ?
        WHERE tenant_id = ? AND trigger_id = ?`,
      [
        (input.patch.enabled ?? toBoolean(current.enabled)) ? 1 : 0,
        input.patch.delivery_mode ?? current.delivery_mode,
        stringifyPersistedJson({
          value:
            input.patch.condition ??
            parseLocationTriggerCondition(current.condition_json, this.observer),
          table: "automation_triggers",
          column: "condition_json",
          shape: "object",
        }),
        stringifyPersistedJson({
          value:
            input.patch.execution ??
            parseLocationTriggerExecution(current.execution_json, this.observer),
          table: "automation_triggers",
          column: "execution_json",
          shape: "object",
        }),
        new Date().toISOString(),
        input.tenantId,
        input.triggerId,
      ],
    );
    return true;
  }

  async deleteAutomationTrigger(input: { tenantId: string; triggerId: string }): Promise<boolean> {
    const result = await this.db.run(
      `DELETE FROM automation_triggers WHERE tenant_id = ? AND trigger_id = ?`,
      [input.tenantId, input.triggerId],
    );
    return result.changes === 1;
  }
}
