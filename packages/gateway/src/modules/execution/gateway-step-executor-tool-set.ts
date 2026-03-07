import type { ActionPrimitive as ActionPrimitiveT } from "@tyrum/schemas";
import type { GatewayContainer } from "../../container.js";
import type { ModelMessage, Tool, ToolExecutionOptions, ToolSet } from "ai";
import { jsonSchema, tool as aiTool } from "ai";
import { buildModelToolNameMap, registerModelTool } from "../agent/tools.js";
import { canonicalizeToolMatchTarget } from "../policy/match-target.js";
import type { SecretProvider } from "../secret/provider.js";
import { coerceRecord } from "../util/coerce.js";
import { acquireWorkspaceLease, releaseWorkspaceLease } from "../workspace/lease.js";
import { hasToolResult } from "../ai-sdk/message-utils.js";
import type { StepExecutionContext, StepExecutor } from "./engine.js";
import {
  deriveAgentIdFromKey,
  type ToolBudgetState,
  type ToolCallPolicyState,
} from "./gateway-step-executor-types.js";
import {
  evaluateToolCallDecision,
  resolveSecretScopesFromArgs,
} from "./gateway-step-executor-helpers.js";

export function buildToolSet(input: {
  planId: string;
  stepIndex: number;
  timeoutMs: number;
  allowedToolIds: readonly string[];
  maxToolCalls: number;
  toolExecutor: StepExecutor;
  toolBudget: ToolBudgetState;
  executionContext: StepExecutionContext;
  container: GatewayContainer;
  secretProvider?: SecretProvider;
  toolCallPolicyStates: Map<string, ToolCallPolicyState>;
}): ToolSet {
  const allowed = new Set(input.allowedToolIds);
  const tools: Record<string, Tool> = {};
  const modelToolNames = buildModelToolNameMap(Array.from(allowed));

  const accountToolCall = (toolCallId: string): void => {
    const id = toolCallId.trim();
    if (id.length === 0) return;
    if (input.toolBudget.countedToolCallIds.has(id)) return;

    input.toolBudget.countedToolCallIds.add(id);
    input.toolBudget.toolCallsUsed += 1;
    if (input.toolBudget.toolCallsUsed > input.maxToolCalls) {
      const message = `tool-call limit exceeded (max=${String(input.maxToolCalls)})`;
      input.toolBudget.limitExceededError = message;
      throw new Error(message);
    }
  };

  let cachedApproval:
    | { status: string; context: unknown; reason?: string | null }
    | null
    | undefined;
  const loadApproval = async (): Promise<typeof cachedApproval> => {
    if (cachedApproval !== undefined) return cachedApproval;
    const approvalId = input.executionContext.approvalId;
    if (!approvalId) {
      cachedApproval = null;
      return cachedApproval;
    }
    const row = await input.container.db.get<{
      status: string;
      context_json: string;
      resolution_json: string | null;
    }>(
      "SELECT status, context_json, resolution_json FROM approvals WHERE tenant_id = ? AND approval_id = ?",
      [input.executionContext.tenantId, approvalId],
    );
    if (!row) {
      cachedApproval = null;
      return cachedApproval;
    }
    let context: unknown = {};
    try {
      context = JSON.parse(row.context_json) as unknown;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      input.container.logger?.warn("execution.approval_context_parse_failed", {
        approval_id: approvalId,
        error: message,
      });
      context = {};
    }
    const resolution = row.resolution_json
      ? ((): { reason?: string } | undefined => {
          try {
            return JSON.parse(row.resolution_json) as { reason?: string };
          } catch {
            return undefined;
          }
        })()
      : undefined;
    cachedApproval = { status: row.status, context, reason: resolution?.reason ?? null };
    return cachedApproval;
  };

  const resolveToolCallPolicyState = async (input2: {
    toolId: string;
    toolCallId: string;
    args: unknown;
  }): Promise<ToolCallPolicyState> => {
    const existing = input.toolCallPolicyStates.get(input2.toolCallId);
    if (existing && existing.toolId === input2.toolId) {
      return existing;
    }

    const matchTarget = canonicalizeToolMatchTarget(input2.toolId, input2.args, undefined);
    const policySnapshotId = input.executionContext.policySnapshotId;
    const url =
      input2.toolId === "tool.http.fetch"
        ? (() => {
            const rec = coerceRecord(input2.args) ?? {};
            return typeof rec["url"] === "string" ? rec["url"] : undefined;
          })()
        : undefined;
    const secretScopes = policySnapshotId
      ? await resolveSecretScopesFromArgs(input2.args, input.secretProvider)
      : [];

    const decision = policySnapshotId
      ? await evaluateToolCallDecision({
          container: input.container,
          tenantId: input.executionContext.tenantId,
          policySnapshotId,
          agentId: deriveAgentIdFromKey(input.executionContext.key),
          workspaceId: input.executionContext.workspaceId,
          toolId: input2.toolId,
          toolMatchTarget: matchTarget,
          url,
          secretScopes,
        })
      : ("allow" as const);

    const shouldRequireApproval = decision === "require_approval";

    const state: ToolCallPolicyState = {
      toolId: input2.toolId,
      toolCallId: input2.toolCallId,
      args: input2.args,
      matchTarget,
      decision,
      shouldRequireApproval,
    };

    input.toolCallPolicyStates.set(input2.toolCallId, state);
    return state;
  };

  const runTool = async (action: ActionPrimitiveT, toolCallId: string): Promise<unknown> => {
    const startedAtMs = Date.now();
    const totalBudgetMs = Math.max(1, input.timeoutMs);
    const needsWorkspaceLease = action.type === "CLI";
    const workspaceLeaseOwner = `llm-step:${input.executionContext.attemptId}:${toolCallId}`;

    if (needsWorkspaceLease) {
      const acquired = await acquireWorkspaceLease(input.container.db, {
        tenantId: input.executionContext.tenantId,
        workspaceId: input.executionContext.workspaceId,
        owner: workspaceLeaseOwner,
        ttlMs: Math.max(30_000, totalBudgetMs + 10_000),
        waitMs: totalBudgetMs,
      });
      if (!acquired) {
        throw new Error("workspace is busy");
      }
    }

    const waitedMs = Math.max(0, Date.now() - startedAtMs);
    const remainingMs = Math.max(1, totalBudgetMs - waitedMs);

    try {
      const res = await input.toolExecutor.execute(
        action,
        input.planId,
        input.stepIndex,
        remainingMs,
        input.executionContext,
      );
      if (!res.success) {
        throw new Error(res.error || "tool execution failed");
      }
      return res.result ?? res.evidence ?? null;
    } finally {
      if (needsWorkspaceLease) {
        await releaseWorkspaceLease(input.container.db, {
          tenantId: input.executionContext.tenantId,
          workspaceId: input.executionContext.workspaceId,
          owner: workspaceLeaseOwner,
        }).catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          input.container.logger.warn("execution.workspace_lease_release_failed", {
            workspace_id: input.executionContext.workspaceId,
            owner: workspaceLeaseOwner,
            error: message,
          });
        });
      }
    }
  };

  const matchesApprovedToolContext = (input2: {
    context: unknown;
    toolId: string;
    toolCallId: string;
    toolMatchTarget: string;
  }): boolean => {
    const ctx = coerceRecord(input2.context);
    return (
      ctx?.["source"] === "llm-step-tool-execution" &&
      ctx["tool_id"] === input2.toolId &&
      ctx["tool_call_id"] === input2.toolCallId &&
      ctx["tool_match_target"] === input2.toolMatchTarget
    );
  };

  const parseTimeoutMsArg = (record: Record<string, unknown>): number | undefined => {
    const raw = record["timeout_ms"];
    if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
    return Math.max(1, Math.floor(raw));
  };

  const resolveToolCallId = (options: ToolExecutionOptions): string =>
    typeof options.toolCallId === "string" && options.toolCallId.trim().length > 0
      ? options.toolCallId.trim()
      : "tc-unknown";

  const createPolicyAwareTool = (input2: {
    toolId: "tool.exec" | "tool.http.fetch";
    description: string;
    inputSchema: Record<string, unknown>;
    toAction: (args: Record<string, unknown>) => ActionPrimitiveT;
  }): Tool =>
    aiTool({
      description: input2.description,
      inputSchema: jsonSchema(input2.inputSchema),
      needsApproval: async (
        args: unknown,
        options: { toolCallId: string; messages: ModelMessage[]; experimental_context?: unknown },
      ): Promise<boolean> => {
        accountToolCall(options.toolCallId);
        const state = await resolveToolCallPolicyState({
          toolId: input2.toolId,
          toolCallId: options.toolCallId,
          args,
        });

        if (!state.shouldRequireApproval) {
          return false;
        }

        const approval = await loadApproval();
        if (approval && approval.status !== "pending") {
          const matches = matchesApprovedToolContext({
            context: approval.context,
            toolId: input2.toolId,
            toolCallId: options.toolCallId,
            toolMatchTarget: state.matchTarget,
          });
          if (matches && !hasToolResult(options.messages, options.toolCallId)) {
            return false;
          }
        }

        return true;
      },
      execute: async (args: unknown, options: ToolExecutionOptions) => {
        const toolCallId = resolveToolCallId(options);

        accountToolCall(toolCallId);
        const state = await resolveToolCallPolicyState({
          toolId: input2.toolId,
          toolCallId,
          args,
        });

        if (state.decision === "deny") {
          throw new Error(`policy denied tool execution for '${input2.toolId}'`);
        }

        if (state.shouldRequireApproval) {
          const approval = await loadApproval();
          const approved = approval?.status === "approved";
          const matches = matchesApprovedToolContext({
            context: approval?.context,
            toolId: input2.toolId,
            toolCallId,
            toolMatchTarget: state.matchTarget,
          });
          if (!approved || !matches) {
            throw new Error(`tool execution not approved for '${input2.toolId}'`);
          }
        }

        const record = coerceRecord(args) ?? {};
        return await runTool(input2.toAction(record), toolCallId);
      },
    });

  if (allowed.has("tool.exec")) {
    const modelTool = createPolicyAwareTool({
      toolId: "tool.exec",
      description: "Execute a shell command in the workspace sandbox.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string" },
          cwd: { type: "string" },
          timeout_ms: { type: "number" },
        },
        required: ["command"],
        additionalProperties: true,
      },
      toAction: (record) => {
        const command = typeof record["command"] === "string" ? record["command"] : "";
        const cwd = typeof record["cwd"] === "string" ? record["cwd"] : undefined;
        const timeoutMs = parseTimeoutMsArg(record);

        return {
          type: "CLI",
          args: {
            cmd: "sh",
            args: ["-c", command],
            ...(cwd ? { cwd } : undefined),
            ...(timeoutMs ? { timeout_ms: timeoutMs } : undefined),
          },
        };
      },
    });
    registerModelTool(tools, "tool.exec", modelTool, modelToolNames);
  }

  if (allowed.has("tool.http.fetch")) {
    const modelTool = createPolicyAwareTool({
      toolId: "tool.http.fetch",
      description: "Fetch an HTTP URL (SSRF protected, output capped).",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          method: { type: "string" },
          headers: { type: "object" },
          body: { type: "string" },
          timeout_ms: { type: "number" },
        },
        required: ["url"],
        additionalProperties: true,
      },
      toAction: (record) => {
        const url = typeof record["url"] === "string" ? record["url"] : "";
        const method = typeof record["method"] === "string" ? record["method"] : undefined;
        const headers = coerceRecord(record["headers"]);
        const body = typeof record["body"] === "string" ? record["body"] : undefined;
        const timeoutMs = parseTimeoutMsArg(record);

        return {
          type: "Http",
          args: {
            url,
            ...(method ? { method } : undefined),
            ...(headers ? { headers } : undefined),
            ...(body ? { body } : undefined),
            ...(timeoutMs ? { timeout_ms: timeoutMs } : undefined),
          },
        };
      },
    });
    registerModelTool(tools, "tool.http.fetch", modelTool, modelToolNames);
  }

  return tools;
}
