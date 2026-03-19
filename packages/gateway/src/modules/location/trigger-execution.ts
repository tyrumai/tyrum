import {
  buildAgentSessionKey,
  type ActionPrimitive,
  type LocationEvent,
  type Playbook,
} from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import type { ExecutionEngine } from "../execution/engine.js";
import type { IdentityScopeDal } from "../identity/scope.js";
import type { MemoryDal } from "../memory/memory-dal.js";
import { recordMemorySystemEpisode } from "../memory/memory-episode-recorder.js";
import { Logger } from "../observability/logger.js";
import { PlaybookRunner } from "../playbook/runner.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import { loadScopedPolicySnapshot } from "../policy/scoped-snapshot.js";
import type { LocationDal } from "./dal.js";
import type { LocationAutomationTriggerRecord } from "./types.js";

const logger = new Logger({ base: { module: "location.trigger-execution" } });

type FireLocationTriggersInput = {
  tenantId: string;
  agentId?: string;
  event: LocationEvent;
  triggers?: LocationAutomationTriggerRecord[];
  dal: LocationDal;
  db: SqlDb;
  identityScopeDal: IdentityScopeDal;
  engine?: ExecutionEngine;
  policyService?: PolicyService;
  playbooksById: Map<string, Playbook>;
  playbookRunner: PlaybookRunner;
};

function isSavedPlaceEvent(event: LocationEvent): boolean {
  return event.type.startsWith("saved_place.");
}

function isPoiCategoryEvent(event: LocationEvent): boolean {
  return event.type.startsWith("poi_category.");
}

export function matchesTrigger(
  trigger: LocationAutomationTriggerRecord,
  event: LocationEvent,
): boolean {
  if (!trigger.enabled) return false;
  if (trigger.condition.type === "saved_place") {
    return (
      isSavedPlaceEvent(event) &&
      trigger.condition.place_id === event.place_id &&
      trigger.condition.transition === event.transition
    );
  }
  return (
    isPoiCategoryEvent(event) &&
    trigger.condition.category_key === event.category_key &&
    trigger.condition.transition === event.transition
  );
}

function resolveExecutionSteps(
  trigger: LocationAutomationTriggerRecord,
  event: LocationEvent,
  tenantKey: string,
  playbooksById: Map<string, Playbook>,
  playbookRunner: PlaybookRunner,
): ActionPrimitive[] {
  if (trigger.execution.kind === "steps") return trigger.execution.steps;
  if (trigger.execution.kind === "playbook") {
    const playbook = playbooksById.get(trigger.execution.playbook_id);
    if (!playbook) {
      throw new Error(`playbook '${trigger.execution.playbook_id}' not found`);
    }
    return playbookRunner.run(playbook).steps;
  }

  const instruction =
    trigger.execution.instruction?.trim() ||
    `Handle the location trigger for ${event.place_name ?? event.category_key ?? "the current place"}.`;
  const message = [
    `Location trigger: ${event.type}`,
    `Occurred at: ${event.occurred_at}`,
    `Place: ${event.place_name ?? "unknown"}`,
    `Category: ${event.category_key ?? "n/a"}`,
    `Distance meters: ${String(event.distance_m ?? "n/a")}`,
    "",
    "Instruction:",
    instruction,
  ].join("\n");

  return [
    {
      type: "Decide",
      args: {
        tenant_key: tenantKey,
        agent_key: trigger.agent_key,
        workspace_key: trigger.workspace_key,
        channel: "automation:location",
        thread_id: `location-${trigger.trigger_id}`,
        container_kind: "channel",
        parts: [{ type: "text", text: message }],
        metadata: {
          location_trigger: {
            trigger_id: trigger.trigger_id,
            event_id: event.event_id,
            transition: event.transition,
            type: event.type,
            place_name: event.place_name ?? null,
            category_key: event.category_key ?? null,
            delivery_mode: trigger.delivery_mode,
          },
        },
      },
    },
  ];
}

