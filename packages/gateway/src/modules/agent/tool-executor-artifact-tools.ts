import { normalizeArtifactDescribeArgs } from "../artifact/describe-args.js";
import { makeToolResult } from "./tool-executor-local-utils.js";
import type { ToolResult } from "./tool-executor-shared.js";

export interface ArtifactDescribeToolRuntime {
  describe(input: { artifactIds: string[]; prompt?: string; toolCallId: string }): Promise<string>;
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
  const { artifactIds, prompt } = normalizeArtifactDescribeArgs(record);
  if (artifactIds.length === 0) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "artifact.describe requires artifact_id or artifact_ids",
    };
  }

  const output = await runtime.describe({
    artifactIds,
    prompt,
    toolCallId,
  });
  return makeToolResult(toolCallId, output, "tool");
}
