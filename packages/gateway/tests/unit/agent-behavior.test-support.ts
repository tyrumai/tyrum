import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import type { NormalizedThreadMessage } from "@tyrum/contracts";

export const TITLE_PROMPT_TEXT = "Write a concise session title.";
export const PRETURN_MEMORY_SECTION_LABEL = "Pre-turn recall (mcp.memory.seed):";
const PROMPT_ROLE_MARKER_PREFIX = "[[role:";
const PROMPT_PART_MARKER_PREFIX = "[[part:";

const PROMPT_SECTION_LABELS = [
  "Skill guidance:",
  "Tool contracts:",
  "Session state:",
  "Active work state:",
  "Memory digest:",
  PRETURN_MEMORY_SECTION_LABEL,
  "Automation directive:",
  "Automation context:",
] as const;

function flattenPromptPart(part: unknown): string {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";

  const type = (part as { type?: unknown }).type;
  if (type === "text") {
    return typeof (part as { text?: unknown }).text === "string"
      ? (part as { text: string }).text
      : "";
  }
  if (type === "tool-call") {
    const toolName =
      typeof (part as { toolName?: unknown }).toolName === "string"
        ? (part as { toolName: string }).toolName
        : "unknown";
    return `[tool-call ${toolName}]`;
  }
  if (type === "tool-result") {
    const toolName =
      typeof (part as { toolName?: unknown }).toolName === "string"
        ? (part as { toolName: string }).toolName
        : "unknown";
    return `[tool-result ${toolName}]`;
  }
  return "";
}

function flattenPromptContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map(flattenPromptPart)
    .filter((value) => value.length > 0)
    .join("\n");
}

function serializePromptEntryContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part, index) => {
      const text = flattenPromptPart(part);
      if (text.length === 0) return "";
      return `${PROMPT_PART_MARKER_PREFIX}${index}]]\n${text}`;
    })
    .filter((value) => value.length > 0)
    .join("\n\n");
}

