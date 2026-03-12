import { randomUUID } from "node:crypto";
import {
  type LocationBeacon,
  type LocationBeaconResult,
  type LocationEvent,
  type LocationPlace,
  type LocationPlaceCreateRequest,
  type LocationPlacePatchRequest,
  type LocationProfile,
  type LocationProfileUpdateRequest,
  type Playbook,
} from "@tyrum/schemas";
import type { IdentityScopeDal } from "../identity/scope.js";
import type { MemoryV1Dal } from "../memory/v1-dal.js";
import type { ExecutionEngine } from "../execution/engine.js";
import type { PolicyService } from "../policy/service.js";
import { PlaybookRunner } from "../playbook/runner.js";
import { Logger } from "../observability/logger.js";
import { createPoiProvider, type PoiProvider } from "./poi-provider.js";
import { haversineDistanceMeters } from "./geo.js";
import { LocationDal } from "./dal.js";
import {
  DEFAULT_CATEGORY_EXIT_M,
  evaluateCategoryEvent,
  evaluateSavedPlaceEvent,
  type LocationSubjectState,
} from "./event-evaluator.js";
import { fireLocationTriggers, recordLocationEpisode } from "./trigger-execution.js";
import type {
  LocationAutomationTriggerCreateRequest,
  LocationAutomationTriggerPatchRequest,
  LocationAutomationTriggerRecord,
} from "./types.js";

const logger = new Logger({ base: { module: "location.service" } });

export interface LocationServiceOptions {
  identityScopeDal: IdentityScopeDal;
  memoryV1Dal: MemoryV1Dal;
  engine?: ExecutionEngine;
  policyService?: PolicyService;
  playbooks?: Playbook[];
  playbookRunner?: PlaybookRunner;
}

export class LocationService {
  private readonly dal: LocationDal;
  private readonly playbooksById: Map<string, Playbook>;
  private readonly playbookRunner: PlaybookRunner;
  private readonly poiProvidersByKind = new Map<
    LocationProfile["poi_provider_kind"],
    PoiProvider
  >();
  private readonly db: ConstructorParameters<typeof LocationDal>[0];

  constructor(
    db: ConstructorParameters<typeof LocationDal>[0],
    private readonly opts: LocationServiceOptions,
  ) {
    this.db = db;
    this.dal = new LocationDal(db);
    this.playbookRunner = opts.playbookRunner ?? new PlaybookRunner();
    this.playbooksById = new Map(
      (opts.playbooks ?? []).map((playbook) => [playbook.manifest.id, playbook]),
    );
  }

  async getProfile(input: { tenantId: string; agentKey: string }): Promise<LocationProfile> {
    const agentId = await this.opts.identityScopeDal.ensureAgentId(input.tenantId, input.agentKey);
    return await this.dal.getProfile({
      tenantId: input.tenantId,
      agentId,
      agentKey: input.agentKey,
    });
  }

  async updateProfile(input: {
    tenantId: string;
    agentKey: string;
    patch: LocationProfileUpdateRequest;
  }): Promise<LocationProfile> {
    const agentKey = input.patch.agent_key?.trim() || input.agentKey;
    const agentId = await this.opts.identityScopeDal.ensureAgentId(input.tenantId, agentKey);
    const current = await this.dal.getProfile({ tenantId: input.tenantId, agentId, agentKey });
    const next: Omit<LocationProfile, "agent_key" | "updated_at"> = {
      primary_node_id:
        input.patch.primary_node_id !== undefined
          ? input.patch.primary_node_id
          : current.primary_node_id,
      stream_enabled: input.patch.stream_enabled ?? current.stream_enabled,
      distance_filter_m: input.patch.distance_filter_m ?? current.distance_filter_m,
      max_interval_ms: input.patch.max_interval_ms ?? current.max_interval_ms,
      max_accuracy_m: input.patch.max_accuracy_m ?? current.max_accuracy_m,
      background_enabled: input.patch.background_enabled ?? current.background_enabled,
      poi_provider_kind: input.patch.poi_provider_kind ?? current.poi_provider_kind,
    };
    await this.dal.upsertProfile({ tenantId: input.tenantId, agentId, profile: next });
    return await this.dal.getProfile({ tenantId: input.tenantId, agentId, agentKey });
  }

