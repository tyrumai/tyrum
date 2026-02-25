import type { ModelMessage } from "ai";
import { coerceRecord } from "../util/coerce.js";

export function coerceModelMessages(value: unknown): ModelMessage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: ModelMessage[] = [];
  for (const entry of value) {
    const record = coerceRecord(entry);
    if (!record) return undefined;
    if (typeof record["role"] !== "string") return undefined;
    out.push(entry as ModelMessage);
  }
  return out;
}

export function hasToolApprovalResponse(
  messages: readonly ModelMessage[],
  approvalId: string,
): boolean {
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    if (message.role !== "tool") continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const record = coerceRecord(part);
      if (!record) continue;
      if (record["type"] !== "tool-approval-response") continue;
      if (record["approvalId"] === approvalId) return true;
    }
  }
  return false;
}

export function hasToolResult(messages: readonly ModelMessage[], toolCallId: string): boolean {
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    if (message.role !== "tool") continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const record = coerceRecord(part);
      if (!record) continue;
      if (record["type"] !== "tool-result") continue;
      if (record["toolCallId"] === toolCallId) return true;
    }
  }
  return false;
}

export function appendToolApprovalResponseMessage(
  messages: readonly ModelMessage[],
  input: { approvalId: string; approved: boolean; reason?: string },
): ModelMessage[] {
  if (hasToolApprovalResponse(messages, input.approvalId)) {
    return messages.slice() as ModelMessage[];
  }

  const approvalPart: Record<string, unknown> = {
    type: "tool-approval-response",
    approvalId: input.approvalId,
    approved: input.approved,
  };
  if (input.reason && input.reason.trim().length > 0) {
    approvalPart["reason"] = input.reason.trim();
  }

  const next = messages.slice() as ModelMessage[];
  const last = next.at(-1);
  if (last && last.role === "tool" && Array.isArray((last as { content?: unknown }).content)) {
    const updated = {
      ...last,
      content: [...((last as { content: unknown[] }).content ?? []), approvalPart],
    } as unknown as ModelMessage;
    next[next.length - 1] = updated;
    return next;
  }

  next.push({ role: "tool", content: [approvalPart] } as unknown as ModelMessage);
  return next;
}

export function countAssistantMessages(messages: readonly ModelMessage[]): number {
  let count = 0;
  for (const message of messages) {
    if (message && typeof message === "object" && message.role === "assistant") {
      count += 1;
    }
  }
  return count;
}
