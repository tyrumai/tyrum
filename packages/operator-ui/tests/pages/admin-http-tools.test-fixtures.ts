import type { ToolRegistryListResult } from "@tyrum/operator-app/browser";

type ToolRegistryEntry = ToolRegistryListResult["tools"][number];
type ToolRegistryFixtureEntry = Omit<
  ToolRegistryEntry,
  "lifecycle" | "visibility" | "aliases" | "family" | "group" | "tier"
> &
  Partial<
    Pick<ToolRegistryEntry, "lifecycle" | "visibility" | "aliases" | "family" | "group" | "tier">
  >;

function finalizeToolRegistryFixture(tool: ToolRegistryFixtureEntry): ToolRegistryEntry {
  return {
    lifecycle: "canonical",
    visibility: "public",
    aliases: [],
    family: null,
    group: null,
    tier: null,
    ...tool,
  };
}

export const DETAILED_TOOL_REGISTRY_FIXTURE = {
  status: "ok",
  tools: [
    finalizeToolRegistryFixture({
      source: "builtin",
      canonical_id: "read",
      aliases: [{ id: "tool.fs.read", lifecycle: "alias" }],
      description: "Read files from disk.",
      effect: "read_only",
      effective_exposure: {
        enabled: true,
        reason: "enabled",
        agent_key: "default",
      },
      family: "filesystem",
      group: "core",
      tier: "default",
      keywords: ["read", "file"],
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute or workspace-relative path.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    }),
    finalizeToolRegistryFixture({
      source: "builtin",
      canonical_id: "memory.write",
      aliases: [{ id: "mcp.memory.write", lifecycle: "deprecated" }],
      description: "Persist durable memory for later reuse.",
      effect: "state_changing",
      effective_exposure: {
        enabled: true,
        reason: "enabled",
        agent_key: "default",
      },
      family: "memory",
      group: "memory",
      tier: "default",
      keywords: ["memory", "write", "durable"],
      input_schema: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            description: "Memory record kind.",
          },
          body_md: {
            type: "string",
            description: "Markdown body to persist.",
          },
        },
        required: ["kind", "body_md"],
        additionalProperties: false,
      },
    }),
    finalizeToolRegistryFixture({
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
          agent_key: { type: "string" },
          workspace_key: { type: "string" },
          include_deleted: { type: "boolean" },
        },
        additionalProperties: false,
      },
    }),
    finalizeToolRegistryFixture({
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
    }),
    finalizeToolRegistryFixture({
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
      group: "node",
      tier: "advanced",
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
    }),
    finalizeToolRegistryFixture({
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
      group: "node",
      tier: "advanced",
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
        },
        required: ["node_id", "capability"],
        additionalProperties: false,
      },
    }),
    finalizeToolRegistryFixture({
      source: "builtin",
      canonical_id: "sandbox.current",
      visibility: "internal",
      description: "Inspect sandbox attachment state.",
      effect: "read_only",
      effective_exposure: {
        enabled: true,
        reason: "enabled",
        agent_key: "default",
      },
      family: "sandbox",
      group: "orchestration",
      tier: "advanced",
      keywords: ["sandbox", "desktop"],
      input_schema: {
        type: "object",
        additionalProperties: false,
      },
    }),
    finalizeToolRegistryFixture({
      source: "builtin",
      canonical_id: "connector.send",
      lifecycle: "deprecated",
      description: "Send a message via a configured connector.",
      effect: "state_changing",
      effective_exposure: {
        enabled: true,
        reason: "enabled",
        agent_key: "default",
      },
      family: "connector",
      group: "extension",
      tier: "advanced",
      keywords: ["connector", "message", "delivery"],
    }),
    finalizeToolRegistryFixture({
      source: "builtin",
      canonical_id: "guardian_review_decision",
      visibility: "runtime_only",
      description: "Persist the guardian review outcome.",
      effect: "state_changing",
      effective_exposure: {
        enabled: true,
        reason: "enabled",
        agent_key: "default",
      },
    }),
    finalizeToolRegistryFixture({
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
    }),
    finalizeToolRegistryFixture({
      source: "mcp",
      canonical_id: "mcp.exa.web_search_exa",
      description: "Search via a shared MCP server.",
      effect: "state_changing",
      effective_exposure: {
        enabled: false,
        reason: "disabled_by_state_mode",
        agent_key: "default",
      },
      family: "mcp",
      group: "extension",
      tier: "advanced",
      backing_server: {
        id: "shared-exa",
        name: "Shared Exa",
        transport: "remote",
        url: "https://mcp.example.test",
      },
    }),
    finalizeToolRegistryFixture({
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
      group: "extension",
      tier: "advanced",
      keywords: ["echo", "plugin", "schema"],
      plugin: {
        id: "echo",
        name: "Echo",
        version: "0.0.1",
      },
    }),
    finalizeToolRegistryFixture({
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
      group: "extension",
      tier: "advanced",
      keywords: ["echo", "plugin"],
      plugin: {
        id: "echo",
        name: "Echo",
        version: "0.0.1",
      },
    }),
  ],
} satisfies ToolRegistryListResult;
