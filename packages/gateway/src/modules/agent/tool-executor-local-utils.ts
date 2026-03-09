import { tagContent } from "./provenance.js";
import { sanitizeForModel } from "./sanitizer.js";
import { MAX_RESPONSE_BYTES, TRUNCATION_MARKER } from "./tool-executor-shared.js";
import type { ToolResult } from "./tool-executor-shared.js";

function truncateOutput(output: string): string {
  return output.length > MAX_RESPONSE_BYTES
    ? `${output.slice(0, MAX_RESPONSE_BYTES)}${TRUNCATION_MARKER}`
    : output;
}

export function parseStringArg(
  args: Record<string, unknown> | null,
  key: string,
): string | undefined {
  return typeof args?.[key] === "string" ? (args[key] as string) : undefined;
}

export function parseNumberArg(
  args: Record<string, unknown> | null,
  key: string,
): number | undefined {
  const value = args?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function parseBooleanArg(
  args: Record<string, unknown> | null,
  key: string,
): boolean | undefined {
  return typeof args?.[key] === "boolean" ? (args[key] as boolean) : undefined;
}

export function resolvePathArg(args: Record<string, unknown> | null): string | undefined {
  return parseStringArg(args, "path") ?? parseStringArg(args, "filePath");
}

export function makeToolResult(
  toolCallId: string,
  output: string,
  source: "tool" | "web",
): ToolResult {
  const tagged = tagContent(truncateOutput(output), source, false);
  return {
    tool_call_id: toolCallId,
    output: sanitizeForModel(tagged),
    provenance: tagged,
  };
}

export function normalizeTextForPatching(value: string): {
  text: string;
  hasTrailingNewline: boolean;
} {
  return {
    text: value.replaceAll("\r\n", "\n"),
    hasTrailingNewline: value.endsWith("\n"),
  };
}

export function renderPatchedText(text: string, hasTrailingNewline: boolean): string {
  return hasTrailingNewline || text.length === 0
    ? `${text}${text.endsWith("\n") ? "" : "\n"}`
    : text;
}

export function selectReadContent(content: string, offset?: number, limit?: number): string {
  if (offset === undefined && limit === undefined) return content;
  const lines = content.split("\n");
  const start = offset ?? 0;
  const selected = limit !== undefined ? lines.slice(start, start + limit) : lines.slice(start);
  return selected.join("\n");
}
