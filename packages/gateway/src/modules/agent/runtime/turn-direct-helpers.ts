import type { ModelMessage } from "ai";
import type { SecretHandle as SecretHandleT, WorkScope } from "@tyrum/contracts";
import type { ToolCallPolicyState } from "./tool-set-builder.js";
import { ToolExecutionApprovalRequiredError, type ResolvedAgentTurnInput } from "./turn-helpers.js";
import type { SessionRow } from "../session-dal.js";
import { coerceRecord } from "../../util/coerce.js";
import type { GatewayContainer } from "../../../container.js";
import type { SecretProvider } from "../../secret/provider.js";

export async function handleStatusQuery(
  container: GatewayContainer,
  workScope: WorkScope,
): Promise<string> {
  try {
    const { WorkboardDal } = await import("../../workboard/dal.js");
    const workboard = new WorkboardDal(container.db, container.redactionEngine);
    const { items } = await workboard.listItems({
      scope: workScope,
      statuses: ["doing", "blocked", "ready", "backlog"],
      limit: 50,
    });
    if (items.length === 0) {
      return "WorkBoard status: no active work items.";
    }
    const lines: string[] = ["WorkBoard status:"];
    for (const item of items) {
      lines.push(`- [${item.status}] ${item.work_item_id} — ${item.title}`);
      const tasks = await workboard.listTasks({
        scope: workScope,
        work_item_id: item.work_item_id,
      });
      for (const task of tasks.slice(0, 10)) {
        lines.push(`  - task ${task.task_id} (${task.status}) profile=${task.execution_profile}`);
      }
    }
    return lines.join("\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    container.logger.warn("workboard.status_query_failed", { error: message });
    return "WorkBoard status is unavailable.";
  }
}

export async function maybeStoreToolApprovalArgsHandle(
  secretProvider: SecretProvider | undefined,
  agentId: string,
  input: {
    toolId: string;
    toolCallId: string;
    args: unknown;
  },
): Promise<SecretHandleT | undefined> {
  if (!secretProvider) return undefined;

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input.args);
  } catch {
    // Intentional: tool approval arg persistence is best-effort; args may be non-serializable.
    serialized = undefined;
  }
  if (typeof serialized !== "string") return undefined;

  try {
    return await secretProvider.store(
      `tool_approval:${agentId}:${input.toolId}:${input.toolCallId}:args`,
      serialized,
    );
  } catch {
    // Intentional: tool approval arg persistence is best-effort; continue without stored args handle.
    return undefined;
  }
}

export async function throwToolApprovalError(
  deps: {
    approvalWaitMs: number;
    secretProvider?: SecretProvider;
    agentId: string;
  },
  approvalPart: unknown,
  toolCallPolicyStates: Map<string, ToolCallPolicyState>,
  session: SessionRow,
  resolved: ResolvedAgentTurnInput,
  usedTools: Set<string>,
  memoryWriteState: { wrote: boolean },
  stepsUsedAfterCall: number,
  messages: ModelMessage[],
  responseMessages: readonly ModelMessage[],
): Promise<never> {
  const record = coerceRecord(approvalPart);
  const approvalId = typeof record?.["approvalId"] === "string" ? record["approvalId"].trim() : "";
  const toolCall = coerceRecord(record?.["toolCall"]);

  const toolCallId =
    typeof toolCall?.["toolCallId"] === "string" ? toolCall["toolCallId"].trim() : "";
  const toolName = typeof toolCall?.["toolName"] === "string" ? toolCall["toolName"].trim() : "";
  const toolArgs = toolCall ? toolCall["input"] : undefined;

  if (!approvalId || !toolCallId || !toolName) {
    throw new Error("tool approval request missing required fields");
  }

  const state = toolCallPolicyStates.get(toolCallId);
  if (!state) {
    throw new Error(`tool approval request missing policy state for tool_call_id=${toolCallId}`);
  }

  const resumeMessages = [...messages, ...responseMessages];

  const expiresAt = new Date(Date.now() + deps.approvalWaitMs).toISOString();

  const toolArgsHandle = await maybeStoreToolApprovalArgsHandle(deps.secretProvider, deps.agentId, {
    toolId: state.toolDesc.id,
    toolCallId,
    args: state.args ?? toolArgs,
  });

  const policyContext = {
    policy_snapshot_id: state.policySnapshotId,
    agent_id: session.agent_id,
    workspace_id: session.workspace_id,
    suggested_overrides: state.suggestedOverrides,
    applied_override_ids: state.appliedOverrideIds,
  };

  throw new ToolExecutionApprovalRequiredError({
    kind: "workflow_step",
    prompt: `Approve execution of '${state.toolDesc.id}'`,
    detail: `approval required for tool '${state.toolDesc.id}'`,
    expiresAt,
    context: {
      source: "agent-tool-execution",
      tool_id: state.toolDesc.id,
      tool_call_id: toolCallId,
      tool_match_target: state.matchTarget,
      approval_step_index: state.approvalStepIndex ?? 0,
      args: state.args ?? toolArgs,
      session_id: session.session_id,
      channel: resolved.channel,
      thread_id: resolved.thread_id,
      policy: policyContext,
      ai_sdk: {
        approval_id: approvalId,
        messages: resumeMessages,
        used_tools: Array.from(usedTools),
        memory_written: memoryWriteState.wrote,
        steps_used: stepsUsedAfterCall,
        tool_args_handle: toolArgsHandle,
      },
    },
  });
}