  async listPlaces(input: { tenantId: string; agentKey: string }): Promise<LocationPlace[]> {
    const agentId = await this.opts.identityScopeDal.ensureAgentId(input.tenantId, input.agentKey);
    return await this.dal.listPlaces({
      tenantId: input.tenantId,
      agentId,
      agentKey: input.agentKey,
    });
  }

  async createPlace(input: {
    tenantId: string;
    agentKey: string;
    body: LocationPlaceCreateRequest;
  }): Promise<LocationPlace> {
    const agentKey = input.body.agent_key?.trim() || input.agentKey;
    const agentId = await this.opts.identityScopeDal.ensureAgentId(input.tenantId, agentKey);
    const nowIso = new Date().toISOString();
    const place: LocationPlace = {
      place_id: randomUUID(),
      agent_key: agentKey,
      name: input.body.name,
      point: { latitude: input.body.latitude, longitude: input.body.longitude },
      radius_m: input.body.radius_m,
      tags: input.body.tags,
      source: input.body.source,
      provider_place_id: input.body.provider_place_id ?? null,
      metadata: input.body.metadata,
      created_at: nowIso,
      updated_at: nowIso,
    };
    await this.dal.createPlace({ tenantId: input.tenantId, agentId, place });
    return place;
  }

  async updatePlace(input: {
    tenantId: string;
    agentKey: string;
    placeId: string;
    patch: LocationPlacePatchRequest;
  }): Promise<LocationPlace> {
    const agentId = await this.opts.identityScopeDal.ensureAgentId(input.tenantId, input.agentKey);
    return await this.dal.updatePlace({
      tenantId: input.tenantId,
      agentId,
      agentKey: input.agentKey,
      placeId: input.placeId,
      patch: input.patch,
    });
  }

  async deletePlace(input: {
    tenantId: string;
    agentKey: string;
    placeId: string;
  }): Promise<boolean> {
    const agentId = await this.opts.identityScopeDal.ensureAgentId(input.tenantId, input.agentKey);
    return await this.dal.deletePlace({
      tenantId: input.tenantId,
      agentId,
      placeId: input.placeId,
    });
  }

  async listEvents(input: {
    tenantId: string;
    agentKey: string;
    limit?: number;
  }): Promise<LocationEvent[]> {
    const agentId = await this.opts.identityScopeDal.ensureAgentId(input.tenantId, input.agentKey);
    return await this.dal.listEvents({
      tenantId: input.tenantId,
      agentId,
      agentKey: input.agentKey,
      limit: input.limit ?? 50,
    });
  }

  async listAutomationTriggers(input: {
    tenantId: string;
    agentKey?: string;
    workspaceKey?: string;
  }): Promise<LocationAutomationTriggerRecord[]> {
    const agentId = input.agentKey
      ? await this.opts.identityScopeDal.ensureAgentId(input.tenantId, input.agentKey)
      : undefined;
    const workspaceId = input.workspaceKey
      ? await this.opts.identityScopeDal.ensureWorkspaceId(input.tenantId, input.workspaceKey)
      : undefined;
    if (agentId && workspaceId) {
      await this.opts.identityScopeDal.ensureMembership(input.tenantId, agentId, workspaceId);
    }
    return await this.dal.listAutomationTriggers({
      tenantId: input.tenantId,
      agentId,
      workspaceId,
    });
  }

  async createAutomationTrigger(input: {
    tenantId: string;
    agentKey: string;
    body: LocationAutomationTriggerCreateRequest;
  }): Promise<LocationAutomationTriggerRecord> {
    const agentKey = input.body.agent_key?.trim() || input.agentKey;
    const workspaceKey = input.body.workspace_key?.trim() || "default";
    const agentId = await this.opts.identityScopeDal.ensureAgentId(input.tenantId, agentKey);
    const workspaceId = await this.opts.identityScopeDal.ensureWorkspaceId(
      input.tenantId,
      workspaceKey,
    );
    await this.opts.identityScopeDal.ensureMembership(input.tenantId, agentId, workspaceId);
    const triggerId = randomUUID();
    await this.dal.createAutomationTrigger({
      tenantId: input.tenantId,
      agentId,
      workspaceId,
      triggerId,
      body: input.body,
    });
    const triggers = await this.dal.listAutomationTriggers({
      tenantId: input.tenantId,
      agentId,
      workspaceId,
    });
    const created = triggers.find((trigger) => trigger.trigger_id === triggerId);
    if (!created) throw new Error("trigger not found");
    return created;
  }

