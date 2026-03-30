import { getToolName, isTextUIPart, isToolUIPart, type UIMessage, validateUIMessages } from "ai";
import type { TyrumUIMessage, TyrumUIMessagePart, WsResponseEnvelope } from "@tyrum/contracts";
export {
  WsConversationArchiveRequest as ChatConversationArchiveRequest,
  WsConversationCreateRequest as ChatConversationCreateRequest,
  WsConversationDeleteRequest as ChatConversationDeleteRequest,
  WsConversationGetRequest as ChatConversationGetRequest,
  WsConversationListRequest as ChatConversationListRequest,
  WsConversationQueueModeSetRequest as ChatConversationQueueModeSetRequest,
  WsConversationReconnectRequest as ChatConversationReconnectRequest,
  WsConversationSendRequest as ChatConversationSendRequest,
} from "@tyrum/contracts";
import type { ConnectedClient } from "../connection-manager.js";
import { errorResponse } from "./helpers.js";
import type { ProtocolRequestEnvelope } from "./types.js";
import { normalizeToolMessagesForChatHistory } from "../../app/modules/ai-sdk/message-utils.js";
import { coerceRecord } from "../../app/modules/util/coerce.js";
export function toStoredChatMessages(messages: readonly TyrumUIMessage[]): TyrumUIMessage[] {
  const storedMessages: TyrumUIMessage[] = [];
  for (const message of canonicalizeUiMessages(messages)) {
    const parts: TyrumUIMessage["parts"] = [];
    for (const part of message.parts) {
      const record = coerceRecord(part);
      if (!record || typeof record["type"] !== "string") {
        continue;
      }
      parts.push(record as TyrumUIMessage["parts"][number]);
    }
    const metadata =
      typeof message.metadata === "object" && message.metadata !== null
        ? (message.metadata as Record<string, unknown>)
        : undefined;
    storedMessages.push({
      id: message.id,
      role: message.role,
      parts,
      ...(metadata === undefined ? {} : { metadata }),
    });
  }
  return storedMessages;
}

type ApprovalDataPart = {
  type: "data-approval-state";
  data: {
    approval_id: string;
    approved?: boolean;
    state: "approved" | "cancelled" | "denied" | "expired" | "pending";
    tool_call_id: string;
    tool_name: string;
  };
};

function normalizeApprovalState(input: {
  approvalApproved: boolean | undefined;
  toolState: string | undefined;
}): ApprovalDataPart["data"]["state"] {
  if (input.toolState === "output-denied" || input.approvalApproved === false) {
    return "denied";
  }
  if (input.approvalApproved === true) {
    return "approved";
  }
  return "pending";
}

function coerceApprovalDataPart(part: TyrumUIMessagePart): ApprovalDataPart | null {
  if (part.type !== "data-approval-state") {
    return null;
  }
  const record = coerceRecord(part["data"]);
  const approvalId =
    typeof record?.["approval_id"] === "string" ? record["approval_id"].trim() : "";
  const toolCallId =
    typeof record?.["tool_call_id"] === "string" ? record["tool_call_id"].trim() : "";
  const toolName = typeof record?.["tool_name"] === "string" ? record["tool_name"].trim() : "";
  const state = record?.["state"];
  if (
    !approvalId ||
    !toolCallId ||
    !toolName ||
    (state !== "approved" &&
      state !== "cancelled" &&
      state !== "denied" &&
      state !== "expired" &&
      state !== "pending")
  ) {
    return null;
  }

  const approvedRaw = record?.["approved"];
  const approved = typeof approvedRaw === "boolean" ? approvedRaw : undefined;
  return {
    type: "data-approval-state",
    data: {
      approval_id: approvalId,
      ...(approved === undefined ? {} : { approved }),
      state,
      tool_call_id: toolCallId,
      tool_name: toolName,
    },
  };
}

