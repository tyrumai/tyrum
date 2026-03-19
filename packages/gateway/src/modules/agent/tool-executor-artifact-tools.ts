import { makeToolResult, parseStringArg } from "./tool-executor-local-utils.js";
import type { ToolResult } from "./tool-executor-shared.js";

export interface ArtifactDescribeToolRuntime {
  describe(input: { artifactIds: string[]; prompt?: string; toolCallId: string }): Promise<string>;
}

function normalizeArtifactIds(args: Record<string, unknown> | null): string[] {
  const artifactId = parseStringArg(args, "artifact_id")?.trim() ?? "";
  const artifactIds = Array.isArray(args?.["artifact_ids"])
    ? args["artifact_ids"]
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : [];
  return Array.from(new Set([artifactId, ...artifactIds].filter((value) => value.length > 0)));
}

export async function executeArtifactDescribeTool(
  runtime: ArtifactDescribeToolRuntime | undefined,
  toolId: string,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult | null> {
  if (toolId !== "artifact.describe") {
    return null;
  }

  if (!runtime) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "artifact analysis is not configured",
    };
  }

  const record =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : null;
  const artifactIds = normalizeArtifactIds(record);
  if (artifactIds.length === 0) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "artifact.describe requires artifact_id or artifact_ids",
    };
  }

  const prompt = parseStringArg(record, "prompt")?.trim() || undefined;
  const output = await runtime.describe({
    artifactIds,
    prompt,
    toolCallId,
  });
  return makeToolResult(toolCallId, output, "tool");
}
