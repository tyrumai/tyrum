import type { ArtifactRef } from "@tyrum/schemas";
import {
  getToolName,
  isDataUIPart,
  isFileUIPart,
  isReasoningUIPart,
  isTextUIPart,
  isToolUIPart,
  type UIMessage,
} from "ai";
import { toast } from "sonner";
import { isRecord } from "../../utils/is-record.js";
import { useClipboard } from "../../utils/clipboard.js";

export function readCreatedAt(message: UIMessage): string | null {
  const metadata = isRecord(message.metadata) ? message.metadata : null;
  const createdAt =
    typeof metadata?.["created_at"] === "string"
      ? metadata["created_at"]
      : typeof metadata?.["createdAt"] === "string"
        ? metadata["createdAt"]
        : null;
  return createdAt && createdAt.trim().length > 0 ? createdAt : null;
}

export function readRunId(message: UIMessage): string | null {
  const metadata = isRecord(message.metadata) ? message.metadata : null;
  const runId = typeof metadata?.["run_id"] === "string" ? metadata["run_id"].trim() : "";
  return runId.length > 0 ? runId : null;
}

export function readRunIdFromValue(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const runId = typeof value["run_id"] === "string" ? value["run_id"].trim() : "";
  return runId.length > 0 ? runId : null;
}

export function stringifyPart(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

export function copyToClipboard(clipboard: ReturnType<typeof useClipboard>, value: string): void {
  void clipboard
    .writeText(value)
    .then(() => {
      toast.success("Copied to clipboard");
    })
    .catch(() => {
      toast.error("Failed to copy to clipboard");
    });
}

export function formatToolState(state: string): string {
  return state.replace(/-/g, " ");
}

export function isArtifactRef(value: unknown): value is ArtifactRef {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value["artifact_id"] === "string" &&
    typeof value["uri"] === "string" &&
    typeof value["kind"] === "string" &&
    typeof value["created_at"] === "string"
  );
}

export function collectArtifactRefs(
  value: unknown,
  seen = new Set<string>(),
  refs: ArtifactRef[] = [],
): ArtifactRef[] {
  if (isArtifactRef(value)) {
    if (!seen.has(value.artifact_id)) {
      seen.add(value.artifact_id);
      refs.push(value);
    }
    return refs;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectArtifactRefs(item, seen, refs);
    }
    return refs;
  }
  if (!isRecord(value)) {
    return refs;
  }
  for (const nested of Object.values(value)) {
    collectArtifactRefs(nested, seen, refs);
  }
  return refs;
}

export function textFromMessage(message: UIMessage): string {
  const lines: string[] = [];
  for (const part of message.parts) {
    if (isTextUIPart(part) || isReasoningUIPart(part)) {
      lines.push(part.text);
      continue;
    }
    if (isToolUIPart(part)) {
      lines.push(`${getToolName(part)} (${part.state})`);
      continue;
    }
    if (isDataUIPart(part)) {
      lines.push(`${part.type}: ${stringifyPart(part.data)}`);
      continue;
    }
    if (part.type === "source-url") {
      lines.push(`Source: ${part.title ? `${part.title} ` : ""}${part.url}`.trim());
      continue;
    }
    if (part.type === "source-document") {
      lines.push(
        `Source document: ${part.title} (${part.mediaType})${
          part.filename ? ` [${part.filename}]` : ""
        }`,
      );
      continue;
    }
    if (isFileUIPart(part)) {
      lines.push(
        `File: ${part.filename ? `${part.filename} ` : ""}(${part.mediaType}) ${part.url}`.trim(),
      );
    }
  }
  return lines.join("\n\n");
}
