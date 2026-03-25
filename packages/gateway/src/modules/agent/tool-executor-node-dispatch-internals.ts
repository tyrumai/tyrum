import { NodeInventoryResponse } from "@tyrum/contracts";
import type { ArtifactStore } from "../artifact/store.js";
import { toolIdForCapabilityDescriptor } from "../node/capability-tool-id.js";
import type { WorkspaceLeaseConfig } from "./tool-executor-shared.js";

type SyntheticExecutionScopeContext = {
  artifactStore?: ArtifactStore;
  workspaceLease?: WorkspaceLeaseConfig;
};

export function stripNodeListControlState(
  payload: ReturnType<typeof NodeInventoryResponse.parse>,
  filters: { capability?: string; dispatchableOnly: boolean; key?: string; lane?: string },
) {
  return {
    status: payload.status,
    generated_at: payload.generated_at,
    ...(payload.conversation_key ? { conversation_key: payload.conversation_key } : {}),
    applied_filters: {
      dispatchable_only: filters.dispatchableOnly,
      ...(filters.capability ? { capability: filters.capability } : {}),
      ...(filters.key ? { conversation_key: filters.key } : {}),
      ...(filters.lane ? { lane: filters.lane } : {}),
    },
    nodes: payload.nodes.map((node) => ({
      node_id: node.node_id,
      ...(node.label ? { label: node.label } : {}),
      ...(node.mode ? { mode: node.mode } : {}),
      ...(node.version ? { version: node.version } : {}),
      connected: node.connected,
      paired_status: node.paired_status,
      attached_to_requested_conversation: node.attached_to_requested_conversation,
      ...(node.last_seen_at ? { last_seen_at: node.last_seen_at } : {}),
      ...(node.device ? { device: node.device } : {}),
      ...(node.last_tyrum_interaction_at
        ? { last_tyrum_interaction_at: node.last_tyrum_interaction_at }
        : {}),
      ...(filters.capability
        ? {
            matched_capabilities: node.capabilities
              .filter((capabilitySummary) => capabilitySummary.capability === filters.capability)
              .map((capabilitySummary) => capabilitySummary.capability),
          }
        : {}),
      capabilities: node.capabilities.map((capabilitySummary) => ({
        capability: capabilitySummary.capability,
        capability_version: capabilitySummary.capability_version,
        ...(capabilitySummary.description ? { description: capabilitySummary.description } : {}),
        connected: capabilitySummary.connected,
        ready: capabilitySummary.ready,
        paired: capabilitySummary.paired,
        dispatchable: capabilitySummary.dispatchable,
        supported_action_count: capabilitySummary.supported_action_count,
        enabled_action_count: capabilitySummary.enabled_action_count,
        available_action_count: capabilitySummary.available_action_count,
        unknown_action_count: capabilitySummary.unknown_action_count,
      })),
    })),
  };
}

export async function ensureSyntheticExecutionScope(
  context: SyntheticExecutionScopeContext,
  input: {
    nodeId: string;
    capabilityId: string;
    runId: string;
    stepId: string;
    attemptId: string;
    key?: string;
    lane?: string;
  },
): Promise<boolean> {
  const lease = context.workspaceLease;
  const db = lease?.db;
  if (!db || !lease) return false;
  if (!context.artifactStore) return false;
  if (!lease.agentId?.trim() || !lease.workspaceId.trim()) return false;

  const agent = await db.get<{ agent_id: string }>(
    "SELECT agent_id FROM agents WHERE tenant_id = ? AND agent_id = ?",
    [lease.tenantId, lease.agentId],
  );
  if (!agent) return false;

  const workspace = await db.get<{ workspace_id: string }>(
    "SELECT workspace_id FROM workspaces WHERE tenant_id = ? AND workspace_id = ?",
    [lease.tenantId, lease.workspaceId],
  );
  if (!workspace) return false;

  const key = input.key?.trim() || `node:${input.nodeId}`;
  const lane = input.lane?.trim() || "main";
  const toolId = toolIdForCapabilityDescriptor(input.capabilityId);
  const existingRun = await db.get<{ run_id: string }>(
    "SELECT run_id FROM execution_runs WHERE tenant_id = ? AND run_id = ?",
    [lease.tenantId, input.runId],
  );
  if (existingRun) return true;

  const jobId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO execution_jobs (
         tenant_id,
         job_id,
         agent_id,
         workspace_id,
         key,
         lane,
         status,
         trigger_json,
         input_json,
         latest_run_id
       )
       VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
      [
        lease.tenantId,
        jobId,
        lease.agentId,
        lease.workspaceId,
        key,
        lane,
        JSON.stringify({
          kind: "manual",
          conversation_key: key,
          metadata: {
            source: toolId,
            synthetic: true,
            node_id: input.nodeId,
          },
        }),
        JSON.stringify({ node_id: input.nodeId }),
        input.runId,
      ],
    );

    await tx.run(
      `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt)
       VALUES (?, ?, ?, ?, ?, 'running', 1)`,
      [lease.tenantId, input.runId, jobId, key, lane],
    );

    await tx.run(
      `INSERT INTO execution_steps (
         tenant_id,
         step_id,
         run_id,
         step_index,
         status,
         action_json,
         max_attempts
       )
       VALUES (?, ?, ?, 0, 'running', ?, 1)`,
      [
        lease.tenantId,
        input.stepId,
        input.runId,
        JSON.stringify({ type: "Desktop", args: { op: "synthetic" } }),
      ],
    );

    await tx.run(
      `INSERT INTO execution_attempts (
         tenant_id,
         attempt_id,
         step_id,
         attempt,
         status,
         artifacts_json,
         metadata_json
       )
       VALUES (?, ?, ?, 1, 'running', '[]', ?)`,
      [
        lease.tenantId,
        input.attemptId,
        input.stepId,
        JSON.stringify({
          executor: {
            kind: "node",
            node_id: input.nodeId,
          },
        }),
      ],
    );
  });
  return true;
}