function toApprovalDataPart(part: TyrumUIMessagePart): ApprovalDataPart | null {
  const maybeToolPart = part as UIMessage["parts"][number];
  if (!isToolUIPart(maybeToolPart)) {
    return coerceApprovalDataPart(part);
  }

  const toolPart = maybeToolPart;
  const approval = "approval" in toolPart ? toolPart.approval : undefined;
  const approvalId = approval?.id?.trim();
  if (!approvalId) {
    return null;
  }

  const approvalApproved = approval?.approved;
  return {
    type: "data-approval-state",
    data: {
      approval_id: approvalId,
      ...(typeof approvalApproved === "boolean" ? { approved: approvalApproved } : {}),
      state: normalizeApprovalState({
        approvalApproved,
        toolState: typeof toolPart.state === "string" ? toolPart.state : undefined,
      }),
      tool_call_id: toolPart.toolCallId,
      tool_name: getToolName(toolPart),
    },
  };
}

function canonicalizeUiParts(parts: readonly TyrumUIMessagePart[]): TyrumUIMessage["parts"] {
  const normalized: TyrumUIMessage["parts"] = [];
  const approvalIds = new Set<string>();

  for (const part of parts) {
    normalized.push({ ...part });
    const approvalPart = toApprovalDataPart(part);
    if (!approvalPart || approvalIds.has(approvalPart.data.approval_id)) {
      continue;
    }
    approvalIds.add(approvalPart.data.approval_id);
    normalized.push(approvalPart as TyrumUIMessage["parts"][number]);
  }

  return normalized;
}

export function canonicalizeUiMessage(message: TyrumUIMessage): TyrumUIMessage {
  return {
    ...message,
    parts: canonicalizeUiParts(message.parts),
  };
}

export function canonicalizeUiMessages(messages: readonly TyrumUIMessage[]): TyrumUIMessage[] {
  return normalizeToolMessagesForChatHistory(messages).map((message) =>
    canonicalizeUiMessage(message),
  );
}

export function toPreview(
  message: { role: string; content: string } | null,
): { role: "assistant" | "system" | "user"; text: string } | null {
  if (!message) return null;
  if (message.role !== "assistant" && message.role !== "system" && message.role !== "user") {
    return null;
  }
  return {
    role: message.role,
    text: message.content,
  };
}

export function toConversationSummary(input: {
  agentKey: string;
  accountKey?: string;
  archived?: boolean;
  channel: string;
  containerKind?: string;
  createdAt: string;
  messages: TyrumUIMessage[];
  conversationId: string;
  threadId: string;
  title: string;
  updatedAt: string;
}): {
  agent_key: string;
  account_key?: string;
  archived: boolean;
  channel: string;
  container_kind?: string;
  created_at: string;
  last_message: { role: "assistant" | "system" | "user"; text: string } | null;
  message_count: number;
  conversation_id: string;
  thread_id: string;
  title: string;
  updated_at: string;
} {
  let lastMessage: { role: string; content: string } | null = null;
  for (const message of input.messages) {
    const textPart = message.parts.find(
      (part: TyrumUIMessagePart) =>
        part.type === "text" && typeof part["text"] === "string" && part["text"].trim().length > 0,
    );
    if (!textPart) continue;
    lastMessage = {
      role: message.role,
      content: String(textPart["text"]),
    };
  }

  return {
    agent_key: input.agentKey,
    ...(input.accountKey ? { account_key: input.accountKey } : {}),
    archived: input.archived ?? false,
    channel: input.channel,
    ...(input.containerKind ? { container_kind: input.containerKind } : {}),
    created_at: input.createdAt,
    last_message: toPreview(lastMessage),
    message_count: input.messages.length,
    conversation_id: input.conversationId,
    thread_id: input.threadId,
    title: input.title,
    updated_at: input.updatedAt,
  };
}

function extractUserText(message: UIMessage): string {
  return message.parts
    .filter((part) => isTextUIPart(part))
    .map((part) => part.text.trim())
    .filter((part) => part.length > 0)
    .join("\n\n")
    .trim();
}

function cloneUserParts(message: UIMessage): TyrumUIMessagePart[] {
  return structuredClone(message.parts) as TyrumUIMessagePart[];
}

function hasUserTurnContent(message: UIMessage): boolean {
  if (extractUserText(message).length > 0) {
    return true;
  }

  return message.parts.some(
    (part) =>
      part.type === "file" && typeof part["url"] === "string" && part["url"].trim().length > 0,
  );
}

