import {
  type AgentConfig as AgentConfigT,
  BuiltinMemoryServerSettings,
  type BuiltinMemoryServerSettings as BuiltinMemoryServerSettingsT,
  type McpServerSpec as McpServerSpecT,
} from "@tyrum/schemas";
import { z } from "zod";
import type { ToolRisk } from "../agent/tools.js";
import { makeToolResult } from "../agent/tool-executor-local-utils.js";
import type { ToolResult } from "../agent/tool-executor-shared.js";
import type { McpToolInfo } from "../agent/mcp-manager.js";
import type { AgentMemoryToolRuntime } from "./agent-tool-runtime.js";

export const BUILTIN_MEMORY_SERVER_ID = "memory";

export type BuiltinMcpToolInfo = McpToolInfo & {
  risk?: ToolRisk;
  requiresConfirmation?: boolean;
  keywords?: string[];
};

const MemorySearchArgsSchema = z
  .object({
    query: z.string().trim().min(1),
    kinds: z
      .array(z.enum(["fact", "note", "procedure", "episode"]))
      .max(4)
      .optional(),
    tags: z.array(z.string().trim().min(1)).max(20).optional(),
    limit: z.number().int().min(1).max(10).optional(),
  })
  .strict();

const MemoryWriteArgsSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("fact"),
      key: z.string().trim().min(1),
      value: z.unknown(),
      confidence: z.number().min(0).max(1).optional(),
      observed_at: z.string().trim().min(1).optional(),
      tags: z.array(z.string().trim().min(1)).max(20).optional(),
      sensitivity: z.enum(["public", "private"]).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("note"),
      title: z.string().trim().min(1).optional(),
      body_md: z.string().trim().min(1),
      tags: z.array(z.string().trim().min(1)).max(20).optional(),
      sensitivity: z.enum(["public", "private"]).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("procedure"),
      title: z.string().trim().min(1).optional(),
      body_md: z.string().trim().min(1),
      confidence: z.number().min(0).max(1).optional(),
      tags: z.array(z.string().trim().min(1)).max(20).optional(),
      sensitivity: z.enum(["public", "private"]).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("episode"),
      summary_md: z.string().trim().min(1),
      occurred_at: z.string().trim().min(1).optional(),
      tags: z.array(z.string().trim().min(1)).max(20).optional(),
      sensitivity: z.enum(["public", "private"]).optional(),
    })
    .strict(),
]);

const MemorySeedArgsSchema = z
  .object({
    query: z.string().trim().min(1),
    turn: z
      .object({
        agent_id: z.string().trim().min(1),
        workspace_id: z.string().trim().min(1).optional(),
        session_id: z.string().trim().min(1),
        channel: z.string().trim().min(1),
        thread_id: z.string().trim().min(1),
      })
      .partial()
      .optional(),
  })
  .strict();

export function buildBuiltinMemoryServerSpec(): McpServerSpecT {
  return {
    id: BUILTIN_MEMORY_SERVER_ID,
    name: "Memory",
    enabled: true,
    transport: "stdio",
    command: process.execPath,
    args: ["-e", ""],
  };
}

