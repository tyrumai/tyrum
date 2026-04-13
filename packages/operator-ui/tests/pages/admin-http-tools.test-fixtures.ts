export const DETAILED_TOOL_REGISTRY_FIXTURE = {
  status: "ok",
  tools: [
    {
      source: "builtin",
      canonical_id: "tool.browser.navigate",
      description: "Navigate to a URL.",
      effect: "state_changing",
      effective_exposure: {
        enabled: true,
        reason: "enabled",
        agent_key: "default",
      },
      family: "node",
      keywords: ["node", "browser", "navigate"],
      input_schema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "URL to open.",
          },
          node_id: {
            type: "string",
            description: "Optional node id to target explicitly.",
          },
          timeout_ms: {
            type: "number",
            description: "Optional dispatch timeout in milliseconds.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
    {
      source: "builtin",
      canonical_id: "tool.node.capability.get",
      description:
        "Inspect one capability on one node, including live action availability and input/output schemas.",
      effect: "read_only",
      effective_exposure: {
        enabled: true,
        reason: "enabled",
        agent_key: "default",
      },
      family: "node",
      keywords: ["node", "capability", "inspect"],
      input_schema: {
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
    {
      source: "builtin",
      canonical_id: "tool.automation.schedule.list",
      description: "List automation schedules for the current or specified agent/workspace scope.",
      effect: "read_only",
      effective_exposure: {
        enabled: true,
        reason: "enabled",
        agent_key: "default",
      },
      family: "tool.automation.schedule",
      group: "environment",
      tier: "advanced",
      keywords: ["automation", "schedule", "heartbeat", "cron", "list"],
      input_schema: {
        type: "object",
        properties: {
          agent_key: {
            type: "string",
          },
          workspace_key: {
            type: "string",
          },
          include_deleted: {
            type: "boolean",
          },
        },
        additionalProperties: false,
      },
    },
    {
      source: "builtin",
      canonical_id: "tool.location.place.list",
      description: "List saved places for the current or specified agent.",
      effect: "read_only",
      effective_exposure: {
        enabled: true,
        reason: "enabled",
        agent_key: "default",
      },
      family: "tool.location.place",
      group: "environment",
      tier: "advanced",
      keywords: ["location", "place", "places", "saved", "list"],
      input_schema: {
        type: "object",
        properties: {
          agent_key: {
            type: "string",
            description:
              "Optional agent key. Omit to use the current agent scope when the tool runs in an agent turn.",
          },
        },
        additionalProperties: false,
      },
    },
    {
      source: "builtin",
      canonical_id: "read",
      description: "Read files from disk.",
      effect: "read_only",
      effective_exposure: {
        enabled: true,
        reason: "enabled",
        agent_key: "default",
      },
      family: "filesystem",
      group: "core",
      keywords: ["read", "file"],
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute or workspace-relative path.",
          },
          options: {
            type: "object",
            properties: {
              offset: {
                type: "number",
                description: "Optional line offset.",
              },
              preview: {
                type: "boolean",
                description: "Return a short preview only.",
              },
            },
            required: ["offset"],
            additionalProperties: false,
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    {
      source: "builtin",
      canonical_id: "sandbox.current",
      description: "Inspect sandbox attachment state.",
      effect: "read_only",
      effective_exposure: {
        enabled: true,
        reason: "enabled",
        agent_key: "default",
      },
      family: "sandbox",
      group: "orchestration",
      keywords: ["sandbox", "desktop"],
      input_schema: {
        type: "object",
        additionalProperties: false,
      },
    },
    {
      source: "builtin_mcp",
      canonical_id: "websearch",
      description: "Search the web via Exa.",
      effect: "read_only",
      effective_exposure: {
        enabled: true,
        reason: "enabled",
        agent_key: "default",
      },
      family: "web",
      group: "retrieval",
      tier: "default",
      keywords: ["search", "web", "internet", "research", "exa", "lookup"],
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query.",
          },
          type: {
            type: "string",
            enum: ["auto", "fast", "keyword", "neural", "deep"],
            description: "Optional Exa search mode.",
          },
          num_results: {
            type: "number",
            description: "Optional maximum number of results.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      backing_server: {
        id: "exa",
        name: "Exa",
        transport: "remote",
        url: "https://mcp.exa.ai/mcp",
      },
    },
    {
      source: "builtin_mcp",
      canonical_id: "webfetch",
      description: "Fetch and normalize web content via Exa.",
      effect: "read_only",
      effective_exposure: {
        enabled: true,
        reason: "enabled",
        agent_key: "default",
      },
      family: "web",
      group: "retrieval",
      tier: "default",
      keywords: ["fetch", "crawl", "web", "url", "extract", "research"],
      input_schema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "URL to fetch.",
          },
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
      backing_server: {
        id: "exa",
        name: "Exa",
        transport: "remote",
        url: "https://mcp.exa.ai/mcp",
      },
    },
    {
      source: "builtin_mcp",
      canonical_id: "codesearch",
      description: "Search for code or documentation context via Exa.",
      effect: "read_only",
      effective_exposure: {
        enabled: true,
        reason: "enabled",
        agent_key: "default",
      },
      family: "web",
      group: "retrieval",
      tier: "default",
      keywords: ["code", "docs", "search", "reference", "api", "exa"],
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Code or documentation search query.",
          },
          tokens_num: {
            type: "number",
            description: "Optional token budget for returned context.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      backing_server: {
        id: "exa",
        name: "Exa",
        transport: "remote",
        url: "https://mcp.exa.ai/mcp",
      },
    },
    {
      source: "mcp",
      canonical_id: "mcp.exa.web_search_exa",
      description: "Search via a shared MCP server.",
      effect: "state_changing",
      effective_exposure: {
        enabled: false,
        reason: "disabled_by_state_mode",
        agent_key: "default",
      },
      family: "web",
      backing_server: {
        id: "shared-exa",
        name: "Shared Exa",
        transport: "remote",
        url: "https://mcp.example.test",
      },
    },
    {
      source: "plugin",
      canonical_id: "plugin.echo.invalid",
      description: "Plugin descriptor with an invalid input schema.",
      effect: "read_only",
      effective_exposure: {
        enabled: false,
        reason: "disabled_invalid_schema",
        agent_key: "default",
      },
      family: "plugin",
      keywords: ["echo", "plugin", "schema"],
      plugin: {
        id: "echo",
        name: "Echo",
        version: "0.0.1",
      },
    },
    {
      source: "plugin",
      canonical_id: "plugin.echo.say",
      description: "Echo text back to the caller.",
      effect: "read_only",
      effective_exposure: {
        enabled: false,
        reason: "disabled_by_agent_allowlist",
        agent_key: "default",
      },
      family: "plugin",
      keywords: ["echo", "plugin"],
      plugin: {
        id: "echo",
        name: "Echo",
        version: "0.0.1",
      },
    },
  ],
} as const;
