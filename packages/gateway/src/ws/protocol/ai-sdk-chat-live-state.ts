import type { UIMessage, UIMessageChunk } from "ai";

type ToolPart = Extract<UIMessage["parts"][number], { toolCallId: string }>;
type TextPart = Extract<UIMessage["parts"][number], { type: "text" }>;
type ReasoningPart = Extract<UIMessage["parts"][number], { type: "reasoning" }>;
type MutableToolPart = ToolPart & { preliminary?: boolean; rawInput?: unknown };

function isToolPart(part: UIMessage["parts"][number]): part is ToolPart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function mergeMetadata(current: unknown, next: unknown): unknown {
  if (
    typeof current === "object" &&
    current !== null &&
    typeof next === "object" &&
    next !== null &&
    !Array.isArray(current) &&
    !Array.isArray(next)
  ) {
    return { ...current, ...next };
  }
  return next;
}

function parsePartialInput(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function toMutableToolPart(part: ToolPart): MutableToolPart {
  return part as MutableToolPart;
}

export function createAiSdkChatLiveState(input: {
  createMessageId: () => string;
  messages: UIMessage[];
}) {
  const messages = structuredClone(input.messages);
  const activeTextParts = new Map<string, TextPart>();
  const activeReasoningParts = new Map<string, ReasoningPart>();
  const partialToolInputs = new Map<
    string,
    { dynamic: boolean; text: string; title?: string; toolName: string }
  >();
  let assistantMessage = messages.at(-1)?.role === "assistant" ? messages.at(-1) : null;
  let approvalRequested = false;
  let assistantProgress = false;

  function getAssistantMessage(): UIMessage {
    if (assistantMessage) {
      return assistantMessage;
    }
    assistantMessage = {
      id: input.createMessageId(),
      role: "assistant",
      parts: [],
    };
    messages.push(assistantMessage);
    return assistantMessage;
  }

  function findToolPart(toolCallId: string): ToolPart | undefined {
    return getAssistantMessage().parts.find(
      (part): part is ToolPart => isToolPart(part) && part.toolCallId === toolCallId,
    );
  }

  function createToolPart(chunk: {
    dynamic?: boolean;
    providerExecuted?: boolean;
    providerMetadata?: unknown;
    title?: string;
    toolCallId: string;
    toolName: string;
  }): ToolPart {
    if (chunk.dynamic) {
      return {
        type: "dynamic-tool",
        toolName: chunk.toolName,
        toolCallId: chunk.toolCallId,
        state: "input-streaming",
        input: undefined,
        ...(chunk.providerExecuted === undefined
          ? {}
          : { providerExecuted: chunk.providerExecuted }),
        ...(chunk.providerMetadata == null ? {} : { callProviderMetadata: chunk.providerMetadata }),
        ...(chunk.title === undefined ? {} : { title: chunk.title }),
      } as ToolPart;
    }
    return {
      type: `tool-${chunk.toolName}`,
      toolCallId: chunk.toolCallId,
      state: "input-streaming",
      input: undefined,
      ...(chunk.providerExecuted === undefined ? {} : { providerExecuted: chunk.providerExecuted }),
      ...(chunk.providerMetadata == null ? {} : { callProviderMetadata: chunk.providerMetadata }),
      ...(chunk.title === undefined ? {} : { title: chunk.title }),
    } as ToolPart;
  }

  function getOrCreateToolPart(chunk: {
    dynamic?: boolean;
    providerExecuted?: boolean;
    providerMetadata?: unknown;
    title?: string;
    toolCallId: string;
    toolName: string;
  }): ToolPart {
    const existing = findToolPart(chunk.toolCallId);
    if (existing) {
      return existing;
    }
    const part = createToolPart(chunk);
    getAssistantMessage().parts.push(part);
    return part;
  }

  function markProgress(): void {
    assistantProgress = true;
  }

  return {
    applyChunk(chunk: UIMessageChunk): void {
      switch (chunk.type) {
        case "start": {
          const message = getAssistantMessage();
          if (chunk.messageId) {
            message.id = chunk.messageId;
            markProgress();
          }
          if (chunk.messageMetadata !== undefined) {
            message.metadata = mergeMetadata(message.metadata, chunk.messageMetadata);
            markProgress();
          }
          return;
        }
        case "message-metadata":
        case "finish": {
          if (chunk.messageMetadata !== undefined) {
            const message = getAssistantMessage();
            message.metadata = mergeMetadata(message.metadata, chunk.messageMetadata);
            markProgress();
          }
          return;
        }
        case "text-start": {
          const part: TextPart = {
            type: "text",
            text: "",
            state: "streaming",
            ...(chunk.providerMetadata === undefined
              ? {}
              : { providerMetadata: chunk.providerMetadata }),
          };
          activeTextParts.set(chunk.id, part);
          getAssistantMessage().parts.push(part);
          markProgress();
          return;
        }
        case "text-delta": {
          const part = activeTextParts.get(chunk.id);
          if (!part) return;
          part.text += chunk.delta;
          if (chunk.providerMetadata !== undefined) {
            part.providerMetadata = chunk.providerMetadata;
          }
          markProgress();
          return;
        }
        case "text-end": {
          const part = activeTextParts.get(chunk.id);
          if (!part) return;
          part.state = "done";
          if (chunk.providerMetadata !== undefined) {
            part.providerMetadata = chunk.providerMetadata;
          }
          activeTextParts.delete(chunk.id);
          markProgress();
          return;
        }
        case "reasoning-start": {
          const part: ReasoningPart = {
            type: "reasoning",
            text: "",
            state: "streaming",
            ...(chunk.providerMetadata === undefined
              ? {}
              : { providerMetadata: chunk.providerMetadata }),
          };
          activeReasoningParts.set(chunk.id, part);
          getAssistantMessage().parts.push(part);
          markProgress();
          return;
        }
        case "reasoning-delta": {
          const part = activeReasoningParts.get(chunk.id);
          if (!part) return;
          part.text += chunk.delta;
          if (chunk.providerMetadata !== undefined) {
            part.providerMetadata = chunk.providerMetadata;
          }
          markProgress();
          return;
        }
        case "reasoning-end": {
          const part = activeReasoningParts.get(chunk.id);
          if (!part) return;
          part.state = "done";
          if (chunk.providerMetadata !== undefined) {
            part.providerMetadata = chunk.providerMetadata;
          }
          activeReasoningParts.delete(chunk.id);
          markProgress();
          return;
        }
        case "file":
        case "source-url":
        case "source-document": {
          getAssistantMessage().parts.push({ ...chunk });
          markProgress();
          return;
        }
        case "tool-input-start": {
          partialToolInputs.set(chunk.toolCallId, {
            dynamic: Boolean(chunk.dynamic),
            text: "",
            title: chunk.title,
            toolName: chunk.toolName,
          });
          getOrCreateToolPart(chunk);
          markProgress();
          return;
        }
        case "tool-input-delta": {
          const partial = partialToolInputs.get(chunk.toolCallId);
          const toolPart = findToolPart(chunk.toolCallId);
          if (!partial || !toolPart) return;
          partial.text += chunk.inputTextDelta;
          toolPart.state = "input-streaming";
          toolPart.input = parsePartialInput(partial.text);
          markProgress();
          return;
        }
        case "tool-input-available": {
          const toolPart = getOrCreateToolPart(chunk);
          toolPart.state = "input-available";
          toolPart.input = chunk.input;
          toolPart.providerExecuted = chunk.providerExecuted;
          if (chunk.providerMetadata != null) {
            toolPart.callProviderMetadata = chunk.providerMetadata;
          }
          if (chunk.title !== undefined) {
            toolPart.title = chunk.title;
          }
          markProgress();
          return;
        }
        case "tool-input-error": {
          const toolPart = getOrCreateToolPart(chunk);
          const mutableToolPart = toMutableToolPart(toolPart);
          toolPart.state = "output-error";
          toolPart.errorText = chunk.errorText;
          if (chunk.dynamic) {
            toolPart.input = chunk.input;
          } else {
            toolPart.input = undefined;
            mutableToolPart.rawInput = chunk.input;
          }
          if (chunk.providerMetadata != null) {
            toolPart.callProviderMetadata = chunk.providerMetadata;
          }
          markProgress();
          return;
        }
        case "tool-approval-request": {
          const toolPart = findToolPart(chunk.toolCallId);
          if (!toolPart) return;
          toolPart.state = "approval-requested";
          toolPart.approval = { id: chunk.approvalId };
          approvalRequested = true;
          markProgress();
          return;
        }
        case "tool-output-denied":
        case "tool-output-error":
        case "tool-output-available": {
          const toolPart = findToolPart(chunk.toolCallId);
          if (!toolPart) return;
          const mutableToolPart = toMutableToolPart(toolPart);
          if (chunk.type === "tool-output-denied") {
            toolPart.state = "output-denied";
            if (toolPart.approval) {
              toolPart.approval = { ...toolPart.approval, approved: false };
            }
          } else if (chunk.type === "tool-output-error") {
            toolPart.state = "output-error";
            toolPart.errorText = chunk.errorText;
            if (toolPart.approval) {
              toolPart.approval = { ...toolPart.approval, approved: true };
            }
          } else {
            toolPart.state = "output-available";
            toolPart.output = chunk.output;
            mutableToolPart.preliminary = chunk.preliminary;
            if (toolPart.approval) {
              toolPart.approval = { ...toolPart.approval, approved: true };
            }
          }
          markProgress();
          return;
        }
        case "start-step": {
          getAssistantMessage().parts.push({ type: "step-start" });
          markProgress();
          return;
        }
        case "finish-step": {
          activeTextParts.clear();
          activeReasoningParts.clear();
          return;
        }
        case "abort":
        case "error": {
          return;
        }
        default: {
          if (!chunk.type.startsWith("data-") || chunk.transient) {
            return;
          }
          const message = getAssistantMessage();
          const index = message.parts.findIndex(
            (part) => part.type === chunk.type && "id" in part && part.id === chunk.id,
          );
          const nextPart = { ...chunk };
          if (index >= 0) {
            message.parts[index] = nextPart;
          } else {
            message.parts.push(nextPart);
          }
          markProgress();
        }
      }
    },
    getMessages(): UIMessage[] {
      return structuredClone(messages);
    },
    hasApprovalRequest(): boolean {
      return approvalRequested;
    },
    hasAssistantProgress(): boolean {
      return assistantProgress;
    },
  };
}