export const BUILTIN_MEMORY_MCP_TOOLS: readonly BuiltinMcpToolInfo[] = [
  {
    name: "seed",
    description:
      "Return prompt-ready durable memory relevant to the current user request. Use this as pre-turn recall context; the gateway may invoke it automatically before a turn.",
    risk: "low",
    requiresConfirmation: false,
    keywords: ["memory", "seed", "recall", "preferences", "context"],
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Current user request." },
        turn: {
          type: "object",
          description: "Current turn metadata for provider-side prompt hydration decisions.",
          properties: {
            agent_id: { type: "string" },
            workspace_id: { type: "string" },
            session_id: { type: "string" },
            channel: { type: "string" },
            thread_id: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "search",
    description:
      "Search this agent's durable memory for facts, notes, procedures, and episodes. Use when prior preferences, lessons, or context may matter.",
    risk: "low",
    requiresConfirmation: false,
    keywords: ["memory", "search", "recall", "preferences", "knowledge"],
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query for durable memory recall." },
        kinds: {
          type: "array",
          description: "Optional memory kind filter.",
          items: { type: "string", enum: ["fact", "note", "procedure", "episode"] },
        },
        tags: {
          type: "array",
          description: "Optional tag filters.",
          items: { type: "string" },
        },
        limit: {
          type: "number",
          description: "Optional result limit. Defaults to 5 and caps at 10.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "write",
    description:
      "Persist durable memory for this agent when the turn yields stable, reusable information. Use facts, notes, procedures, or episodes. Do not store secrets, raw transcripts, or boilerplate.",
    risk: "medium",
    requiresConfirmation: false,
    keywords: ["memory", "remember", "store", "write", "fact", "procedure"],
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["fact", "note", "procedure", "episode"] },
        key: { type: "string", description: "Stable fact key." },
        value: { description: "Structured fact value." },
        title: { type: "string" },
        body_md: { type: "string", description: "Durable note or procedure body." },
        summary_md: { type: "string", description: "Durable summary of an episode or outcome." },
        confidence: {
          type: "number",
          description: "Optional confidence score between 0 and 1.",
        },
        observed_at: {
          type: "string",
          description: "Optional ISO timestamp. Defaults to now.",
        },
        occurred_at: {
          type: "string",
          description: "Optional ISO timestamp for an episode. Defaults to now.",
        },
        tags: { type: "array", items: { type: "string" } },
        sensitivity: { type: "string", enum: ["public", "private"] },
      },
      required: ["kind"],
      additionalProperties: false,
      oneOf: [
        {
          properties: { kind: { type: "string", enum: ["fact"] } },
          required: ["kind", "key", "value"],
        },
        {
          properties: { kind: { type: "string", enum: ["note"] } },
          required: ["kind", "body_md"],
        },
        {
          properties: { kind: { type: "string", enum: ["procedure"] } },
          required: ["kind", "body_md"],
        },
        {
          properties: { kind: { type: "string", enum: ["episode"] } },
          required: ["kind", "summary_md"],
        },
      ],
    },
  },
];

export function resolveBuiltinMemoryConfig(config: AgentConfigT): BuiltinMemoryServerSettingsT {
  return BuiltinMemoryServerSettings.parse(
    config.mcp.server_settings[BUILTIN_MEMORY_SERVER_ID] ?? {},
  );
}

function invalidArgs(toolCallId: string, error: string): ToolResult {
  return {
    tool_call_id: toolCallId,
    output: "",
    error,
  };
}

export async function executeBuiltinMemoryMcpTool(params: {
  runtime: AgentMemoryToolRuntime | undefined;
  toolId: string;
  toolCallId: string;
  args: unknown;
}): Promise<ToolResult | null> {
  if (!params.toolId.startsWith(`mcp.${BUILTIN_MEMORY_SERVER_ID}.`)) {
    return null;
  }
  if (!params.runtime) {
    return invalidArgs(params.toolCallId, "built-in memory MCP is not configured");
  }

  const toolName = params.toolId.slice(`mcp.${BUILTIN_MEMORY_SERVER_ID}.`.length);
  if (toolName === "seed") {
    const parsed = MemorySeedArgsSchema.safeParse(params.args);
    if (!parsed.success) {
      return invalidArgs(
        params.toolCallId,
        parsed.error.issues[0]?.message ?? "invalid mcp.memory.seed arguments",
      );
    }
    const result = await params.runtime.seed(parsed.data);
    return {
      ...makeToolResult(params.toolCallId, result.digest as string, "tool"),
      meta: {
        kind: "memory.seed",
        keyword_hit_count: Number(result.keyword_hit_count ?? 0),
        semantic_hit_count: Number(result.semantic_hit_count ?? 0),
        structured_item_count: Number(result.structured_item_count ?? 0),
        included_item_ids: Array.isArray(result.included_item_ids)
          ? (result.included_item_ids as string[])
          : [],
      },
    };
  }

  if (toolName === "search") {
    const parsed = MemorySearchArgsSchema.safeParse(params.args);
    if (!parsed.success) {
      return invalidArgs(
        params.toolCallId,
        parsed.error.issues[0]?.message ?? "invalid mcp.memory.search arguments",
      );
    }
    return makeToolResult(
      params.toolCallId,
      JSON.stringify(await params.runtime.search(parsed.data), null, 2),
      "tool",
    );
  }

  if (toolName === "write") {
    const parsed = MemoryWriteArgsSchema.safeParse(params.args);
    if (!parsed.success) {
      return invalidArgs(
        params.toolCallId,
        parsed.error.issues[0]?.message ?? "invalid mcp.memory.write arguments",
      );
    }
    return makeToolResult(
      params.toolCallId,
      JSON.stringify(await params.runtime.write(parsed.data, params.toolCallId), null, 2),
      "tool",
    );
  }

  return invalidArgs(params.toolCallId, `unsupported built-in memory MCP tool: ${toolName}`);
}
