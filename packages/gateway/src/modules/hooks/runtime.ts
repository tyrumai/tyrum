import type {
  ActionPrimitive as ActionPrimitiveT,
  TurnTrigger as TurnTriggerT,
} from "@tyrum/contracts";
import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";
import type { ExecutionEngine } from "../execution/engine.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";
import type { GatewayConfigStore } from "../runtime-state/gateway-config-store.js";

type HookLane = "cron" | "heartbeat";

export type LifecycleHookEvent = {
  event: string;
  tenantId?: string;
  metadata?: unknown;
};

export class LifecycleHooksRuntime {
  constructor(
    private readonly opts: {
      db: SqlDb;
      engine: ExecutionEngine;
      policyService: PolicyService;
      configStore?: GatewayConfigStore;
      hooks?: readonly {
        event: string;
        hook_key: string;
        lane?: HookLane;
        steps: readonly ActionPrimitiveT[];
      }[];
    },
  ) {}

  async fire(input: LifecycleHookEvent): Promise<readonly string[]> {
    const tenantId = input.tenantId?.trim() || DEFAULT_TENANT_ID;
    const localHooks = (this.opts.hooks ?? []).map((hook) => ({
      event: hook.event,
      hook_key: hook.hook_key,
      lane: hook.lane ?? "cron",
      steps: [...hook.steps],
    }));
    const hooks =
      localHooks.length > 0
        ? localHooks
        : ((await this.opts.configStore?.getLifecycleHooks(tenantId)) ?? []);
    const matches = hooks.filter((h) => h.event === input.event);
    if (matches.length === 0) return [];

    const effective = await this.opts.policyService.loadEffectiveBundle({ tenantId });
    const snapshot = await this.opts.policyService.getOrCreateSnapshot(tenantId, effective.bundle);

    const runIds: string[] = [];
    for (const hook of matches) {
      const lane: HookLane = "lane" in hook && hook.lane ? hook.lane : "cron";
      const planId = `hook-${hook.hook_key}-${randomUUID()}`;
      const requestId = `hook-${hook.hook_key}-${randomUUID()}`;

      const eventMetadata =
        input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
          ? (input.metadata as Record<string, unknown>)
          : input.metadata !== undefined
            ? { event_metadata: input.metadata }
            : {};

      const trigger: TurnTriggerT = {
        kind: "hook",
        conversation_key: hook.hook_key,
        metadata: {
          ...eventMetadata,
          hook_event: input.event,
          hook_key: hook.hook_key,
          plan_id: planId,
          request_id: requestId,
        },
      };

      const { runId } = await this.opts.engine.enqueuePlan({
        tenantId,
        key: hook.hook_key,
        lane,
        planId,
        requestId,
        steps: [...hook.steps],
        policySnapshotId: snapshot.policy_snapshot_id,
        trigger,
      });
      runIds.push(runId);
    }

    return runIds;
  }
}
