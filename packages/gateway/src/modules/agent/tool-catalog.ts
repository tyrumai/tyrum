import { AUTOMATION_TOOL_REGISTRY } from "./tool-catalog-automation.js";
import { DESKTOP_TOOL_REGISTRY } from "./tool-catalog-desktop.js";
import { LOCATION_TOOL_REGISTRY } from "./tool-catalog-location.js";
import { SANDBOX_TOOL_REGISTRY } from "./tool-catalog-sandbox.js";
import type { ToolDescriptor } from "./tools.js";
import { SUBAGENT_TOOL_REGISTRY } from "./tool-catalog-subagent.js";
import { listDedicatedCapabilityToolDescriptors } from "./dedicated-capability-tools.js";
import {
  ARTIFACT_DESCRIBE_TOOL_PROMPT_METADATA,
  APPLY_PATCH_TOOL_PROMPT_METADATA,
  BASH_TOOL_PROMPT_METADATA,
  EDIT_TOOL_PROMPT_METADATA,
  GLOB_TOOL_PROMPT_METADATA,
  GREP_TOOL_PROMPT_METADATA,
  READ_TOOL_PROMPT_METADATA,
  TOOL_NODE_CAPABILITY_GET_PROMPT_METADATA,
  TOOL_NODE_LIST_PROMPT_METADATA,
  WRITE_TOOL_PROMPT_METADATA,
} from "./tool-catalog-prompt-metadata.js";
import { WORKBOARD_TOOL_REGISTRY } from "./tool-catalog-workboard.js";

export const BUILTIN_TOOL_REGISTRY: readonly ToolDescriptor[] = [
  {
    id: "read",
    description: "Read files from the local filesystem.",
    effect: "read_only",
    keywords: ["read", "file", "open", "inspect", "view", "log"],
    ...READ_TOOL_PROMPT_METADATA,
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
    effect: "state_changing",
    keywords: ["write", "edit", "update", "patch", "create", "file"],
    ...WRITE_TOOL_PROMPT_METADATA,
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
    effect: "state_changing",
    keywords: ["edit", "replace", "patch", "update", "string", "file"],
    ...EDIT_TOOL_PROMPT_METADATA,
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
    effect: "state_changing",
    keywords: ["patch", "diff", "apply", "edit", "update", "file"],
    ...APPLY_PATCH_TOOL_PROMPT_METADATA,
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
    effect: "state_changing",
    keywords: ["run", "command", "shell", "terminal", "execute", "build"],
    ...BASH_TOOL_PROMPT_METADATA,
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
    effect: "read_only",
    keywords: ["glob", "files", "find", "match", "pattern", "search"],
    ...GLOB_TOOL_PROMPT_METADATA,
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
    effect: "read_only",
    keywords: ["grep", "search", "regex", "text", "find", "pattern"],
    ...GREP_TOOL_PROMPT_METADATA,
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
    effect: "read_only",
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
    effect: "read_only",
    keywords: ["fetch", "crawl", "web", "url", "extract", "research"],
    promptGuidance: [
      "Use mode='raw' to fetch normalized page content when you need the full source.",
      "Use mode='extract' with a prompt when you want a focused, grounded extraction from the fetched source.",
    ],
    promptExamples: [
      '{"url":"https://example.com/spec","mode":"extract","prompt":"List the supported authentication methods."}',
    ],
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
    effect: "read_only",
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
    id: "artifact.describe",
    description: "Analyze one or more stored artifacts and summarize their contents.",
    effect: "read_only",
    keywords: ["artifact", "attachment", "image", "file", "describe", "analyze"],
    ...ARTIFACT_DESCRIBE_TOOL_PROMPT_METADATA,
    source: "builtin",
    family: "artifact",
    inputSchema: {
      type: "object",
      properties: {
        artifact_id: {
          type: "string",
          description: "Single artifact id to analyze.",
        },
        artifact_ids: {
          type: "array",
          description: "Optional list of artifact ids to analyze together.",
          items: { type: "string" },
        },
        prompt: {
          type: "string",
          description: "Optional focus instruction for what to extract from the artifacts.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    id: "tool.node.list",
    description:
      "List nodes and capability summary status for the current lane or a specified lane.",
    effect: "read_only",
    keywords: ["node", "device", "inventory", "list", "discover"],
    ...TOOL_NODE_LIST_PROMPT_METADATA,
    source: "builtin",
    family: "node",
    inputSchema: {
      type: "object",
      properties: {
        capability: {
          type: "string",
          description:
            "Optional exact capability descriptor id filter (example: tyrum.location.get). Omit to list all nodes. Wildcards are not supported.",
        },
        dispatchable_only: {
          type: "boolean",
          description:
            "Optional. When true, return only nodes with at least one dispatchable action.",
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
    id: "tool.node.capability.get",
    description:
      "Inspect one capability on one node, including live action availability and input/output schemas.",
    effect: "read_only",
    keywords: ["node", "capability", "inspect", "schema", "actions", "availability"],
    ...TOOL_NODE_CAPABILITY_GET_PROMPT_METADATA,
    source: "builtin",
    family: "node",
    inputSchema: {
      type: "object",
      properties: {
        node_id: {
          type: "string",
          description: "Exact node id to inspect.",
        },
        capability: {
          type: "string",
          description:
            "Exact capability descriptor id to inspect (example: tyrum.browser.navigate).",
        },
        include_disabled: {
          type: "boolean",
          description: "When true, include disabled actions in the response.",
        },
      },
      required: ["node_id", "capability"],
      additionalProperties: false,
    },
  },
  ...DESKTOP_TOOL_REGISTRY,
  ...LOCATION_TOOL_REGISTRY,
  ...SANDBOX_TOOL_REGISTRY,
  ...listDedicatedCapabilityToolDescriptors(),
  ...AUTOMATION_TOOL_REGISTRY,
  ...SUBAGENT_TOOL_REGISTRY,
  ...WORKBOARD_TOOL_REGISTRY,
];
