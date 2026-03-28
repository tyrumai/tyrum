import {
  WsWorkflowStartResult,
  type TurnTrigger as TurnTriggerT,
  type WsWorkflowStartPayload,
} from "@tyrum/contracts";
import { randomUUID } from "node:crypto";
import type { PolicyService } from "@tyrum/runtime-policy";
import type { AgentRegistry } from "../agent/registry.js";
import { resolveAgentConversationScope } from "../automation/conversation-routing.js";
import type { IdentityScopeDal } from "../identity/scope.js";
import { ScopeNotFoundError } from "../identity/scope.js";
import type { ExecutionEngine } from "./engine.js";

export interface WorkflowStartExecutionDeps {
  engine: ExecutionEngine;
  policyService?: PolicyService;
  agents?: AgentRegistry;
  identityScopeDal?: IdentityScopeDal;
}

export interface WorkflowStartExecutionInput {
  tenantId: string;
  payload: WsWorkflowStartPayload;
}

function deriveWorkflowTrigger(
  conversationKey: WsWorkflowStartPayload["conversation_key"],
): TurnTriggerT {
  return { kind: "api", conversation_key: conversationKey };
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

export async function executeWorkflowStart(
  deps: WorkflowStartExecutionDeps,
  input: WorkflowStartExecutionInput,
): Promise<WsWorkflowStartResult> {
  const planId = input.payload.plan_id ?? `plan-${randomUUID()}`;
  const requestId = input.payload.request_id ?? `req-${randomUUID()}`;
  const scope = resolveAgentConversationScope(input.payload.conversation_key);
  const agentKey = scope.agentKey;
  const policy = resolveWorkflowPolicyService({
    policyService: deps.policyService,
    agents: deps.agents,
    agentKey,
  });
  const agentId = deps.identityScopeDal
    ? await deps.identityScopeDal.resolveAgentId(input.tenantId, agentKey)
    : undefined;
  if (deps.identityScopeDal && !agentId) {
    throw new ScopeNotFoundError(`agent '${agentKey}' not found`, {
      tenantId: input.tenantId,
      agentKey,
    });
  }

  const effectivePolicy = await policy.loadEffectiveBundle({
    tenantId: input.tenantId,
    agentId: agentId ?? undefined,
  });
  const snapshot = await policy.getOrCreateSnapshot(input.tenantId, effectivePolicy.bundle);
  const queued = await deps.engine.enqueuePlan({
    tenantId: input.tenantId,
    key: input.payload.conversation_key,
    workspaceKey: scope.workspaceKey,
    planId,
    requestId,
    steps: input.payload.steps,
    policySnapshotId: snapshot.policy_snapshot_id,
    budgets: input.payload.budgets,
    trigger: deriveWorkflowTrigger(input.payload.conversation_key),
  });

  return WsWorkflowStartResult.parse({
    job_id: queued.jobId,
    turn_id: queued.runId,
    plan_id: planId,
    request_id: requestId,
    conversation_key: input.payload.conversation_key,
    steps_count: input.payload.steps.length,
  });
}