async function resolveTenantKey(db: SqlDb, tenantId: string): Promise<string> {
  const row = await db.get<{ tenant_key: string }>(
    `SELECT tenant_key FROM tenants WHERE tenant_id = ? LIMIT 1`,
    [tenantId],
  );
  return row?.tenant_key?.trim() || "default";
}

async function enqueueTrigger(
  input: FireLocationTriggersInput,
  trigger: LocationAutomationTriggerRecord,
): Promise<void> {
  if (!input.engine || !input.policyService) return;

  const tenantKey = await resolveTenantKey(input.db, input.tenantId);
  const key = buildAgentSessionKey({
    agentKey: trigger.agent_key,
    container: "dm",
    channel: "automation",
    dmScope: "shared",
  });
  const planId = `location-trigger:${trigger.trigger_id}:${input.event.event_id}`;
  const steps = resolveExecutionSteps(
    trigger,
    input.event,
    tenantKey,
    input.playbooksById,
    input.playbookRunner,
  );
  const snapshot = await loadScopedPolicySnapshot(input.policyService, {
    tenantId: input.tenantId,
  });

  await input.db.transaction(async (tx) => {
    await input.engine!.enqueuePlanInTx(tx, {
      tenantId: input.tenantId,
      key,
      lane: "main",
      workspaceKey: trigger.workspace_key,
      planId,
      requestId: planId,
      steps,
      policySnapshotId: snapshot.policy_snapshot_id,
      trigger: {
        kind: "manual",
        key,
        lane: "main",
        metadata: {
          location_trigger: {
            trigger_id: trigger.trigger_id,
            transition: input.event.transition,
            event_id: input.event.event_id,
            type: input.event.type,
            place_id: input.event.place_id ?? null,
            category_key: input.event.category_key ?? null,
            place_name: input.event.place_name ?? null,
            provider_place_id: input.event.provider_place_id ?? null,
            occurred_at: input.event.occurred_at,
            delivery_mode: trigger.delivery_mode,
          },
        },
      },
    });
  });
}

export async function recordLocationEpisode(
  memoryDal: MemoryDal,
  tenantId: string,
  agentId: string,
  event: LocationEvent,
): Promise<void> {
  await recordMemorySystemEpisode(
    memoryDal,
    {
      occurred_at: event.occurred_at,
      channel: "location",
      event_type: event.type,
      summary_md: `${event.transition} ${event.place_name ?? event.category_key ?? "location"}`,
      tags: ["location", `node:${event.node_id}`],
      metadata: {
        event_id: event.event_id,
        sample_id: event.sample_id,
        place_id: event.place_id ?? null,
        category_key: event.category_key ?? null,
        provider_place_id: event.provider_place_id ?? null,
        distance_m: event.distance_m ?? null,
        latitude_3dp: Number(event.coords.latitude.toFixed(3)),
        longitude_3dp: Number(event.coords.longitude.toFixed(3)),
      },
    },
    { tenantId, agentId },
  );
}

export async function fireLocationTriggers(input: FireLocationTriggersInput): Promise<void> {
  const agentId =
    input.agentId ??
    (await input.identityScopeDal.resolveAgentId(input.tenantId, input.event.agent_key));
  if (!agentId) return;

  const triggers =
    input.triggers ??
    (await input.dal.listAutomationTriggers({
      tenantId: input.tenantId,
      agentId,
    }));

  for (const trigger of triggers) {
    if (!matchesTrigger(trigger, input.event)) continue;
    try {
      await enqueueTrigger(input, trigger);
    } catch (error) {
      logger.warn("location.trigger_dispatch_failed", {
        tenant_id: input.tenantId,
        agent_id: input.agentId ?? null,
        trigger_id: trigger.trigger_id,
        condition_type: trigger.condition.type,
        execution_kind: trigger.execution.kind,
        event_id: input.event.event_id,
        event_type: input.event.type,
        transition: input.event.transition,
        place_id: input.event.place_id ?? null,
        category_key: input.event.category_key ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
