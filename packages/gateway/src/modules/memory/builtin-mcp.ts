import {
  type AgentConfig as AgentConfigT,
  BuiltinMemorySearchArgs,
  BuiltinMemoryServerSettings,
  BuiltinMemorySeedArgs,
  BuiltinMemoryWriteArgs,
  type BuiltinMemoryServerSettings as BuiltinMemoryServerSettingsT,
  type McpServerSpec as McpServerSpecT,
} from "@tyrum/contracts";
import { makeToolResult } from "../agent/tool-executor-local-utils.js";
import type { ToolResult } from "../agent/tool-executor-shared.js";
import type { McpToolInfo } from "../agent/mcp-manager.js";
import type { AgentMemoryToolRuntime } from "./agent-tool-runtime.js";

export const BUILTIN_MEMORY_SERVER_ID = "memory";

export type BuiltinMcpToolInfo = McpToolInfo & {
  effect?: "read_only" | "state_changing";
  keywords?: string[];
};

export function buildBuiltinMemoryServerSpec(): McpServerSpecT {
  return {
    id: BUILTIN_MEMORY_SERVER_ID,
    name: "Memory",
    enabled: true,
    transport: "stdio",
    command: process.execPath,
    args: ["-e", ""],
    tool_overrides: {
      seed: {
        pre_turn_hydration: {
          prompt_arg_name: "query",
          include_turn_context: true,
        },
        memory_role: "seed",
      },
      search: {
        memory_role: "search",
      },
      write: {
        memory_role: "write",
      },
    },
  };
}

export const BUILTIN_MEMORY_MCP_TOOLS: readonly BuiltinMcpToolInfo[] = [
  {
    name: "seed",
    description:
      "Return prompt-ready durable memory relevant to the current user request. Use this as pre-turn recall context; the gateway may invoke it automatically before a turn.",
    effect: "read_only",
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
    effect: "read_only",
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
      "Persist durable memory for this agent when the turn yields stable, reusable information. Use facts, notes, procedures, or episodes. Required fields by kind: fact requires key and value; note and procedure require body_md; episode requires summary_md. Do not store secrets, raw transcripts, or boilerplate.",
    effect: "state_changing",
    keywords: ["memory", "remember", "store", "write", "fact", "procedure"],
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["fact", "note", "procedure", "episode"],
          description:
            "Memory kind. fact requires key and value; note and procedure require body_md; episode requires summary_md.",
        },
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
    const parsed = BuiltinMemorySeedArgs.safeParse(params.args);
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
        query: typeof result.query === "string" ? result.query : undefined,
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
    const parsed = BuiltinMemorySearchArgs.safeParse(params.args);
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
    const parsed = BuiltinMemoryWriteArgs.safeParse(params.args);
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
