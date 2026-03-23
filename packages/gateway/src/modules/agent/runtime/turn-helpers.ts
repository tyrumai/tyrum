import { randomUUID } from "node:crypto";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import type {
  AgentTurnRequest as AgentTurnRequestT,
  ApprovalKind as ApprovalKindT,
  NormalizedContainerKind,
  NormalizedMessageEnvelope as NormalizedMessageEnvelopeT,
  TyrumUIMessagePart,
} from "@tyrum/contracts";
import type { ModelMessage } from "ai";
import { coerceModelMessages } from "../../ai-sdk/message-utils.js";
import { normalizeTurnParts, renderTurnPartsText } from "../../ai-sdk/attachment-parts.js";
import { coerceRecord } from "../../util/coerce.js";
import { buildAgentTurnKey } from "../turn-key.js";
import type { LaneQueueScope } from "./turn-engine-bridge.js";
import type { ManagedDesktopAttachmentSummary } from "../../desktop-environments/managed-desktop-attachment-service.js";

export function createStaticLanguageModelV3(text: string): LanguageModelV3 {
  const finishReason = { unified: "stop" as const, raw: "stop" };
  const usage = {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  };

  return {
    specificationVersion: "v3",
    provider: "tyrum",
    modelId: "static",
    supportedUrls: {},
    doGenerate: async (
      _options: LanguageModelV3CallOptions,
    ): Promise<LanguageModelV3GenerateResult> => {
      return {
        content: [{ type: "text", text }],
        finishReason,
        usage,
        warnings: [],
      };
    },
    doStream: async (
      _options: LanguageModelV3CallOptions,
    ): Promise<LanguageModelV3StreamResult> => {
      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            const id = randomUUID();
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id });
            controller.enqueue({ type: "text-delta", id, delta: text });
            controller.enqueue({ type: "text-end", id });
            controller.enqueue({ type: "finish", usage, finishReason });
            controller.close();
          },
        }),
      };
    },
  };
}

export type StepPauseRequest = {
  kind: ApprovalKindT;
  prompt: string;
  detail: string;
  context?: unknown;
  expiresAt?: string | null;
};

export class ToolExecutionApprovalRequiredError extends Error {
  constructor(public readonly pause: StepPauseRequest) {
    super(pause.prompt);
    this.name = "ToolExecutionApprovalRequiredError";
  }
}

type ToolApprovalResumeState = {
  approval_id: string;
  messages: ModelMessage[];
  used_tools?: string[];
  memory_written?: boolean;
  steps_used?: number;
};

export function extractToolApprovalResumeState(
  context: unknown,
): ToolApprovalResumeState | undefined {
  const record = coerceRecord(context);
  if (!record) return undefined;
  if (record["source"] !== "agent-tool-execution") return undefined;
  const ai = coerceRecord(record["ai_sdk"]);
  if (!ai) return undefined;
  const approvalId = typeof ai["approval_id"] === "string" ? ai["approval_id"].trim() : "";
  if (approvalId.length === 0) return undefined;
  const messages = coerceModelMessages(ai["messages"]);
  if (!messages) return undefined;
  const usedToolsRaw = ai["used_tools"];
  const usedTools = Array.isArray(usedToolsRaw)
    ? usedToolsRaw.filter((value): value is string => typeof value === "string")
    : undefined;

  const stepsUsedRaw = ai["steps_used"];
  const stepsUsed =
    typeof stepsUsedRaw === "number" &&
    Number.isFinite(stepsUsedRaw) &&
    Number.isSafeInteger(stepsUsedRaw) &&
    stepsUsedRaw >= 0
      ? stepsUsedRaw
      : undefined;

  return {
    approval_id: approvalId,
    messages,
    used_tools: usedTools,
    memory_written: ai["memory_written"] === true,
    steps_used: stepsUsed,
  };
}

export function buildSandboxPrompt(input: {
  hardeningProfile: "baseline" | "hardened";
  attachment?: ManagedDesktopAttachmentSummary;
}): string {
  const lines = [
    "Sandbox:",
    "Execution constraints are enforced by the gateway.",
    `hardening_profile=${input.hardeningProfile}`,
  ];
  if (input.attachment?.managed_desktop_attached) {
    lines.push(
      "managed_desktop_attached=true",
      `desktop_environment_id=${input.attachment.desktop_environment_id}`,
    );
    if (input.attachment.attached_node_id) {
      lines.push(`attached_node_id=${input.attachment.attached_node_id}`);
    }
    lines.push(
      "exclusive_control=true",
      "handoff_available=true",
      "release_behavior=delete_on_release",
    );
  } else {
    lines.push("managed_desktop_attached=false");
  }
  return lines.join("\n");
}

export function resolveAgentId(): string {
  return "default";
}

export function resolveTurnRequestId(input: AgentTurnRequestT): string {
  const raw = input.metadata?.["request_id"];
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  return `agent-turn-${randomUUID()}`;
}

export type ResolvedAgentTurnInput = {
  channel: string;
  thread_id: string;
  message: string;
  parts: TyrumUIMessagePart[];
  envelope?: NormalizedMessageEnvelopeT;
  metadata?: Record<string, unknown>;
};

export function resolveAgentTurnInput(input: AgentTurnRequestT): ResolvedAgentTurnInput {
  const envelope = input.envelope;
  const channel = envelope?.delivery.channel ?? input.channel;
  const threadId = envelope?.container.id ?? input.thread_id;

  if (typeof channel !== "string" || channel.trim().length === 0) {
    throw new Error("channel is required");
  }
  if (typeof threadId !== "string" || threadId.trim().length === 0) {
    throw new Error("thread_id is required");
  }

  const parts = normalizeTurnParts({
    envelope,
    parts: input.parts,
  });
  const message = renderTurnPartsText(parts);

  if (message.length === 0) {
    throw new Error("turn input is required (parts or envelope content)");
  }

  return {
    channel,
    thread_id: threadId,
    message,
    parts,
    envelope,
    metadata: input.metadata,
  };
}

export function resolveLaneQueueScope(
  metadata: Record<string, unknown> | undefined,
): LaneQueueScope | undefined {
  if (!metadata) return undefined;

  const rawKey = metadata["tyrum_key"];
  const rawLane = metadata["lane"];

  const key = typeof rawKey === "string" ? rawKey.trim() : "";
  const lane = typeof rawLane === "string" ? rawLane.trim() : "";
  if (key.length === 0 || lane.length === 0) return undefined;

  return { key, lane };
}

export function resolveMainLaneSessionKey(input: {
  agentId: string;
  workspaceId: string;
  resolved: ResolvedAgentTurnInput;
  containerKind: NormalizedContainerKind;
  deliveryAccount?: string;
}): string {
  const laneQueueScope = resolveLaneQueueScope(input.resolved.metadata);
  if (laneQueueScope?.lane === "main") {
    return laneQueueScope.key;
  }

  return buildAgentTurnKey({
    agentId: input.agentId,
    workspaceId: input.workspaceId,
    channel: input.resolved.channel,
    containerKind: input.containerKind,
    threadId: input.resolved.thread_id,
    deliveryAccount: input.deliveryAccount,
  });
}

export function isStatusQuery(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return normalized === "status?" || normalized === "status";
}
