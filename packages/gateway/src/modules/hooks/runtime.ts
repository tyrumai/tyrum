import type { ActionPrimitive as ActionPrimitiveT, ExecutionTrigger as ExecutionTriggerT } from "@tyrum/schemas";
import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";
import type { ExecutionEngine } from "../execution/engine.js";
import type { PolicyService } from "../policy/service.js";

export type LifecycleHookEvent = {
  event: string;
  metadata?: unknown;
};

export type LifecycleHookDefinition = {
  hook_key: string;
  event: string;
  lane?: string;
  steps: readonly ActionPrimitiveT[];
};

export class LifecycleHooksRuntime {
  constructor(
    private readonly opts: {
      db: SqlDb;
      engine: ExecutionEngine;
      policyService: PolicyService;
      hooks: readonly LifecycleHookDefinition[];
    },
  ) {}

  async fire(input: LifecycleHookEvent): Promise<void> {
    const matches = this.opts.hooks.filter((h) => h.event === input.event);
    if (matches.length === 0) return;

    const effective = await this.opts.policyService.loadEffectiveBundle();
    const snapshot = await this.opts.policyService.getOrCreateSnapshot(effective.bundle);

    for (const hook of matches) {
      const lane = hook.lane?.trim() || "cron";
      const planId = `hook-${hook.hook_key}-${randomUUID()}`;
      const requestId = `hook-${hook.hook_key}-${randomUUID()}`;

      const eventMetadata =
        input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
          ? (input.metadata as Record<string, unknown>)
          : input.metadata !== undefined
            ? { event_metadata: input.metadata }
            : {};

      const trigger: ExecutionTriggerT = {
        kind: "hook",
        key: hook.hook_key,
        lane,
        metadata: {
          ...eventMetadata,
          hook_event: input.event,
          hook_key: hook.hook_key,
          plan_id: planId,
          request_id: requestId,
        },
      };

      await this.opts.engine.enqueuePlan({
        key: hook.hook_key,
        lane,
        planId,
        requestId,
        steps: [...hook.steps],
        policySnapshotId: snapshot.policy_snapshot_id,
        trigger,
      });
    }
  }
}
