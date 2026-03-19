import { randomUUID } from "node:crypto";
import type { LanguageModel } from "ai";
import { type ToolLifecycleStatus, type WsEventEnvelope } from "@tyrum/contracts";
import type { ToolDescriptor } from "../tools.js";
import type { ToolResult } from "../tool-executor.js";
import { runWebFetchExtractionPass } from "../webfetch-extraction.js";
import type { AgentContextReport } from "./types.js";
import type { ToolExecutionContext, ToolSetBuilderDeps } from "./tool-set-builder-helpers.js";
import { OPERATOR_WS_AUDIENCE } from "../../../ws/audience.js";
import { enqueueWsBroadcastMessage } from "../../../ws/outbox.js";

export async function maybeExtractWebFetchResult(
  deps: Pick<ToolSetBuilderDeps, "logger">,
  input: {
    toolDesc: ToolDescriptor;
    args: unknown;
    result: ToolResult;
    model?: LanguageModel;
    toolCallId: string;
  },
): Promise<ToolResult> {
  if (input.toolDesc.id !== "webfetch" || !input.model || input.result.error) {
    return input.result;
  }

  const rawContent = input.result.provenance?.content ?? input.result.output;
  const extraction = await runWebFetchExtractionPass({
    args: input.args,
    rawContent,
    model: input.model,
    toolCallId: input.toolCallId,
    logger: deps.logger,
  });
  if (!extraction) return input.result;

  return {
    ...input.result,
    output: extraction.output,
    provenance: extraction.provenance,
  };
}

export async function syncToolLifecycle(
  deps: Pick<
    ToolSetBuilderDeps,
    "sessionDal" | "tenantId" | "agentId" | "workspaceId" | "wsEventDb" | "logger"
  >,
  input: {
    context: ToolExecutionContext;
    toolCallId: string;
    toolId: string;
    status: ToolLifecycleStatus;
    summary: string;
    error?: string;
    durationMs?: number;
  },
): Promise<void> {
  const updatedAt = new Date().toISOString();

  if (!deps.wsEventDb) return;

  const event: WsEventEnvelope = {
    event_id: randomUUID(),
    type: "tool.lifecycle",
    occurred_at: updatedAt,
    scope: { kind: "agent", agent_id: deps.agentId },
    payload: {
      session_id: input.context.sessionId,
      thread_id: input.context.threadId,
      tool_call_id: input.toolCallId,
      tool_id: input.toolId,
      status: input.status,
      summary: input.summary,
      duration_ms: input.durationMs,
      error: input.error,
      run_id: input.context.execution?.runId,
      agent_id: deps.agentId,
      workspace_id: deps.workspaceId,
      channel: input.context.channel,
    },
  };
  try {
    await enqueueWsBroadcastMessage(deps.wsEventDb, deps.tenantId, event, OPERATOR_WS_AUDIENCE);
  } catch (error) {
    deps.logger.info("tool.lifecycle_emit_failed", {
      tool_id: input.toolId,
      tool_call_id: input.toolCallId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function redactPluginToolResult(
  deps: Pick<ToolSetBuilderDeps, "redactionEngine">,
  pluginResult: unknown,
  result: ToolResult,
): ToolResult {
  if (!pluginResult || !deps.redactionEngine) {
    return result;
  }

  const redact = (text: string): string => deps.redactionEngine?.redactText(text).redacted ?? text;
  return {
    ...result,
    output: redact(result.output),
    error: result.error ? redact(result.error) : result.error,
    provenance: result.provenance
      ? { ...result.provenance, content: redact(result.provenance.content) }
      : result.provenance,
  };
}

export function recordToolResultContext(
  contextReport: AgentContextReport,
  input: {
    toolCallId: string;
    toolId: string;
    content: string;
    result: ToolResult;
  },
): void {
  contextReport.tool_calls.push({
    tool_call_id: input.toolCallId,
    tool_id: input.toolId,
    injected_chars: input.content.length,
  });

  if (input.result.meta?.kind !== "fs.read") {
    return;
  }

  contextReport.injected_files.push({
    tool_call_id: input.toolCallId,
    path: input.result.meta.path,
    offset: input.result.meta.offset,
    limit: input.result.meta.limit,
    raw_chars: input.result.meta.raw_chars,
    selected_chars: input.result.meta.selected_chars,
    injected_chars: input.content.length,
    truncated: input.result.meta.truncated,
    truncation_marker: input.result.meta.truncation_marker,
  });
}
