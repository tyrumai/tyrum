import type { ToolDescriptor } from "./tools.js";
import { SUBAGENT_TOOL_REGISTRY } from "./tool-catalog-subagent.js";
import { WORKBOARD_TOOL_REGISTRY } from "./tool-catalog-workboard.js";

export const BUILTIN_TOOL_REGISTRY: readonly ToolDescriptor[] = [
  {
    id: "read",
    description: "Read files from the local filesystem.",
    risk: "low",
    requires_confirmation: false,
    keywords: ["read", "file", "open", "inspect", "view", "log"],
    source: "builtin",
    family: "filesystem",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or workspace-relative path to the file." },
        offset: {
          type: "number",
          description: "Optional line offset to start reading from (0-indexed).",
        },
        limit: {
          type: "number",
          description: "Optional maximum number of lines to return.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    id: "write",
    description: "Write a file in the local filesystem.",
    risk: "high",
    requires_confirmation: true,
    keywords: ["write", "edit", "update", "patch", "create", "file"],
    source: "builtin",
    family: "filesystem",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or workspace-relative path to write." },
        content: { type: "string", description: "File content to write." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    id: "edit",
    description: "Edit an existing file by replacing exact text.",
    risk: "high",
    requires_confirmation: true,
    keywords: ["edit", "replace", "patch", "update", "string", "file"],
    source: "builtin",
    family: "filesystem",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or workspace-relative path to edit." },
        old_string: { type: "string", description: "Exact text to replace." },
        new_string: { type: "string", description: "Replacement text." },
        replace_all: {
          type: "boolean",
          description: "Replace all occurrences instead of exactly one.",
        },
      },
      required: ["path", "old_string", "new_string"],
      additionalProperties: false,
    },
  },
  {
    id: "apply_patch",
    description: "Apply a structured patch using the Codex *** Begin Patch format.",
    risk: "high",
    requires_confirmation: true,
    keywords: ["patch", "diff", "apply", "edit", "update", "file"],
    source: "builtin",
    family: "filesystem",
    inputSchema: {
      type: "object",
      properties: {
        patch: { type: "string", description: "Structured patch text to apply." },
      },
      required: ["patch"],
      additionalProperties: false,
    },
  },
  {
    id: "bash",
    description: "Execute shell commands on the local machine.",
    risk: "high",
    requires_confirmation: true,
    keywords: ["run", "command", "shell", "terminal", "execute", "build"],
    source: "builtin",
    family: "shell",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute." },
        cwd: {
          type: "string",
          description: "Optional working directory (absolute or workspace-relative).",
        },
        timeout_ms: { type: "number", description: "Optional timeout in milliseconds." },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    id: "glob",
    description: "Find files in the workspace using a glob pattern.",
    risk: "low",
    requires_confirmation: false,
    keywords: ["glob", "files", "find", "match", "pattern", "search"],
    source: "builtin",
    family: "filesystem",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern to match." },
        path: { type: "string", description: "Optional workspace-relative base path." },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  {
    id: "grep",
    description: "Search files in the workspace for text or a regular expression.",
    risk: "low",
    requires_confirmation: false,
    keywords: ["grep", "search", "regex", "text", "find", "pattern"],
    source: "builtin",
    family: "filesystem",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Text or regex pattern to search for." },
        path: { type: "string", description: "Optional workspace-relative base path." },
        include: { type: "string", description: "Optional glob filter for files." },
        regex: { type: "boolean", description: "Treat pattern as a regular expression." },
        ignore_case: { type: "boolean", description: "Case-insensitive search." },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  {
    id: "websearch",
    description: "Search the web via Exa's hosted MCP server.",
    risk: "medium",
    requires_confirmation: true,
    keywords: ["search", "web", "internet", "research", "exa", "lookup"],
    source: "builtin_mcp",
    family: "web",
    backingServerId: "exa",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query." },
        type: {
          type: "string",
          enum: ["auto", "fast", "keyword", "neural", "deep"],
          description: "Optional Exa search mode.",
        },
        num_results: { type: "number", description: "Optional maximum number of results." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    id: "webfetch",
    description: "Fetch and normalize web content via Exa's hosted MCP server.",
    risk: "medium",
    requires_confirmation: true,
    keywords: ["fetch", "crawl", "web", "url", "extract", "research"],
    source: "builtin_mcp",
    family: "web",
    backingServerId: "exa",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch." },
        mode: {
          type: "string",
          enum: ["extract", "raw"],
          description:
            "Extract returns prompt-scoped crawl context; raw returns normalized content.",
        },
        prompt: {
          type: "string",
          description: "Extraction prompt used when mode is extract.",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    id: "codesearch",
    description: "Search for code or documentation context via Exa's hosted MCP server.",
    risk: "medium",
    requires_confirmation: true,
    keywords: ["code", "docs", "search", "reference", "api", "exa"],
    source: "builtin_mcp",
    family: "web",
    backingServerId: "exa",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Code or documentation search query." },
        tokens_num: { type: "number", description: "Optional token budget for returned context." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.node.list",
    description: "List connected and dispatchable nodes for the current lane or a specified lane.",
    risk: "low",
    requires_confirmation: false,
    keywords: ["node", "device", "inventory", "list", "discover"],
    source: "builtin",
    family: "node",
    inputSchema: {
      type: "object",
      properties: {
        capability: {
          type: "string",
          description:
            "Optional exact capability descriptor id filter (example: tyrum.desktop.query).",
        },
        dispatchable_only: {
          type: "boolean",
          description: "When true, return only nodes with at least one dispatchable action.",
        },
        key: {
          type: "string",
          description: "Optional session key used to resolve lane attachment.",
        },
        lane: {
          type: "string",
          description: "Optional lane used to resolve lane attachment.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    id: "tool.node.inspect",
    description: "Inspect the enabled actions for a specific connected node capability.",
    risk: "low",
    requires_confirmation: false,
    keywords: ["node", "device", "inspect", "capability", "actions"],
    source: "builtin",
    family: "node",
    inputSchema: {
      type: "object",
      properties: {
        node_id: {
          type: "string",
          description: "Target node id returned by tool.node.list.",
        },
        capability: {
          type: "string",
          description: "Exact capability descriptor id (example: tyrum.ios.location.get-current).",
        },
      },
      required: ["node_id", "capability"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.node.dispatch",
    description: "Dispatch a specific capability action to a connected node.",
    risk: "high",
    requires_confirmation: true,
    keywords: ["node", "device", "screen", "automation", "dispatch"],
    source: "builtin",
    family: "node",
    inputSchema: {
      type: "object",
      properties: {
        node_id: {
          type: "string",
          description: "Target node id returned by tool.node.list.",
        },
        capability: {
          type: "string",
          description: "Exact capability descriptor id (example: tyrum.android.audio.record-clip).",
        },
        action_name: {
          type: "string",
          description: "Capability action name discovered via tool.node.inspect.",
        },
        input: {
          type: "object",
          additionalProperties: {},
          description: "Action input object excluding the transport op field.",
        },
        timeout_ms: {
          type: "number",
          description: "Optional timeout in milliseconds (default: 30000).",
        },
      },
      required: ["node_id", "capability", "action_name"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.automation.schedule.list",
    description: "List automation schedules for the current or specified agent/workspace scope.",
    risk: "low",
    requires_confirmation: false,
    keywords: ["automation", "schedule", "heartbeat", "cron", "list"],
    source: "builtin",
    family: "automation",
    inputSchema: {
      type: "object",
      properties: {
        agent_key: { type: "string" },
        workspace_key: { type: "string" },
        include_deleted: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    id: "tool.automation.schedule.get",
    description: "Fetch a single automation schedule by id.",
    risk: "low",
    requires_confirmation: false,
    keywords: ["automation", "schedule", "heartbeat", "cron", "get"],
    source: "builtin",
    family: "automation",
    inputSchema: {
      type: "object",
      properties: {
        schedule_id: { type: "string" },
        include_deleted: { type: "boolean" },
      },
      required: ["schedule_id"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.automation.schedule.create",
    description: "Create a recurring automation schedule such as a heartbeat or cron job.",
    risk: "medium",
    requires_confirmation: true,
    keywords: ["automation", "schedule", "heartbeat", "cron", "create"],
    source: "builtin",
    family: "automation",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["heartbeat", "cron"] },
        enabled: { type: "boolean" },
        agent_key: { type: "string" },
        workspace_key: { type: "string" },
        cadence: {
          type: "object",
          description:
            "Either {type:'interval', interval_ms} or {type:'cron', expression, timezone}.",
        },
        execution: {
          type: "object",
          description: "Either agent_turn, playbook, or steps execution.",
        },
        delivery: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["quiet", "notify"] },
          },
          additionalProperties: false,
        },
      },
      required: ["kind", "cadence", "execution"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.automation.schedule.update",
    description: "Update an existing automation schedule.",
    risk: "medium",
    requires_confirmation: true,
    keywords: ["automation", "schedule", "heartbeat", "cron", "update"],
    source: "builtin",
    family: "automation",
    inputSchema: {
      type: "object",
      properties: {
        schedule_id: { type: "string" },
        kind: { type: "string", enum: ["heartbeat", "cron"] },
        enabled: { type: "boolean" },
        cadence: { type: "object" },
        execution: { type: "object" },
        delivery: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["quiet", "notify"] },
          },
          additionalProperties: false,
        },
      },
      required: ["schedule_id"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.automation.schedule.pause",
    description: "Pause an automation schedule without deleting it.",
    risk: "medium",
    requires_confirmation: true,
    keywords: ["automation", "schedule", "pause", "disable"],
    source: "builtin",
    family: "automation",
    inputSchema: {
      type: "object",
      properties: {
        schedule_id: { type: "string" },
      },
      required: ["schedule_id"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.automation.schedule.resume",
    description: "Resume a paused automation schedule.",
    risk: "medium",
    requires_confirmation: true,
    keywords: ["automation", "schedule", "resume", "enable"],
    source: "builtin",
    family: "automation",
    inputSchema: {
      type: "object",
      properties: {
        schedule_id: { type: "string" },
      },
      required: ["schedule_id"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.automation.schedule.delete",
    description: "Delete an automation schedule.",
    risk: "high",
    requires_confirmation: true,
    keywords: ["automation", "schedule", "delete", "remove"],
    source: "builtin",
    family: "automation",
    inputSchema: {
      type: "object",
      properties: {
        schedule_id: { type: "string" },
      },
      required: ["schedule_id"],
      additionalProperties: false,
    },
  },
  ...SUBAGENT_TOOL_REGISTRY,
  ...WORKBOARD_TOOL_REGISTRY,
];
