import type { AgentTurnRequest as AgentTurnRequestT, TyrumUIMessagePart } from "@tyrum/schemas";
import { createArtifactFilePart } from "../../ai-sdk/attachment-parts.js";

type MaybeLegacyTurnRequest = AgentTurnRequestT & {
  message?: unknown;
};

function cloneParts(
  parts: readonly TyrumUIMessagePart[] | undefined,
): TyrumUIMessagePart[] | undefined {
  return parts?.map((part) => ({ ...part }));
}

function buildLegacyMessageParts(input: MaybeLegacyTurnRequest): TyrumUIMessagePart[] | undefined {
  const legacyMessage = input.message;
  if (typeof legacyMessage !== "string") {
    return undefined;
  }

  const text = legacyMessage.trim();
  if (text.length === 0) {
    return undefined;
  }

  const attachmentParts =
    input.envelope?.content.attachments
      .map((attachment) => createArtifactFilePart(attachment))
      .filter((part) => part !== undefined) ?? [];

  return [{ type: "text", text }, ...attachmentParts];
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

  const normalizedParts = buildLegacyMessageParts(input as MaybeLegacyTurnRequest);
  if (!normalizedParts) {
    return { ...input };
  }

  return {
    ...input,
    parts: normalizedParts,
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
