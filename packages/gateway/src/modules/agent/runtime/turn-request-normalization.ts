import type { AgentTurnRequest as AgentTurnRequestT, TyrumUIMessagePart } from "@tyrum/schemas";

type MaybeLegacyTurnRequest = AgentTurnRequestT & {
  message?: unknown;
};

function cloneParts(
  parts: readonly TyrumUIMessagePart[] | undefined,
): TyrumUIMessagePart[] | undefined {
  return parts?.map((part) => ({ ...part }));
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

export function normalizeInternalTurnRequestUnknown(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  return normalizeInternalTurnRequest(value as AgentTurnRequestT);
}
