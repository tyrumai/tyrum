import type { TyrumUIMessage } from "@tyrum/contracts";
import { coerceRecord, coerceString } from "../util/coerce.js";

type ChatMessageLike<ROLE extends TyrumUIMessage["role"] = TyrumUIMessage["role"]> = {
  id: string;
  role: ROLE;
  parts: readonly unknown[];
  metadata?: unknown;
};

type NormalizedChatMessage<ROLE extends TyrumUIMessage["role"] = TyrumUIMessage["role"]> = Omit<
  TyrumUIMessage,
  "role"
> & {
  role: ROLE | "assistant";
};

type NormalizedToolState =
  | "approval-requested"
  | "input-available"
  | "output-available"
  | "output-error";

type NormalizedToolPart = {
  type: string;
  toolCallId: string;
  state: NormalizedToolState;
  input?: unknown;
  output?: unknown;
  approval?: {
    id: string;
    approved?: boolean;
  };
  providerExecuted?: boolean;
  callProviderMetadata?: unknown;
  resultProviderMetadata?: unknown;
  title?: string;
  preliminary?: boolean;
  errorText?: string;
  toolName?: string;
};

type NormalizedToolRef = {
  part: NormalizedToolPart;
};

function cloneMetadata(metadata: unknown): Record<string, unknown> | undefined {
  const record = coerceRecord(metadata);
  return record ? structuredClone(record) : undefined;
}

function clonePart(record: Record<string, unknown>): TyrumUIMessage["parts"][number] {
  return structuredClone(record) as TyrumUIMessage["parts"][number];
}

function isRawToolCallRecord(record: Record<string, unknown>): boolean {
  return record["type"] === "tool-call";
}

function isRawToolResultRecord(record: Record<string, unknown>): boolean {
  return record["type"] === "tool-result";
}

function isRawToolErrorRecord(record: Record<string, unknown>): boolean {
  return record["type"] === "tool-error";
}

function isToolApprovalRequestRecord(record: Record<string, unknown>): boolean {
  return record["type"] === "tool-approval-request";
}

function isNormalizedToolRecord(record: Record<string, unknown>): boolean {
  const rawType = record["type"];
  return (
    rawType === "dynamic-tool" ||
    (typeof rawType === "string" &&
      rawType.startsWith("tool-") &&
      rawType !== "tool-approval-request" &&
      rawType !== "tool-approval-response" &&
      rawType !== "tool-call" &&
      rawType !== "tool-error" &&
      rawType !== "tool-result")
  );
}

function applyToolDescriptorFromRecord(
  part: NormalizedToolPart,
  record: Record<string, unknown>,
): void {
  const toolName = coerceString(record["toolName"]);
  if (!toolName) {
    return;
  }
  const dynamic = record["dynamic"] === true;
  part.type = dynamic ? "dynamic-tool" : `tool-${toolName}`;
  if (dynamic) {
    part.toolName = toolName;
    return;
  }
  delete part.toolName;
}

function applyPendingApproval(
  part: NormalizedToolPart,
  pendingApprovalIds: Map<string, string>,
): void {
  const approvalId = pendingApprovalIds.get(part.toolCallId);
  if (!approvalId) {
    return;
  }
  pendingApprovalIds.delete(part.toolCallId);
  part.approval = part.approval ? { ...part.approval, id: approvalId } : { id: approvalId };
  if (part.state !== "output-available" && part.state !== "output-error") {
    part.state = "approval-requested";
  }
}

function createNormalizedToolPart(
  record: Record<string, unknown>,
  fallbackState: NormalizedToolState,
): NormalizedToolPart | undefined {
  const toolCallId = coerceString(record["toolCallId"]);
  const toolName = coerceString(record["toolName"]);
  if (!toolCallId || !toolName) {
    return undefined;
  }

  const dynamic = record["dynamic"] === true;
  const part: NormalizedToolPart = {
    type: dynamic ? "dynamic-tool" : `tool-${toolName}`,
    toolCallId,
    state: fallbackState,
  };
  if (dynamic) {
    part.toolName = toolName;
  }
  if (record["input"] !== undefined) {
    part.input = record["input"];
  }
  if (record["output"] !== undefined) {
    part.output = record["output"];
  }
  if (typeof record["providerExecuted"] === "boolean") {
    part.providerExecuted = record["providerExecuted"];
  }
  if (record["providerMetadata"] !== undefined) {
    if (fallbackState === "output-available" || fallbackState === "output-error") {
      part.resultProviderMetadata = record["providerMetadata"];
    } else {
      part.callProviderMetadata = record["providerMetadata"];
    }
  }
  if (typeof record["title"] === "string") {
    part.title = record["title"];
  }
  if (record["preliminary"] !== undefined) {
    part.preliminary = record["preliminary"] === true;
  }
  return part;
}

