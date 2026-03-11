export const DETAILED_TOOL_REGISTRY_FIXTURE = {
  status: "ok",
  tools: [
    {
      source: "builtin",
      canonical_id: "read",
      description: "Read files from disk.",
      risk: "low",
      requires_confirmation: false,
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
      risk: "medium",
      requires_confirmation: true,
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
      source: "builtin",
      canonical_id: "memory.add",
      description: "Write durable memory for this agent.",
      risk: "medium",
      requires_confirmation: false,
      effective_exposure: {
        enabled: true,
        reason: "enabled",
        agent_key: "default",
      },
      family: "memory",
      keywords: ["memory", "store"],
      input_schema: {
        oneOf: [
          {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["fact"] },
              key: { type: "string", description: "Stable fact key." },
              value: { description: "Structured fact value." },
            },
            required: ["kind", "key", "value"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["note"] },
              body_md: { type: "string", description: "Durable note body." },
              tags: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["kind", "body_md"],
            additionalProperties: false,
          },
        ],
      },
    },
    {
      source: "mcp",
      canonical_id: "mcp.exa.web_search_exa",
      description: "Search via a shared MCP server.",
      risk: "medium",
      requires_confirmation: true,
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
      risk: "low",
      requires_confirmation: false,
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