export function extractPromptText(options: LanguageModelV3CallOptions): string {
  return (options.prompt ?? [])
    .map((entry) => {
      const content = serializePromptEntryContent(entry.content);
      if (content.length === 0) return "";
      return `${PROMPT_ROLE_MARKER_PREFIX}${entry.role}]]\n${content}`;
    })
    .filter((value) => value.length > 0)
    .join("\n\n");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractPromptSection(
  promptText: string,
  label: (typeof PROMPT_SECTION_LABELS)[number],
): string {
  const labelsToTry = label === "Memory digest:" ? [PRETURN_MEMORY_SECTION_LABEL, label] : [label];
  for (const candidateLabel of labelsToTry) {
    const nextLabels = PROMPT_SECTION_LABELS.filter((candidate) => candidate !== candidateLabel)
      .map(escapeRegex)
      .join("|");
    const roleBoundary = `${escapeRegex(PROMPT_ROLE_MARKER_PREFIX)}[^\\]]+\\]\\]`;
    const partBoundary = `${escapeRegex(PROMPT_PART_MARKER_PREFIX)}\\d+\\]\\]`;
    const pattern = new RegExp(
      `${escapeRegex(candidateLabel)}\\n([\\s\\S]*?)(?=\\n(?:${nextLabels})\\n|\\n\\n(?:${partBoundary}|${roleBoundary})\\n|$)`,
      "u",
    );
    const section = promptText.match(pattern)?.[1]?.trim() ?? "";
    if (section.length > 0) {
      return section;
    }
  }

  return "";
}

export type PromptAwareModelInput = {
  promptText: string;
  systemText: string;
  latestUserText: string;
  isTitlePrompt: boolean;
  options: LanguageModelV3CallOptions;
};

type PromptAwareMemoryDecision =
  | {
      should_store: false;
      reason: string;
    }
  | {
      should_store: true;
      reason: string;
      memory:
        | {
            kind: "fact";
            key: string;
            value: unknown;
            confidence?: number;
            tags?: string[];
          }
        | {
            kind: "note";
            title?: string;
            body_md: string;
            tags?: string[];
          }
        | {
            kind: "procedure";
            title?: string;
            body_md: string;
            confidence?: number;
            tags?: string[];
          }
        | {
            kind: "episode";
            summary_md: string;
            tags?: string[];
          };
    };

type PromptAwareMemoryWriteInput =
  | {
      kind: "fact";
      key: string;
      value: unknown;
      confidence?: number;
      tags?: string[];
    }
  | {
      kind: "note";
      title?: string;
      body_md: string;
      tags?: string[];
    }
  | {
      kind: "procedure";
      title?: string;
      body_md: string;
      confidence?: number;
      tags?: string[];
    }
  | {
      kind: "episode";
      summary_md: string;
      tags?: string[];
    };

export function promptIncludes(promptText: string, needle: string): boolean {
  return promptText.toLowerCase().includes(needle.trim().toLowerCase());
}

function buildPromptAwareInput(options: LanguageModelV3CallOptions): PromptAwareModelInput {
  const prompt = options.prompt ?? [];
  const systemEntry = prompt.find((entry) => entry.role === "system");
  const latestUserEntry = prompt.findLast((entry) => entry.role === "user");
  const latestUserText = (() => {
    if (typeof latestUserEntry?.content === "string") {
      return latestUserEntry.content;
    }
    if (!Array.isArray(latestUserEntry?.content)) {
      return "";
    }

    const latestUserPart = latestUserEntry.content.findLast(
      (part) => flattenPromptPart(part).length > 0,
    );
    return latestUserPart ? flattenPromptPart(latestUserPart) : "";
  })();
  const systemText = flattenPromptContent(systemEntry?.content);
  return {
    promptText: extractPromptText(options),
    systemText,
    latestUserText,
    isTitlePrompt: systemText.includes(TITLE_PROMPT_TEXT),
    options,
  };
}

function hasToolResult(options: LanguageModelV3CallOptions, toolName: string): boolean {
  const prompt = options.prompt ?? [];
  const lastUserIndex = prompt.findLastIndex((entry) => entry.role === "user");
  const relevantEntries = lastUserIndex >= 0 ? prompt.slice(lastUserIndex + 1) : prompt;
  return relevantEntries.some(
    (entry) =>
      entry.role === "tool" &&
      Array.isArray(entry.content) &&
      entry.content.some(
        (part) =>
          Boolean(part) &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "tool-result" &&
          (part as { toolName?: unknown }).toolName === toolName,
      ),
  );
}

function resolveMemoryWriteInput(
  decision: PromptAwareMemoryDecision | undefined,
): PromptAwareMemoryWriteInput | undefined {
  return decision?.should_store ? decision.memory : undefined;
}

export function createPromptAwareLanguageModel(
  responder: (input: PromptAwareModelInput) => string,
  opts?: {
    modelId?: string;
    defaultTitle?: string;
    memoryDecision?: (input: PromptAwareModelInput) => PromptAwareMemoryDecision | undefined;
    allowRepeatedMemoryDecisions?: boolean;
  },
): LanguageModelV3 {
  const buildResponse = (
    options: LanguageModelV3CallOptions,
  ):
    | { kind: "text"; text: string }
    | { kind: "tool-call"; toolName: "mcp.memory.write"; input: string } => {
    const input = buildPromptAwareInput(options);
    if (input.isTitlePrompt) {
      return { kind: "text", text: opts?.defaultTitle?.trim() || "Behavior Test Session" };
    }

    if (
      opts?.memoryDecision &&
      (opts.allowRepeatedMemoryDecisions || !hasToolResult(options, "mcp.memory.write"))
    ) {
      const writeInput = resolveMemoryWriteInput(opts.memoryDecision(input));
      if (writeInput) {
        return {
          kind: "tool-call",
          toolName: "mcp.memory.write",
          input: JSON.stringify(writeInput),
        };
      }
    }

    return { kind: "text", text: responder(input) };
  };

  return {
    specificationVersion: "v3",
    provider: "test",
    modelId: opts?.modelId?.trim() || "prompt-aware",
    supportedUrls: {},
    async doGenerate(options): Promise<LanguageModelV3GenerateResult> {
      const response = buildResponse(options);
      return {
        content:
          response.kind === "tool-call"
            ? [
                {
                  type: "tool-call" as const,
                  toolCallId: "tc-memory-decision",
                  toolName: response.toolName,
                  input: response.input,
                },
              ]
            : [{ type: "text" as const, text: response.text }],
        finishReason: {
          unified: response.kind === "tool-call" ? ("tool-calls" as const) : ("stop" as const),
          raw: undefined,
        },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      };
    },
    async doStream(options): Promise<LanguageModelV3StreamResult> {
      const response = buildResponse(options);
      return {
        stream: simulateReadableStream({
          chunks:
            response.kind === "tool-call"
              ? [
                  {
                    type: "tool-call" as const,
                    toolCallId: "tc-memory-decision",
                    toolName: response.toolName,
                    input: response.input,
                  },
                  {
                    type: "finish" as const,
                    finishReason: { unified: "tool-calls" as const, raw: undefined },
                    logprobs: undefined,
                    usage: {
                      inputTokens: {
                        total: 10,
                        noCache: 10,
                        cacheRead: undefined,
                        cacheWrite: undefined,
                      },
                      outputTokens: {
                        total: 5,
                        text: 5,
                        reasoning: undefined,
                      },
                    },
                  },
                ]
              : [
                  { type: "text-start" as const, id: "text-1" },
                  { type: "text-delta" as const, id: "text-1", delta: response.text },
                  { type: "text-end" as const, id: "text-1" },
                  {
                    type: "finish" as const,
                    finishReason: { unified: "stop" as const, raw: undefined },
                    logprobs: undefined,
                    usage: {
                      inputTokens: {
                        total: 10,
                        noCache: 10,
                        cacheRead: undefined,
                        cacheWrite: undefined,
                      },
                      outputTokens: {
                        total: 5,
                        text: 5,
                        reasoning: undefined,
                      },
                    },
                  },
                ],
        }),
        warnings: [],
      };
    },
  };
}

export function makeTelegramDmMessage(input: {
  threadId: string;
  messageId: string;
  text: string;
  senderId?: string;
  accountId?: string;
}): NormalizedThreadMessage {
  const nowIso = new Date().toISOString();
  const senderId = input.senderId?.trim() || input.threadId;
  const accountId = input.accountId?.trim() || "default";

  return {
    thread: {
      id: input.threadId,
      kind: "private",
      title: undefined,
      username: undefined,
      pii_fields: [],
    },
    message: {
      id: input.messageId,
      thread_id: input.threadId,
      source: "telegram",
      content: { text: input.text, attachments: [] },
      sender: {
        id: senderId,
        is_bot: false,
        username: senderId,
      },
      timestamp: nowIso,
      edited_timestamp: undefined,
      pii_fields: ["message_text"],
      envelope: {
        message_id: input.messageId,
        received_at: nowIso,
        delivery: { channel: "telegram", account: accountId },
        container: { kind: "dm", id: input.threadId },
        sender: { id: senderId, display: senderId },
        content: { text: input.text, attachments: [] },
        provenance: ["user"],
      },
    },
  };
}
