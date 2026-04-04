import {
  WsWorkflowStartResult,
  type WorkflowRunTrigger as WorkflowRunTriggerT,
  type WsWorkflowStartPayload,
} from "@tyrum/contracts";
import { randomUUID } from "node:crypto";
import type { PolicyService } from "@tyrum/runtime-policy";
import type { AgentRegistry } from "../agent/registry.js";
import { resolveAgentConversationScope } from "../automation/conversation-routing.js";
import { IdentityScopeDal, type IdentityScopeDal as IdentityScopeDalT } from "../identity/scope.js";
import { ScopeNotFoundError } from "../identity/scope.js";
import type { SqlDb } from "../../statestore/types.js";
import { createQueuedWorkflowRunFromActions } from "../workflow-run/create-queued-run.js";
import { WorkflowRunDal } from "../workflow-run/dal.js";

export interface WorkflowStartExecutionDeps {
  db?: SqlDb;
  workflowRunDal?: WorkflowRunDal;
  policyService?: PolicyService;
  agents?: AgentRegistry;
  identityScopeDal?: IdentityScopeDalT;
}

export interface WorkflowStartExecutionInput {
  tenantId: string;
  payload: WsWorkflowStartPayload;
}

function deriveWorkflowTrigger(
  conversationKey: WsWorkflowStartPayload["conversation_key"],
): WorkflowRunTriggerT {
  return {
    kind: "api",
    metadata: { conversation_key: conversationKey },
  };
}

function resolveWorkflowPolicyService(input: {
  policyService?: PolicyService;
  agents?: AgentRegistry;
  agentKey: string;
}): PolicyService {
  if (input.agents) {
    return input.agents.getPolicyService(input.agentKey);
  }
  if (input.policyService) {
    return input.policyService;
  }
  throw new Error("workflow.start not supported");
}

function resolveWorkflowRunDal(deps: WorkflowStartExecutionDeps): WorkflowRunDal {
  if (deps.workflowRunDal) {
    return deps.workflowRunDal;
  }
  if (deps.db) {
    return new WorkflowRunDal(deps.db);
  }
  throw new Error("workflow.start not supported");
}

function resolveIdentityScopeDal(deps: WorkflowStartExecutionDeps): IdentityScopeDalT {
  if (deps.identityScopeDal) {
    return deps.identityScopeDal;
  }
  if (deps.db) {
    return new IdentityScopeDal(deps.db);
  }
  throw new Error("workflow.start not supported");
}

export async function executeWorkflowStart(
  deps: WorkflowStartExecutionDeps,
  input: WorkflowStartExecutionInput,
): Promise<WsWorkflowStartResult> {
  const workflowRunDal = resolveWorkflowRunDal(deps);
  const identityScopeDal = resolveIdentityScopeDal(deps);
  const planId = input.payload.plan_id ?? `plan-${randomUUID()}`;
  const requestId = input.payload.request_id ?? `req-${randomUUID()}`;
  const scope = resolveAgentConversationScope(input.payload.conversation_key);
  const agentKey = scope.agentKey;
  const policy = resolveWorkflowPolicyService({
    policyService: deps.policyService,
    agents: deps.agents,
    agentKey,
  });
  const agentId = await identityScopeDal.resolveAgentId(input.tenantId, agentKey);
  if (!agentId) {
    throw new ScopeNotFoundError(`agent '${agentKey}' not found`, {
      tenantId: input.tenantId,
      agentKey,
    });
  }
  const workspaceId = await identityScopeDal.ensureWorkspaceId(input.tenantId, scope.workspaceKey);
  await identityScopeDal.ensureMembership(input.tenantId, agentId, workspaceId);

  const effectivePolicy = await policy.loadEffectiveBundle({
    tenantId: input.tenantId,
    agentId,
  });
  const snapshot = await policy.getOrCreateSnapshot(input.tenantId, effectivePolicy.bundle);

  const workflowRunId = await createQueuedWorkflowRunFromActions({
    workflowRunDal,
    tenantId: input.tenantId,
    agentId,
    workspaceId,
    runKey: input.payload.conversation_key,
    conversationKey: input.payload.conversation_key,
    trigger: deriveWorkflowTrigger(input.payload.conversation_key),
    planId,
    requestId,
    budgets: input.payload.budgets,
    policySnapshotId: snapshot.policy_snapshot_id,
    actions: input.payload.steps,
  });

  return WsWorkflowStartResult.parse({
    job_id: workflowRunId,
    turn_id: workflowRunId,
    plan_id: planId,
    request_id: requestId,
    conversation_key: input.payload.conversation_key,
    steps_count: input.payload.steps.length,
  });
}
