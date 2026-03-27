import type {
  LifecycleHookDefinition as LifecycleHookDefinitionT,
  TurnTrigger as TurnTriggerT,
} from "@tyrum/contracts";
import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";
import {
  buildHookConversationKey,
  resolveAgentConversationScope,
} from "../automation/conversation-routing.js";
import type { ExecutionEngine } from "../execution/engine.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import { DEFAULT_TENANT_ID, IdentityScopeDal, ScopeNotFoundError } from "../identity/scope.js";
import { loadScopedPolicySnapshot } from "../policy/scoped-snapshot.js";
import type { GatewayConfigStore } from "../runtime-state/gateway-config-store.js";

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
      hooks?: readonly LifecycleHookDefinitionT[];
    },
  ) {}

  async fire(input: LifecycleHookEvent): Promise<readonly string[]> {
    const tenantId = input.tenantId?.trim() || DEFAULT_TENANT_ID;
    const localHooks = (this.opts.hooks ?? []).map((hook) => ({
      event: hook.event,
      hook_key: hook.hook_key,
      conversation_key: hook.conversation_key,
      steps: [...hook.steps],
    }));
    const hooks =
      localHooks.length > 0
        ? localHooks
        : ((await this.opts.configStore?.getLifecycleHooks(tenantId)) ?? []);
    const matches = hooks.filter((h) => h.event === input.event);
    if (matches.length === 0) return [];

    const identityScopeDal = new IdentityScopeDal(this.opts.db);
    const runIds: string[] = [];
    for (const hook of matches) {
      const scope = resolveAgentConversationScope(hook.conversation_key);
      const agentId = await identityScopeDal.resolveAgentId(tenantId, scope.agentKey);
      if (!agentId) {
        throw new ScopeNotFoundError(`agent '${scope.agentKey}' not found`, {
          tenantId,
          agentKey: scope.agentKey,
        });
      }
      const conversationKey = buildHookConversationKey({
        agentKey: scope.agentKey,
        workspaceKey: scope.workspaceKey,
        hookKey: hook.hook_key,
      });
      const snapshot = await loadScopedPolicySnapshot(this.opts.policyService, {
        tenantId,
        agentId,
      });
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
        conversation_key: conversationKey,
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
        key: conversationKey,
        lane: "main",
        workspaceKey: scope.workspaceKey,
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