export async function validateSubmittedTurnMessages(
  messages: unknown[] | undefined,
): Promise<UIMessage[]> {
  return await validateUIMessages({
    messages: messages ?? [],
  });
}

export function splitMessagesForTurn(
  messages: UIMessage[],
  trigger: "submit-message" | "regenerate-message",
): {
  originalMessages: UIMessage[];
  previousMessages: UIMessage[];
  userMessage: UIMessage;
  userParts: TyrumUIMessagePart[];
  userText: string;
} {
  if (messages.length === 0) {
    throw new Error("messages must include at least one user message");
  }

  if (trigger === "submit-message") {
    const userMessage = messages.at(-1);
    if (!userMessage || userMessage.role !== "user") {
      throw new Error("submit-message requires the last message to have role 'user'");
    }
    const userText = extractUserText(userMessage);
    if (!hasUserTurnContent(userMessage)) {
      throw new Error("submit-message requires a user message with text or files");
    }
    return {
      originalMessages: messages,
      previousMessages: messages.slice(0, -1),
      userMessage,
      userParts: cloneUserParts(userMessage),
      userText,
    };
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const userMessage = messages[index];
    if (!userMessage || userMessage.role !== "user") {
      continue;
    }
    const userText = extractUserText(userMessage);
    if (!hasUserTurnContent(userMessage)) {
      throw new Error("regenerate-message requires the latest user message to contain content");
    }
    return {
      originalMessages: messages.slice(0, index + 1),
      previousMessages: messages.slice(0, index),
      userMessage,
      userParts: cloneUserParts(userMessage),
      userText,
    };
  }

  throw new Error("regenerate-message requires an earlier user message");
}

export async function resolveAuthoritativeTurnMessages(input: {
  persistedMessages: UIMessage[];
  submittedMessages: UIMessage[] | undefined;
  trigger: "submit-message" | "regenerate-message";
}): Promise<{
  originalMessages: UIMessage[];
  previousMessages: UIMessage[];
  userMessage: UIMessage;
  userParts: TyrumUIMessagePart[];
  userText: string;
}> {
  if (input.trigger === "regenerate-message") {
    return splitMessagesForTurn(input.persistedMessages, "regenerate-message");
  }

  const validatedMessages = input.submittedMessages ?? [];
  if (validatedMessages.length !== 1) {
    throw new Error("submit-message requires exactly one user UI message");
  }

  return splitMessagesForTurn([...input.persistedMessages, ...validatedMessages], "submit-message");
}

export function hasApprovalRequest(message: UIMessage): boolean {
  return message.parts.some((part) => {
    const approvalPart = coerceApprovalDataPart(part);
    if (approvalPart) {
      return approvalPart.data.state === "pending";
    }
    return isToolUIPart(part) && part.state === "approval-requested";
  });
}

export function attachedNodeIdFromBody(
  body: Record<string, unknown> | undefined,
): string | undefined {
  const value = body?.["attached_node_id"];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function normalizeRequestMetadata(input: {
  attachedNodeId?: string;
  messageId?: string;
  metadata: unknown;
  requestId: string;
}): Record<string, unknown> {
  const record = coerceRecord(input.metadata) ?? {};
  return {
    ...record,
    source: "ws-ai-sdk",
    request_id: input.requestId,
    ...(input.messageId ? { client_message_id: input.messageId } : {}),
    ...(input.attachedNodeId ? { attached_node_id: input.attachedNodeId } : {}),
  };
}

export function requireTenantClient(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
): { tenantId: string } | { response: WsResponseEnvelope } {
  const tenantId = client.auth_claims?.tenant_id;
  if (!tenantId) {
    return {
      response: errorResponse(msg.request_id, msg.type, "unauthorized", "tenant token required"),
    };
  }
  if (client.role !== "client") {
    return {
      response: errorResponse(
        msg.request_id,
        msg.type,
        "unauthorized",
        "only operator clients may access conversations",
      ),
    };
  }
  return { tenantId };
}
