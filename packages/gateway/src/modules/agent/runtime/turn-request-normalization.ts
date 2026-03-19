import type { AgentTurnRequest as AgentTurnRequestT, TyrumUIMessagePart } from "@tyrum/schemas";

type MaybeLegacyTurnRequest = AgentTurnRequestT & {
  message?: unknown;
};

function cloneParts(
  parts: readonly TyrumUIMessagePart[] | undefined,
): TyrumUIMessagePart[] | undefined {
  return parts?.map((part) => ({ ...part }));
}

function shouldNormalizeLegacyMessage(input: MaybeLegacyTurnRequest): boolean {
  if (input.parts && input.parts.length > 0) {
    return false;
  }

  const legacyMessage = input.message;
  return typeof legacyMessage === "string" && legacyMessage.trim().length > 0;
}

export function normalizeInternalTurnRequest(input: AgentTurnRequestT): AgentTurnRequestT {
  const parts = cloneParts(input.parts);
  if (parts && parts.length > 0) {
    return { ...input, parts };
  }

  const legacyMessage = (input as MaybeLegacyTurnRequest).message;
  if (typeof legacyMessage !== "string") {
    return { ...input };
  }

  const text = legacyMessage.trim();
  if (text.length === 0) {
    return { ...input };
  }

  return {
    ...input,
    parts: [{ type: "text", text }],
  };
}

export function normalizeInternalTurnRequestIfNeeded(input: AgentTurnRequestT): AgentTurnRequestT {
  return shouldNormalizeLegacyMessage(input as MaybeLegacyTurnRequest)
    ? normalizeInternalTurnRequest(input)
    : input;
}

export function normalizeInternalTurnRequestUnknown(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  return normalizeInternalTurnRequestIfNeeded(value as AgentTurnRequestT);
}
