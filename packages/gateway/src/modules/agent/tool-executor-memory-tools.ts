import { z } from "zod";
import { AgentMemoryToolRuntime } from "../memory/agent-tool-runtime.js";
import { makeToolResult } from "./tool-executor-local-utils.js";
import type { ToolResult } from "./tool-executor-shared.js";

const MemoryKindSchema = z.enum(["fact", "note", "procedure", "episode"]);
const WritableMemorySensitivitySchema = z.enum(["public", "private"]);

const MemorySearchArgsSchema = z
  .object({
    query: z.string().trim().min(1),
    kinds: z.array(MemoryKindSchema).max(4).optional(),
    tags: z.array(z.string().trim().min(1)).max(20).optional(),
    limit: z.number().int().min(1).max(10).optional(),
  })
  .strict();

const MemoryAddArgsSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("fact"),
      key: z.string().trim().min(1),
      value: z.unknown(),
      confidence: z.number().min(0).max(1).optional(),
      observed_at: z.string().trim().min(1).optional(),
      tags: z.array(z.string().trim().min(1)).max(20).optional(),
      sensitivity: WritableMemorySensitivitySchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("note"),
      title: z.string().trim().min(1).optional(),
      body_md: z.string().trim().min(1),
      tags: z.array(z.string().trim().min(1)).max(20).optional(),
      sensitivity: WritableMemorySensitivitySchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("procedure"),
      title: z.string().trim().min(1).optional(),
      body_md: z.string().trim().min(1),
      confidence: z.number().min(0).max(1).optional(),
      tags: z.array(z.string().trim().min(1)).max(20).optional(),
      sensitivity: WritableMemorySensitivitySchema.optional(),
    })
    .strict(),
]);

function invalidArgs(toolCallId: string, error: string): ToolResult {
  return {
    tool_call_id: toolCallId,
    output: "",
    error,
  };
}

export async function executeMemoryTool(
  runtime: AgentMemoryToolRuntime | undefined,
  toolId: string,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult | null> {
  if (toolId !== "memory.search" && toolId !== "memory.add") {
    return null;
  }
  if (!runtime) {
    return invalidArgs(toolCallId, "memory tools are not configured");
  }

  if (toolId === "memory.search") {
    const parsed = MemorySearchArgsSchema.safeParse(args);
    if (!parsed.success) {
      return invalidArgs(
        toolCallId,
        parsed.error.issues[0]?.message ?? "invalid memory.search arguments",
      );
    }
    return makeToolResult(
      toolCallId,
      JSON.stringify(await runtime.search(parsed.data), null, 2),
      "tool",
    );
  }

  const parsed = MemoryAddArgsSchema.safeParse(args);
  if (!parsed.success) {
    return invalidArgs(
      toolCallId,
      parsed.error.issues[0]?.message ?? "invalid memory.add arguments",
    );
  }
  return makeToolResult(
    toolCallId,
    JSON.stringify(await runtime.add(parsed.data, toolCallId), null, 2),
    "tool",
  );
}
