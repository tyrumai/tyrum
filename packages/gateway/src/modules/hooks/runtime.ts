import type {
  LifecycleHookDefinition as LifecycleHookDefinitionT,
  WorkflowRunTrigger as WorkflowRunTriggerT,
} from "@tyrum/contracts";
import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";
import {
  buildHookConversationKey,
  resolveAgentConversationScope,
} from "../automation/conversation-routing.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import { DEFAULT_TENANT_ID, IdentityScopeDal, ScopeNotFoundError } from "../identity/scope.js";
import { loadScopedPolicySnapshot } from "../policy/scoped-snapshot.js";
import type { GatewayConfigStore } from "../runtime-state/gateway-config-store.js";
import { createQueuedWorkflowRunFromActions } from "../workflow-run/create-queued-run.js";

export type LifecycleHookEvent = {
  event: string;
  tenantId?: string;
  metadata?: unknown;
};

export class LifecycleHooksRuntime {
  constructor(
    private readonly opts: {
      db: SqlDb;
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
    const workflowRunIds: string[] = [];
    for (const hook of matches) {
      const scope = resolveAgentConversationScope(hook.conversation_key);
      const agentId = await identityScopeDal.resolveAgentId(tenantId, scope.agentKey);
      if (!agentId) {
        throw new ScopeNotFoundError(`agent '${scope.agentKey}' not found`, {
          tenantId,
          agentKey: scope.agentKey,
        });
      }
      const workspaceId = await identityScopeDal.ensureWorkspaceId(tenantId, scope.workspaceKey);
      await identityScopeDal.ensureMembership(tenantId, agentId, workspaceId);
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

      const trigger: WorkflowRunTriggerT = {
        kind: "hook",
        metadata: {
          ...eventMetadata,
          hook_event: input.event,
          hook_key: hook.hook_key,
          plan_id: planId,
          request_id: requestId,
        },
      };

      const workflowRunId = await createQueuedWorkflowRunFromActions({
        db: this.opts.db,
        tenantId,
        agentId,
        workspaceId,
        runKey: conversationKey,
        conversationKey,
        trigger,
        planId,
        requestId,
        policySnapshotId: snapshot.policy_snapshot_id,
        actions: hook.steps,
      });
      workflowRunIds.push(workflowRunId);
    }

    return workflowRunIds;
  }
}
