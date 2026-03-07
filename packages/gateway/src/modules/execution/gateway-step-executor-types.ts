import type { Decision as DecisionT } from "@tyrum/schemas";
import type { ModelMessage } from "ai";

export const DEFAULT_TOOL_APPROVAL_WAIT_MS = 120_000;

export const SUPPORTED_LLM_TOOL_IDS = new Set<string>(["tool.exec", "tool.http.fetch"]);

export type ToolBudgetState = {
  toolCallsUsed: number;
  countedToolCallIds: Set<string>;
  limitExceededError?: string;
};

export type ToolApprovalResumeState = {
  approval_id: string;
  messages: ModelMessage[];
  steps_used?: number;
  tool_calls_used?: number;
  counted_tool_call_ids?: string[];
};

export type ToolCallPolicyState = {
  toolId: string;
  toolCallId: string;
  args: unknown;
  matchTarget: string;
  decision: DecisionT;
  shouldRequireApproval: boolean;
};

export function parseProviderModelId(model: string): { providerId: string; modelId: string } {
  const trimmed = model.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash >= trimmed.length - 1) {
    throw new Error(`invalid model '${model}' (expected provider/model)`);
  }
  return { providerId: trimmed.slice(0, slash), modelId: trimmed.slice(slash + 1) };
}

export function maybeTruncateText(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  if (maxBytes <= 0) return { text: "", truncated: true };
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) return { text, truncated: false };
  const sliced = bytes.subarray(0, maxBytes);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  return { text: decoder.decode(sliced), truncated: true };
}

export function deriveAgentIdFromKey(key: string): string {
  if (!key.startsWith("agent:")) return "default";
  const parts = key.split(":");
  const agentId = parts.length > 1 ? parts[1] : undefined;
  const trimmed = agentId?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : "default";
}

export function extractToolErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim().length > 0) return err;
  try {
    return JSON.stringify(err);
  } catch (stringifyErr) {
    // Intentional: JSON.stringify can throw on circular structures.
    void stringifyErr;
    return String(err);
  }
}