function updateToolPartFromCall(part: NormalizedToolPart, record: Record<string, unknown>): void {
  applyToolDescriptorFromRecord(part, record);
  if (record["input"] !== undefined) {
    part.input = record["input"];
  }
  if (typeof record["providerExecuted"] === "boolean") {
    part.providerExecuted = record["providerExecuted"];
  }
  if (record["providerMetadata"] !== undefined) {
    part.callProviderMetadata = record["providerMetadata"];
  }
  if (typeof record["title"] === "string") {
    part.title = record["title"];
  }
}

function updateToolPartFromResult(part: NormalizedToolPart, record: Record<string, unknown>): void {
  applyToolDescriptorFromRecord(part, record);
  if (record["input"] !== undefined && part.input === undefined) {
    part.input = record["input"];
  }
  if (record["output"] !== undefined) {
    part.output = record["output"];
  }
  if (typeof record["providerExecuted"] === "boolean") {
    part.providerExecuted = record["providerExecuted"];
  }
  if (record["providerMetadata"] !== undefined) {
    part.resultProviderMetadata = record["providerMetadata"];
  }
  if (typeof record["title"] === "string") {
    part.title = record["title"];
  }
  if (record["preliminary"] !== undefined) {
    part.preliminary = record["preliminary"] === true;
  }
  part.state = "output-available";
  if (part.approval) {
    part.approval = { ...part.approval, approved: true };
  }
}

function stringifyErrorText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    // Intentional: fall back to string coercion when the error payload is not JSON-serializable.
    return String(value);
  }
}

function updateToolPartFromError(part: NormalizedToolPart, record: Record<string, unknown>): void {
  applyToolDescriptorFromRecord(part, record);
  if (record["input"] !== undefined && part.input === undefined) {
    part.input = record["input"];
  }
  if (typeof record["providerExecuted"] === "boolean") {
    part.providerExecuted = record["providerExecuted"];
  }
  if (record["providerMetadata"] !== undefined) {
    part.resultProviderMetadata = record["providerMetadata"];
  }
  if (typeof record["title"] === "string") {
    part.title = record["title"];
  }
  part.state = "output-error";
  part.errorText = stringifyErrorText(record["error"]);
}

function pushIfNonEmpty(messages: TyrumUIMessage[], message: TyrumUIMessage | null): void {
  if (message && message.parts.length > 0) {
    messages.push(message);
  }
}

