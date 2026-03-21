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
      canonical_id: "read",
      description: "Read files from disk.",
      effect: "read_only",
      effective_exposure: {
        enabled: true,
        reason: "enabled",
        agent_key: "default",
      },
      family: "filesystem",
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
      source: "builtin_mcp",
      canonical_id: "websearch",
      description: "Search the web via Exa.",
      effect: "state_changing",
      effective_exposure: {
        enabled: true,
        reason: "enabled",
        agent_key: "default",
      },
      family: "web",
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
