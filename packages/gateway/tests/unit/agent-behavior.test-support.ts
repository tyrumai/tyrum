import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import type { NormalizedThreadMessage } from "@tyrum/schemas";

export const TITLE_PROMPT_TEXT = "Write a concise session title.";

const PROMPT_SECTION_LABELS = [
  "Enabled skills:",
  "Available tools:",
  "Session context:",
  "Work focus digest:",
  "Memory digest:",
  "Automation trigger:",
  "Automation digest:",
] as const;

function flattenPromptContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
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
    })
    .filter((value) => value.length > 0)
    .join("\n");
}

export function extractPromptText(options: LanguageModelV3CallOptions): string {
  return (options.prompt ?? [])
    .map((entry) => flattenPromptContent(entry.content))
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
  const nextLabels = PROMPT_SECTION_LABELS.filter((candidate) => candidate !== label)
    .map(escapeRegex)
    .join("|");
  const pattern = new RegExp(
    `${escapeRegex(label)}\\n([\\s\\S]*?)(?=\\n(?:${nextLabels})\\n|$)`,
    "u",
  );
  return promptText.match(pattern)?.[1]?.trim() ?? "";
}

export type PromptAwareModelInput = {
  promptText: string;
  systemText: string;
  isTitlePrompt: boolean;
  options: LanguageModelV3CallOptions;
};

export function promptIncludes(promptText: string, needle: string): boolean {
  return promptText.toLowerCase().includes(needle.trim().toLowerCase());
}

export function createPromptAwareLanguageModel(
  responder: (input: PromptAwareModelInput) => string,
  opts?: { modelId?: string; defaultTitle?: string },
): LanguageModelV3 {
  const buildResponse = (options: LanguageModelV3CallOptions): string => {
    const prompt = options.prompt ?? [];
    const systemEntry = prompt.find((entry) => entry.role === "system");
    const systemText = flattenPromptContent(systemEntry?.content);
    const isTitlePrompt = systemText.includes(TITLE_PROMPT_TEXT);
    if (isTitlePrompt) {
      return opts?.defaultTitle?.trim() || "Behavior Test Session";
    }
    return responder({
      promptText: extractPromptText(options),
      systemText,
      isTitlePrompt,
      options,
    });
  };

  return {
    specificationVersion: "v3",
    provider: "test",
    modelId: opts?.modelId?.trim() || "prompt-aware",
    supportedUrls: {},
    async doGenerate(options): Promise<LanguageModelV3GenerateResult> {
      const text = buildResponse(options);
      return {
        content: [{ type: "text" as const, text }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      };
    },
    async doStream(options): Promise<LanguageModelV3StreamResult> {
      const text = buildResponse(options);
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start" as const, id: "text-1" },
            { type: "text-delta" as const, id: "text-1", delta: text },
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
      content: { kind: "text", text: input.text },
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
