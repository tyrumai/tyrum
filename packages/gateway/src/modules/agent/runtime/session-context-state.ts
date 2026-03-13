import type {
  TyrumUIMessage,
  CheckpointSummary,
  PendingApprovalState,
  PendingToolState,
  SessionContextState,
} from "@tyrum/schemas";

const TOOL_STATE_FINAL = new Set(["input-available", "output-available", "output-error"]);
const IDENTIFIER_REGEXES = [
  /`([^`\n]+)`/g,
  /\bhttps?:\/\/[^\s)]+/g,
  /\b[A-Fa-f0-9]{7,40}\b/g,
  /\b[A-Z][A-Z0-9_]{2,}\b/g,
  /\b(?:\/|\.\/|\.\.\/)[^\s:;,"')\]]+/g,
  /\b[a-zA-Z0-9._-]+\.[a-zA-Z0-9._/-]+\b/g,
] as const;

function coerceRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function extractMessageText(message: TyrumUIMessage): string {
  return message.parts
    .flatMap((part) =>
      part.type === "text" && typeof part["text"] === "string" ? [part["text"].trim()] : [],
    )
    .filter((part) => part.length > 0)
    .join("\n\n")
    .trim();
}

function normalizePendingApproval(part: Record<string, unknown>): PendingApprovalState | null {
  if (part["type"] !== "data-approval-state") return null;
  const approvalId =
    typeof part["data"] === "object" && part["data"] !== null
      ? coerceRecord(part["data"])?.["approval_id"]
      : undefined;
  const state =
    typeof part["data"] === "object" && part["data"] !== null
      ? coerceRecord(part["data"])?.["state"]
      : undefined;
  const toolCallId =
    typeof part["data"] === "object" && part["data"] !== null
      ? coerceRecord(part["data"])?.["tool_call_id"]
      : undefined;
  const toolName =
    typeof part["data"] === "object" && part["data"] !== null
      ? coerceRecord(part["data"])?.["tool_name"]
      : undefined;
  const approved =
    typeof part["data"] === "object" && part["data"] !== null
      ? coerceRecord(part["data"])?.["approved"]
      : undefined;

  if (
    typeof approvalId !== "string" ||
    typeof state !== "string" ||
    typeof toolCallId !== "string" ||
    typeof toolName !== "string"
  ) {
    return null;
  }
  if (
    state !== "approved" &&
    state !== "cancelled" &&
    state !== "denied" &&
    state !== "expired" &&
    state !== "pending"
  ) {
    return null;
  }
  return {
    approval_id: approvalId,
    ...(typeof approved === "boolean" ? { approved } : {}),
    state,
    tool_call_id: toolCallId,
    tool_name: toolName,
  };
}

function normalizePendingToolState(
  part: Record<string, unknown>,
  fallbackSummary: string,
): PendingToolState | null {
  const rawType = part["type"];
  if (typeof rawType !== "string" || !rawType.startsWith("tool-")) {
    return null;
  }
  const toolCallId = part["toolCallId"];
  const state = part["state"];
  if (typeof toolCallId !== "string" || typeof state !== "string") {
    return null;
  }
  if (TOOL_STATE_FINAL.has(state)) {
    return null;
  }
  const toolName =
    (typeof part["toolName"] === "string" ? part["toolName"].trim() : "") ||
    rawType.slice("tool-".length).trim() ||
    "tool";
  return {
    summary: fallbackSummary || state,
    tool_call_id: toolCallId,
    tool_name: toolName,
  };
}

export function collectPendingApprovals(
  messages: readonly TyrumUIMessage[],
): PendingApprovalState[] {
  const approvals = new Map<string, PendingApprovalState>();
  for (const message of messages) {
    for (const part of message.parts) {
      const record = coerceRecord(part);
      if (!record) continue;
      const approval = normalizePendingApproval(record);
      if (!approval) continue;
      approvals.set(approval.approval_id, approval);
    }
  }
  return Array.from(approvals.values()).filter((approval) => approval.state === "pending");
}

export function collectPendingToolStates(messages: readonly TyrumUIMessage[]): PendingToolState[] {
  const tools = new Map<string, PendingToolState>();
  for (const message of messages) {
    const fallbackSummary = extractMessageText(message);
    for (const part of message.parts) {
      const record = coerceRecord(part);
      if (!record) continue;
      const toolState = normalizePendingToolState(record, fallbackSummary);
      if (!toolState) continue;
      tools.set(toolState.tool_call_id, toolState);
    }
  }
  return Array.from(tools.values());
}

export function splitMessagesForContextCompaction(input: {
  messages: readonly TyrumUIMessage[];
  keepLastMessages: number;
}): { dropped: TyrumUIMessage[]; kept: TyrumUIMessage[] } {
  const keepLastMessages = Math.max(0, input.keepLastMessages);
  if (input.messages.length <= keepLastMessages) {
    return { dropped: [], kept: input.messages.slice() };
  }

  let splitIndex = Math.max(0, input.messages.length - keepLastMessages);
  const pendingApprovalIds = new Set(
    collectPendingApprovals(input.messages).map((item) => item.approval_id),
  );
  const pendingToolIds = new Set(
    collectPendingToolStates(input.messages).map((item) => item.tool_call_id),
  );
  if (pendingApprovalIds.size > 0 || pendingToolIds.size > 0) {
    for (let index = 0; index < input.messages.length; index += 1) {
      const message = input.messages[index];
      if (!message) continue;
      const hasPendingState = message.parts.some((part) => {
        const record = coerceRecord(part);
        if (!record) return false;
        const approval = normalizePendingApproval(record);
        if (approval && pendingApprovalIds.has(approval.approval_id)) return true;
        const toolState = normalizePendingToolState(record, "");
        return Boolean(toolState && pendingToolIds.has(toolState.tool_call_id));
      });
      if (hasPendingState) {
        splitIndex = Math.min(splitIndex, index);
        break;
      }
    }
  }

  return {
    dropped: input.messages.slice(0, splitIndex),
    kept: input.messages.slice(splitIndex),
  };
}

export function estimatePromptTokens(input: {
  messages: readonly TyrumUIMessage[];
  systemPrompt?: string;
  userContent?: readonly { text: string; type: "text" }[];
}): number {
  const messageChars = input.messages.reduce((total, message) => {
    const partChars = message.parts.reduce((partTotal, part) => {
      if (part.type === "text" && typeof part["text"] === "string") {
        return partTotal + part["text"].length;
      }
      return partTotal + JSON.stringify(part).length;
    }, 0);
    return total + partChars;
  }, 0);
  const systemChars = input.systemPrompt?.length ?? 0;
  const userChars = input.userContent?.reduce((total, part) => total + part.text.length, 0) ?? 0;
  return Math.ceil((messageChars + systemChars + userChars) / 4);
}

function trimLines(items: readonly string[], maxItems = 8): string[] {
  return items
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, maxItems);
}

export function buildCheckpointPromptText(checkpoint: CheckpointSummary): string {
  return [
    checkpoint.goal.trim().length > 0 ? `Goal: ${checkpoint.goal.trim()}` : "",
    checkpoint.user_constraints.length > 0
      ? `User constraints:\n${trimLines(checkpoint.user_constraints)
          .map((item) => `- ${item}`)
          .join("\n")}`
      : "",
    checkpoint.decisions.length > 0
      ? `Decisions:\n${trimLines(checkpoint.decisions)
          .map((item) => `- ${item}`)
          .join("\n")}`
      : "",
    checkpoint.discoveries.length > 0
      ? `Discoveries:\n${trimLines(checkpoint.discoveries)
          .map((item) => `- ${item}`)
          .join("\n")}`
      : "",
    checkpoint.completed_work.length > 0
      ? `Completed work:\n${trimLines(checkpoint.completed_work)
          .map((item) => `- ${item}`)
          .join("\n")}`
      : "",
    checkpoint.pending_work.length > 0
      ? `Pending work:\n${trimLines(checkpoint.pending_work)
          .map((item) => `- ${item}`)
          .join("\n")}`
      : "",
    checkpoint.unresolved_questions.length > 0
      ? `Unresolved questions:\n${trimLines(checkpoint.unresolved_questions)
          .map((item) => `- ${item}`)
          .join("\n")}`
      : "",
    checkpoint.critical_identifiers.length > 0
      ? `Critical identifiers: ${trimLines(checkpoint.critical_identifiers, 20).join(", ")}`
      : "",
    checkpoint.relevant_files.length > 0
      ? `Relevant files: ${trimLines(checkpoint.relevant_files, 20).join(", ")}`
      : "",
    checkpoint.handoff_md.trim().length > 0 ? `Handoff:\n${checkpoint.handoff_md.trim()}` : "",
  ]
    .filter((item) => item.length > 0)
    .join("\n\n");
}

function buildPendingStateText(contextState: SessionContextState): string {
  const sections: string[] = [];
  if (contextState.pending_approvals.length > 0) {
    sections.push(
      `Pending approvals:\n${contextState.pending_approvals
        .map(
          (item) =>
            `- ${item.tool_name} (${item.approval_id}, ${item.tool_call_id}) is ${item.state}`,
        )
        .join("\n")}`,
    );
  }
  if (contextState.pending_tool_state.length > 0) {
    sections.push(
      `Pending tool state:\n${contextState.pending_tool_state
        .map(
          (item) =>
            `- ${item.tool_name} (${item.tool_call_id}): ${item.summary.trim() || "still in progress"}`,
        )
        .join("\n")}`,
    );
  }
  return sections.join("\n\n");
}

export function buildPromptVisibleMessages(
  messages: readonly TyrumUIMessage[],
  contextState: SessionContextState,
): TyrumUIMessage[] {
  if (
    !contextState.checkpoint &&
    contextState.pending_approvals.length === 0 &&
    contextState.pending_tool_state.length === 0
  ) {
    return messages.slice();
  }

  const recentIds = new Set(contextState.recent_message_ids);
  let recentMessages =
    recentIds.size > 0 ? messages.filter((message) => recentIds.has(message.id)) : [];

  if (recentMessages.length === 0 && contextState.compacted_through_message_id) {
    const splitIndex = messages.findIndex(
      (message) => message.id === contextState.compacted_through_message_id,
    );
    if (splitIndex >= 0) {
      recentMessages = messages.slice(splitIndex + 1);
    }
  }
  if (recentMessages.length === 0) {
    recentMessages = messages.slice();
  }

  const sections: string[] = [];
  if (contextState.checkpoint) {
    sections.push(buildCheckpointPromptText(contextState.checkpoint));
  }
  const pendingStateText = buildPendingStateText(contextState);
  if (pendingStateText.length > 0) {
    sections.push(pendingStateText);
  }
  if (sections.length === 0) {
    return recentMessages;
  }

  return [
    {
      id: `checkpoint-${contextState.compacted_through_message_id ?? contextState.updated_at}`,
      role: "system",
      parts: [{ type: "text", text: sections.join("\n\n") }],
    },
    ...recentMessages,
  ];
}

export function extractCriticalIdentifiers(messages: readonly TyrumUIMessage[]): string[] {
  const values = new Set<string>();
  for (const message of messages) {
    const text = extractMessageText(message);
    if (!text) continue;
    for (const pattern of IDENTIFIER_REGEXES) {
      for (const match of text.matchAll(pattern)) {
        const value = (match[1] ?? match[0] ?? "").trim();
        if (value.length < 3) continue;
        values.add(value);
        if (values.size >= 50) {
          return Array.from(values);
        }
      }
    }
  }
  return Array.from(values);
}

export function extractRelevantFiles(identifiers: readonly string[]): string[] {
  return identifiers
    .filter((identifier) => identifier.includes("/") || identifier.includes("."))
    .slice(0, 20);
}

export function renderMessagesForCompaction(messages: readonly TyrumUIMessage[]): string {
  return messages
    .map((message) => {
      const label =
        message.role === "assistant"
          ? "Assistant"
          : message.role === "system"
            ? "System"
            : message.role === "tool"
              ? "Tool"
              : "User";
      const text = extractMessageText(message);
      return text ? `${label} [${message.id}]: ${text}` : `${label} [${message.id}]`;
    })
    .join("\n\n");
}
