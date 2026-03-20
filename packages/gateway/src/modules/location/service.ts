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
} from "@tyrum/contracts";
import type { IdentityScopeDal } from "../identity/scope.js";
import type { MemoryDal } from "../memory/memory-dal.js";
import type { ExecutionEngine } from "../execution/engine.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import { PlaybookRunner } from "../playbook/runner.js";
import { Logger } from "../observability/logger.js";
import { createPoiProvider, type PoiProvider } from "./poi-provider.js";
import { haversineDistanceMeters } from "./geo.js";
import { LocationDal } from "./dal.js";
import {
  resolveExistingAgentIdOrThrow,
  resolveExistingScopedIds,
  resolveLocationAgentKey,
} from "./scope-resolution.js";
import { evaluateSavedPlaceEvent, type LocationSubjectState } from "./event-evaluator.js";
import { evaluateCategoryTriggerEvents } from "./category-trigger-evaluator.js";
import { fireLocationTriggers, recordLocationEpisode } from "./trigger-execution.js";
import type {
  LocationAutomationTriggerCreateRequest,
  LocationAutomationTriggerPatchRequest,
  LocationAutomationTriggerRecord,
} from "./types.js";
import { requirePrimaryAgentKey } from "../identity/scope.js";

const logger = new Logger({ base: { module: "location.service" } });

export interface LocationServiceOptions {
  identityScopeDal: IdentityScopeDal;
  memoryDal: MemoryDal;
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

  async resolveAgentKey(input: { tenantId: string; agentKey?: string | null }): Promise<string> {
    return await resolveLocationAgentKey({
      identityScopeDal: this.opts.identityScopeDal,
      ...input,
    });
  }

  async getProfile(input: { tenantId: string; agentKey: string }): Promise<LocationProfile> {
    const agentId = await resolveExistingAgentIdOrThrow({
      identityScopeDal: this.opts.identityScopeDal,
      ...input,
    });
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
    const agentId = await resolveExistingAgentIdOrThrow({
      identityScopeDal: this.opts.identityScopeDal,
      tenantId: input.tenantId,
      agentKey,
    });
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
    const agentId = await resolveExistingAgentIdOrThrow({
      identityScopeDal: this.opts.identityScopeDal,
      ...input,
    });
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
    const agentId = await resolveExistingAgentIdOrThrow({
      identityScopeDal: this.opts.identityScopeDal,
      tenantId: input.tenantId,
      agentKey,
    });
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
    const agentId = await resolveExistingAgentIdOrThrow({
      identityScopeDal: this.opts.identityScopeDal,
      ...input,
    });
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
    const agentId = await resolveExistingAgentIdOrThrow({
      identityScopeDal: this.opts.identityScopeDal,
      ...input,
    });
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
    const agentId = await resolveExistingAgentIdOrThrow({
      identityScopeDal: this.opts.identityScopeDal,
      ...input,
    });
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
    const { agentId, workspaceId } = await resolveExistingScopedIds({
      identityScopeDal: this.opts.identityScopeDal,
      tenantId: input.tenantId,
      agentKey: input.agentKey,
      workspaceKey: input.workspaceKey,
      requireMembership: Boolean(input.agentKey?.trim() && input.workspaceKey?.trim()),
    });
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
    const explicitWorkspaceKey = input.body.workspace_key?.trim();
    const workspaceKey = explicitWorkspaceKey || "default";
    const agentId = await resolveExistingAgentIdOrThrow({
      identityScopeDal: this.opts.identityScopeDal,
      tenantId: input.tenantId,
      agentKey,
    });
    const resolvedWorkspace = explicitWorkspaceKey
      ? await resolveExistingScopedIds({
          identityScopeDal: this.opts.identityScopeDal,
          tenantId: input.tenantId,
          workspaceKey: explicitWorkspaceKey,
        })
      : undefined;
    const workspaceId =
      resolvedWorkspace?.workspaceId ??
      (await this.opts.identityScopeDal.ensureWorkspaceId(input.tenantId, workspaceKey));
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
    const agentKey =
      input.payload.agent_key?.trim() ||
      (await requirePrimaryAgentKey(this.opts.identityScopeDal, input.tenantId));
    const agentId = await resolveExistingAgentIdOrThrow({
      identityScopeDal: this.opts.identityScopeDal,
      tenantId: input.tenantId,
      agentKey,
    });
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
        if (inserted) {
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
          events.push(nextEvent.event);
          await recordLocationEpisode(
            this.opts.memoryDal,
            input.tenantId,
            agentId,
            nextEvent.event,
          );
          await this.dispatchLocationTriggers({
            tenantId: input.tenantId,
            agentId,
            event: nextEvent.event,
            triggers: automationTriggers,
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
    return await evaluateCategoryTriggerEvents({
      dal: this.dal,
      memoryDal: this.opts.memoryDal,
      getPoiProvider: (kind) => this.getPoiProvider(kind),
      dispatchLocationTriggers: async (triggerInput) => {
        await this.dispatchLocationTriggers(triggerInput);
      },
      ...input,
    });
  }

  private async dispatchLocationTriggers(input: {
    tenantId: string;
    agentId: string;
    event: LocationEvent;
    triggers: LocationAutomationTriggerRecord[];
  }): Promise<void> {
    try {
      await fireLocationTriggers({
        tenantId: input.tenantId,
        agentId: input.agentId,
        event: input.event,
        triggers: input.triggers,
        dal: this.dal,
        db: this.db,
        identityScopeDal: this.opts.identityScopeDal,
        engine: this.opts.engine,
        policyService: this.opts.policyService,
        playbooksById: this.playbooksById,
        playbookRunner: this.playbookRunner,
      });
    } catch (error) {
      logger.warn("location.trigger_dispatch_failed", {
        tenant_id: input.tenantId,
        agent_id: input.agentId,
        event_id: input.event.event_id,
        event_type: input.event.type,
        transition: input.event.transition,
        place_id: input.event.place_id ?? null,
        category_key: input.event.category_key ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
