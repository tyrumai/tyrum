import { randomUUID } from "node:crypto";
import { convertToModelMessages, type ModelMessage, type UIMessage } from "ai";
import { TyrumUIMessage as TyrumUIMessageSchema } from "@tyrum/contracts";
import type { TyrumUIMessage } from "@tyrum/contracts";
import { coerceRecord } from "../util/coerce.js";

function toTextPart(text: string): TyrumUIMessage["parts"][number] {
  return { type: "text", text };
}

export function createTextChatMessage(input: {
  id?: string;
  role: TyrumUIMessage["role"];
  text: string;
}): TyrumUIMessage {
  return TyrumUIMessageSchema.parse({
    id: input.id ?? randomUUID(),
    role: input.role,
    parts: [toTextPart(input.text)],
  });
}

function normalizeChatParts(content: unknown): TyrumUIMessage["parts"] {
  if (typeof content === "string") {
    return [toTextPart(content)];
  }
  if (!Array.isArray(content)) {
    return [];
  }

  const parts: TyrumUIMessage["parts"] = [];
  for (const part of content) {
    const record = coerceRecord(part);
    if (!record || typeof record["type"] !== "string") continue;
    parts.push(record as TyrumUIMessage["parts"][number]);
  }
  return parts;
}

export function modelMessageToChatMessage(message: ModelMessage): TyrumUIMessage | undefined {
  if (
    message.role !== "system" &&
    message.role !== "user" &&
    message.role !== "assistant" &&
    message.role !== "tool"
  ) {
    return undefined;
  }

  return {
    id: randomUUID(),
    role: message.role,
    parts: normalizeChatParts((message as { content?: unknown }).content),
  };
}

export function modelMessagesToChatMessages(messages: readonly ModelMessage[]): TyrumUIMessage[] {
  const out: TyrumUIMessage[] = [];
  for (const message of messages) {
    const converted = modelMessageToChatMessage(message);
    if (converted) out.push(converted);
  }
  return out;
}

function normalizeModelContent(
  message: TyrumUIMessage,
): string | Array<Record<string, unknown>> | undefined {
  if (message.role === "system") {
    return message.parts
      .flatMap((part) =>
        part.type === "text" && typeof part["text"] === "string" ? [part["text"]] : [],
      )
      .join("\n\n");
  }

  const content: Array<Record<string, unknown>> = [];
  for (const part of message.parts) {
    if (part.type === "text" && typeof part["text"] === "string") {
      content.push({ type: "text", text: part["text"] });
      continue;
    }
    content.push(part as Record<string, unknown>);
  }
  return content;
}

export function chatMessageToModelMessage(message: TyrumUIMessage): ModelMessage | undefined {
  if (
    message.role !== "system" &&
    message.role !== "user" &&
    message.role !== "assistant" &&
    message.role !== "tool"
  ) {
    return undefined;
  }

  const content = normalizeModelContent(message);
  if (message.role === "system") {
    return {
      role: "system",
      content: typeof content === "string" ? content : "",
    };
  }
  return {
    role: message.role,
    content: Array.isArray(content) ? content : [toTextPart(String(content ?? ""))],
  } as ModelMessage;
}

export function chatMessagesToModelMessages(messages: readonly TyrumUIMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const message of messages) {
    const converted = chatMessageToModelMessage(message);
    if (converted) out.push(converted);
  }
  return out;
}

export async function conversationMessagesToModelMessages(
  messages: readonly TyrumUIMessage[],
): Promise<ModelMessage[]> {
  const hasUnsupportedRole = messages.some((message) => message.role === "tool");
  if (!hasUnsupportedRole) {
    try {
      return await convertToModelMessages(messages as unknown as UIMessage[]);
    } catch {
      // Intentional: malformed persisted histories should fall back to the local mapper.
      // Fall back to the local mapper for malformed persisted history.
    }
  }
  return chatMessagesToModelMessages(messages);
}

export function applyFinalAssistantReply(
  messages: readonly TyrumUIMessage[],
  reply: string,
): TyrumUIMessage[] {
  const next = messages.slice();
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const message = next[index];
    if (!message || message.role !== "assistant") continue;
    const hasTextPart = message.parts.some(
      (part) => part.type === "text" && typeof part["text"] === "string",
    );
    if (!hasTextPart && reply.length === 0) {
      return next;
    }
    const nonTextParts = message.parts.filter((part) => part.type !== "text");
    next[index] = {
      ...message,
      parts: [...nonTextParts, toTextPart(reply)],
    };
    return next;
  }

  if (reply.length === 0) return next;
  next.push(createTextChatMessage({ role: "assistant", text: reply }));
  return next;
}

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