  async updateAutomationTrigger(input: {
    tenantId: string;
    triggerId: string;
    patch: LocationAutomationTriggerPatchRequest;
  }): Promise<LocationAutomationTriggerRecord | null> {
    const updated = await this.dal.updateAutomationTrigger({
      tenantId: input.tenantId,
      triggerId: input.triggerId,
      patch: input.patch,
    });
    if (!updated) return null;
    const triggers = await this.dal.listAutomationTriggers({ tenantId: input.tenantId });
    return triggers.find((trigger) => trigger.trigger_id === input.triggerId) ?? null;
  }

  async deleteAutomationTrigger(input: { tenantId: string; triggerId: string }): Promise<boolean> {
    return await this.dal.deleteAutomationTrigger(input);
  }

  async ingestBeacon(input: {
    tenantId: string;
    nodeId: string;
    payload: LocationBeacon;
  }): Promise<LocationBeaconResult> {
    const agentKey = input.payload.agent_key?.trim() || "default";
    const agentId = await this.opts.identityScopeDal.ensureAgentId(input.tenantId, agentKey);
    let profile = await this.dal.getProfile({ tenantId: input.tenantId, agentId, agentKey });
    if (!profile.primary_node_id) {
      await this.dal.upsertProfile({
        tenantId: input.tenantId,
        agentId,
        profile: {
          primary_node_id: input.nodeId,
          stream_enabled: profile.stream_enabled,
          distance_filter_m: profile.distance_filter_m,
          max_interval_ms: profile.max_interval_ms,
          max_accuracy_m: profile.max_accuracy_m,
          background_enabled: profile.background_enabled,
          poi_provider_kind: profile.poi_provider_kind,
        },
      });
      profile = await this.dal.getProfile({ tenantId: input.tenantId, agentId, agentKey });
    }

    const accepted =
      profile.stream_enabled &&
      input.payload.coords.accuracy_m <= profile.max_accuracy_m &&
      profile.primary_node_id === input.nodeId;

    await this.dal.insertSampleIfAbsent({
      tenantId: input.tenantId,
      agentId,
      nodeId: input.nodeId,
      payload: input.payload,
      accepted,
    });

    const sample = {
      sample_id: input.payload.sample_id,
      agent_key: agentKey,
      node_id: input.nodeId,
      recorded_at: input.payload.recorded_at,
      coords: input.payload.coords,
      source: input.payload.source,
      is_background: input.payload.is_background,
      accepted,
    } satisfies LocationBeaconResult["sample"];

    if (!accepted) {
      return { sample, events: [] };
    }

    const states = await this.dal.listStates({
      tenantId: input.tenantId,
      agentId,
      nodeId: input.nodeId,
    });
    const stateMap = new Map(
      states.map((state) => [`${state.subject_kind}:${state.subject_ref}`, state]),
    );
    const places = await this.dal.listPlaces({ tenantId: input.tenantId, agentId, agentKey });
    const automationTriggers = await this.dal.listAutomationTriggers({
      tenantId: input.tenantId,
      agentId,
    });
    const events: LocationEvent[] = [];

    for (const place of places) {
      const distanceM = haversineDistanceMeters({
        latitudeA: input.payload.coords.latitude,
        longitudeA: input.payload.coords.longitude,
        latitudeB: place.point.latitude,
        longitudeB: place.point.longitude,
      });
      const subjectKey = `saved_place:${place.place_id}`;
      const currentState = stateMap.get(subjectKey);
      const nextEvent = evaluateSavedPlaceEvent({
        agentKey,
        nodeId: input.nodeId,
        payload: input.payload,
        place,
        distanceM,
        currentState,
      });
      if (nextEvent) {
        const inserted = await this.dal.insertEventIfAbsent({
          tenantId: input.tenantId,
          agentId,
          event: nextEvent.event,
          subjectKind: "saved_place",
          subjectRef: place.place_id,
        });
        await this.dal.upsertState({
          tenantId: input.tenantId,
          agentId,
          nodeId: input.nodeId,
          subjectKind: "saved_place",
          subjectRef: place.place_id,
          status: nextEvent.state.status,
          enteredAt: nextEvent.state.enteredAt,
          dwellEmittedAt: nextEvent.state.dwellEmittedAt,
        });
        if (inserted) {
          events.push(nextEvent.event);
          await recordLocationEpisode(
            this.opts.memoryV1Dal,
            input.tenantId,
            agentId,
            nextEvent.event,
          );
          await fireLocationTriggers({
            tenantId: input.tenantId,
            agentId,
            event: nextEvent.event,
            triggers: automationTriggers,
            dal: this.dal,
            db: this.db,
            identityScopeDal: this.opts.identityScopeDal,
            engine: this.opts.engine,
            policyService: this.opts.policyService,
            playbooksById: this.playbooksById,
            playbookRunner: this.playbookRunner,
          });
        }
      }
    }

    try {
      const categoryEvents = await this.evaluateCategoryTriggers({
        tenantId: input.tenantId,
        agentId,
        agentKey,
        nodeId: input.nodeId,
        payload: input.payload,
        profile,
        stateMap,
        automationTriggers,
      });
      events.push(...categoryEvents);
    } catch (error) {
      logger.warn("location.poi_category_evaluation_failed", {
        tenant_id: input.tenantId,
        agent_id: agentId,
        agent_key: agentKey,
        node_id: input.nodeId,
        poi_provider_kind: profile.poi_provider_kind,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { sample, events };
  }

  private async evaluateCategoryTriggers(input: {
    tenantId: string;
    agentId: string;
    agentKey: string;
    nodeId: string;
    payload: LocationBeacon;
    profile: LocationProfile;
    stateMap: Map<string, LocationSubjectState>;
    automationTriggers: LocationAutomationTriggerRecord[];
  }): Promise<LocationEvent[]> {
    const categoryKeys = [
      ...new Set(
        input.automationTriggers
          .filter((trigger) => trigger.enabled)
          .flatMap((trigger) =>
            trigger.condition.type === "poi_category" ? [trigger.condition.category_key] : [],
          ),
      ),
    ];
    if (categoryKeys.length === 0 || input.profile.poi_provider_kind === "none") {
      return [];
    }
    const provider = this.getPoiProvider(input.profile.poi_provider_kind);
    const events: LocationEvent[] = [];

    for (const categoryKey of categoryKeys) {
      const match = await provider.findNearestCategoryMatch({
        coords: input.payload.coords,
        categoryKey,
        radiusM: DEFAULT_CATEGORY_EXIT_M,
      });
      const subjectKey = `poi_category:${categoryKey}`;
      const currentState = input.stateMap.get(subjectKey);
      const event = evaluateCategoryEvent({
        agentKey: input.agentKey,
        nodeId: input.nodeId,
        payload: input.payload,
        categoryKey,
        currentState,
        match,
      });
      if (!event) continue;
      const inserted = await this.dal.insertEventIfAbsent({
        tenantId: input.tenantId,
        agentId: input.agentId,
        event: event.event,
        subjectKind: "poi_category",
        subjectRef: categoryKey,
      });
      await this.dal.upsertState({
        tenantId: input.tenantId,
        agentId: input.agentId,
        nodeId: input.nodeId,
        subjectKind: "poi_category",
        subjectRef: categoryKey,
        status: event.state.status,
        enteredAt: event.state.enteredAt,
        dwellEmittedAt: event.state.dwellEmittedAt,
      });
      if (inserted) {
        events.push(event.event);
        await recordLocationEpisode(
          this.opts.memoryV1Dal,
          input.tenantId,
          input.agentId,
          event.event,
        );
        await fireLocationTriggers({
          tenantId: input.tenantId,
          agentId: input.agentId,
          event: event.event,
          triggers: input.automationTriggers,
          dal: this.dal,
          db: this.db,
          identityScopeDal: this.opts.identityScopeDal,
          engine: this.opts.engine,
          policyService: this.opts.policyService,
          playbooksById: this.playbooksById,
          playbookRunner: this.playbookRunner,
        });
      }
    }

    return events;
  }

  private getPoiProvider(kind: LocationProfile["poi_provider_kind"]): PoiProvider {
    const cached = this.poiProvidersByKind.get(kind);
    if (cached) {
      return cached;
    }
    const provider = createPoiProvider(kind);
    this.poiProvidersByKind.set(kind, provider);
    return provider;
  }
}