function createChatMessage(
  input: Pick<ChatMessageLike, "id" | "metadata"> & { role: TyrumUIMessage["role"] },
): NormalizedChatMessage {
  const metadata = cloneMetadata(input.metadata);
  return {
    id: input.id,
    role: input.role,
    parts: [],
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function resolveToolTargetMessage(
  source: ChatMessageLike,
  primaryMessage: NormalizedChatMessage | null,
): {
  fallbackMessage: NormalizedChatMessage | null;
  getAssistantMessage: () => NormalizedChatMessage;
  getSyntheticAssistantMessage: () => NormalizedChatMessage | null;
} {
  const fallbackMessage =
    source.role === "assistant"
      ? null
      : createChatMessage({ id: source.id, role: source.role, metadata: source.metadata });
  let syntheticAssistantMessage: TyrumUIMessage | null = null;

  return {
    fallbackMessage,
    getAssistantMessage: () => {
      if (primaryMessage) {
        return primaryMessage;
      }
      syntheticAssistantMessage ??= createChatMessage({
        id: source.id,
        role: "assistant",
        metadata: source.metadata,
      });
      return syntheticAssistantMessage;
    },
    getSyntheticAssistantMessage: () => syntheticAssistantMessage,
  };
}

export function normalizeToolMessagesForChatHistory<ROLE extends TyrumUIMessage["role"]>(
  messages: readonly ChatMessageLike<ROLE>[],
): NormalizedChatMessage<ROLE>[];
export function normalizeToolMessagesForChatHistory<ROLE extends TyrumUIMessage["role"]>(
  messages: readonly ChatMessageLike<ROLE>[],
): NormalizedChatMessage<ROLE>[] {
  const normalized: NormalizedChatMessage<ROLE>[] = [];
  const toolRefs = new Map<string, NormalizedToolRef>();
  const pendingApprovalIds = new Map<string, string>();

  for (const source of messages) {
    const primaryMessage =
      source.role === "assistant"
        ? createChatMessage({ id: source.id, role: source.role, metadata: source.metadata })
        : null;
    const { fallbackMessage, getAssistantMessage, getSyntheticAssistantMessage } =
      resolveToolTargetMessage(source, primaryMessage);

    for (const rawPart of source.parts) {
      const record = coerceRecord(rawPart);
      if (!record || typeof record["type"] !== "string") {
        continue;
      }

      if (isRawToolCallRecord(record)) {
        const toolCallId = coerceString(record["toolCallId"]);
        if (!toolCallId) {
          getAssistantMessage().parts.push(clonePart(record));
          continue;
        }
        const existing = toolRefs.get(toolCallId)?.part;
        if (existing) {
          updateToolPartFromCall(existing, record);
          applyPendingApproval(existing, pendingApprovalIds);
          continue;
        }
        const toolPart = createNormalizedToolPart(record, "input-available");
        if (!toolPart) {
          getAssistantMessage().parts.push(clonePart(record));
          continue;
        }
        applyPendingApproval(toolPart, pendingApprovalIds);
        getAssistantMessage().parts.push(toolPart);
        toolRefs.set(toolCallId, { part: toolPart });
        continue;
      }

      if (isRawToolResultRecord(record)) {
        const toolCallId = coerceString(record["toolCallId"]);
        if (!toolCallId) {
          getAssistantMessage().parts.push(clonePart(record));
          continue;
        }
        const existing = toolRefs.get(toolCallId)?.part;
        if (existing) {
          updateToolPartFromResult(existing, record);
          applyPendingApproval(existing, pendingApprovalIds);
          continue;
        }
        const toolPart = createNormalizedToolPart(record, "output-available");
        if (!toolPart) {
          getAssistantMessage().parts.push(clonePart(record));
          continue;
        }
        applyPendingApproval(toolPart, pendingApprovalIds);
        getAssistantMessage().parts.push(toolPart);
        toolRefs.set(toolCallId, { part: toolPart });
        continue;
      }

      if (isRawToolErrorRecord(record)) {
        const toolCallId = coerceString(record["toolCallId"]);
        if (!toolCallId) {
          getAssistantMessage().parts.push(clonePart(record));
          continue;
        }
        const existing = toolRefs.get(toolCallId)?.part;
        if (existing) {
          updateToolPartFromError(existing, record);
          applyPendingApproval(existing, pendingApprovalIds);
          continue;
        }
        const toolPart = createNormalizedToolPart(record, "output-error");
        if (!toolPart) {
          getAssistantMessage().parts.push(clonePart(record));
          continue;
        }
        updateToolPartFromError(toolPart, record);
        applyPendingApproval(toolPart, pendingApprovalIds);
        getAssistantMessage().parts.push(toolPart);
        toolRefs.set(toolCallId, { part: toolPart });
        continue;
      }

      if (isToolApprovalRequestRecord(record)) {
        const toolCallId = coerceString(record["toolCallId"]);
        const approvalId = coerceString(record["approvalId"]);
        if (!toolCallId || !approvalId) {
          getAssistantMessage().parts.push(clonePart(record));
          continue;
        }
        const existing = toolRefs.get(toolCallId)?.part;
        pendingApprovalIds.set(toolCallId, approvalId);
        if (existing) {
          applyPendingApproval(existing, pendingApprovalIds);
        }
        continue;
      }

      if (isNormalizedToolRecord(record)) {
        const cloned = clonePart(record);
        getAssistantMessage().parts.push(cloned);
        const clonedRecord = coerceRecord(cloned);
        const toolCallId = clonedRecord ? coerceString(clonedRecord["toolCallId"]) : undefined;
        const state = clonedRecord?.["state"];
        if (toolCallId && typeof state === "string") {
          const toolPart = cloned as NormalizedToolPart;
          applyPendingApproval(toolPart, pendingApprovalIds);
          toolRefs.set(toolCallId, { part: toolPart });
        }
        continue;
      }

      const target = fallbackMessage ?? getAssistantMessage();
      target.parts.push(clonePart(record));
    }

    pushIfNonEmpty(normalized, primaryMessage);
    pushIfNonEmpty(normalized, getSyntheticAssistantMessage());
    pushIfNonEmpty(normalized, fallbackMessage);
  }

  return normalized;
}
