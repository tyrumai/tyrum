import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { McpManager } from "../../src/modules/agent/mcp-manager.js";
import { createToolRegistryRoutes } from "../../src/routes/tool-registry.js";

const LEGACY_NODE_DISPATCH_TOOL_ID = ["tool", "node", "dispatch"].join(".");
const LEGACY_NODE_INSPECT_TOOL_ID = ["tool", "node", "inspect"].join(".");

function authClaims() {
  return {
    token_kind: "admin" as const,
    token_id: "test-token",
    tenant_id: DEFAULT_TENANT_ID,
    role: "admin" as const,
    scopes: ["*"],
    issued_at: new Date(0).toISOString(),
  };
}

describe("tool registry routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns built-in, plugin, and MCP tool descriptors with source metadata", async () => {
    const listServerToolDescriptors = vi
      .spyOn(McpManager.prototype, "listServerToolDescriptors")
      .mockResolvedValue([
        {
          id: "mcp.exa.web_search_exa",
          description: "Search the web with Exa.",
          effect: "state_changing",
          keywords: ["mcp", "exa", "search"],
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
          },
        },
      ]);
    vi.spyOn(McpManager.prototype, "shutdown").mockResolvedValue(undefined);

    const db = {
      all: vi.fn(async () => [
        {
          revision: 1,
          tenant_id: DEFAULT_TENANT_ID,
          package_kind: "mcp",
          package_key: "exa",
          package_json: JSON.stringify({
            id: "exa",
            name: "Exa",
            enabled: true,
            transport: "remote",
            url: "https://mcp.exa.ai/mcp",
          }),
          artifact_id: null,
          enabled: 1,
          created_at: new Date(0).toISOString(),
          created_by_json: "{}",
          reason: null,
          reverted_from_revision: null,
        },
      ]),
    };

    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("authClaims", authClaims());
      await next();
    });
    app.route(
      "/",
      createToolRegistryRoutes({
        agents: {
          getRuntime: vi.fn(async () => ({
            listRegisteredTools: vi.fn(async () => ({
              allowlist: [
                "read",
                "websearch",
                "plugin.echo.say",
                "plugin.echo.union",
                "mcp.exa.web_search_exa",
              ],
              tools: [],
              mcpServers: [],
            })),
          })),
        } as never,
        db: db as never,
        pluginCatalogProvider: {
          loadGlobalRegistry: vi.fn(),
          loadTenantRegistry: vi.fn(async () => ({
            getToolDescriptors: () => [
              {
                id: "plugin.echo.say",
                description: "Echo text back to the caller.",
                effect: "read_only" as const,
                keywords: ["echo"],
                inputSchema: {
                  type: "object",
                  properties: { text: { type: "string" } },
                },
              },
              {
                id: "plugin.echo.invalid",
                description: "Invalid schema tool.",
                effect: "read_only" as const,
                keywords: ["echo"],
                inputSchema: {
                  oneOf: [{ type: "object", properties: {} }],
                },
              },
              {
                id: "plugin.echo.optional",
                description: "Echo text back without an explicit schema.",
                effect: "read_only" as const,
                keywords: ["echo"],
              },
              {
                id: "plugin.echo.union",
                description: "Echo text or markdown back to the caller.",
                effect: "read_only" as const,
                keywords: ["echo"],
                inputSchema: {
                  type: "object",
                  properties: {
                    kind: { type: "string", enum: ["text", "markdown"] },
                    text: { type: "string" },
                    markdown: { type: "string" },
                  },
                  required: ["kind"],
                  additionalProperties: false,
                  oneOf: [
                    {
                      properties: {
                        kind: { type: "string", enum: ["text"] },
                      },
                      required: ["kind", "text"],
                    },
                    {
                      properties: {
                        kind: { type: "string", enum: ["markdown"] },
                      },
                      required: ["kind", "markdown"],
                    },
                  ],
                },
              },
            ],
            getTool: (toolId: string) =>
              toolId === "plugin.echo.say"
                ? {
                    plugin: {
                      id: "echo",
                      name: "Echo",
                      version: "0.0.1",
                      entry: "index.mjs",
                      contributes: {
                        tools: [],
                        commands: [],
                        routes: [],
                        mcp_servers: [],
                      },
                      permissions: {
                        tools: [],
                        network_egress: [],
                        secrets: [],
                        db: false,
                      },
                      config_schema: {
                        type: "object",
                        properties: {},
                        required: [],
                        additionalProperties: false,
                      },
                    },
                    tool: {
                      descriptor: {
                        id: "plugin.echo.say",
                        description: "Echo text back to the caller.",
                        effect: "read_only" as const,
                        keywords: ["echo"],
                      },
                      execute: vi.fn(),
                    },
                  }
                : undefined,
          })),
          invalidateTenantRegistry: vi.fn(async () => undefined),
          shutdown: vi.fn(async () => undefined),
        } as never,
        stateMode: "local",
      }),
    );

    const response = await app.request("/config/tools?agent_key=default");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      tools: Array<Record<string, unknown>>;
    };
    expect(body.status).toBe("ok");
    expect(body.tools.some((tool) => tool.source === "builtin")).toBe(true);
    expect(body.tools).not.toContainEqual(
      expect.objectContaining({
        canonical_id: LEGACY_NODE_INSPECT_TOOL_ID,
      }),
    );
    expect(body.tools).not.toContainEqual(
      expect.objectContaining({
        canonical_id: LEGACY_NODE_DISPATCH_TOOL_ID,
      }),
    );
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "builtin_mcp",
        canonical_id: "websearch",
        effective_exposure: expect.objectContaining({
          enabled: true,
          reason: "enabled",
          agent_key: "default",
        }),
        backing_server: expect.objectContaining({
          id: "exa",
          name: "Exa",
          transport: "remote",
          url: "https://mcp.exa.ai/mcp",
        }),
      }),
    );
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "plugin",
        canonical_id: "plugin.echo.say",
        effective_exposure: expect.objectContaining({
          enabled: true,
          reason: "enabled",
          agent_key: "default",
        }),
        plugin: {
          id: "echo",
          name: "Echo",
          version: "0.0.1",
        },
      }),
    );
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "plugin",
        canonical_id: "plugin.echo.optional",
        input_schema: {
          type: "object",
          additionalProperties: true,
        },
      }),
    );
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "plugin",
        canonical_id: "plugin.echo.union",
        effective_exposure: expect.objectContaining({
          enabled: true,
          reason: "enabled",
          agent_key: "default",
        }),
        input_schema: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["text", "markdown"] },
            text: { type: "string" },
            markdown: { type: "string" },
          },
          required: ["kind"],
          additionalProperties: false,
        },
      }),
    );
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "mcp",
        canonical_id: "mcp.exa.web_search_exa",
        effective_exposure: expect.objectContaining({
          enabled: true,
          reason: "enabled",
          agent_key: "default",
        }),
        backing_server: expect.objectContaining({
          id: "exa",
          name: "Exa",
          transport: "remote",
          url: "https://mcp.exa.ai/mcp",
        }),
      }),
    );
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "plugin",
        canonical_id: "plugin.echo.invalid",
        effective_exposure: expect.objectContaining({
          enabled: false,
          reason: "disabled_invalid_schema",
          agent_key: "default",
        }),
      }),
    );
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "builtin",
        canonical_id: "tool.browser.navigate",
        family: "node",
        input_schema: expect.objectContaining({
          type: "object",
          properties: expect.objectContaining({
            url: expect.objectContaining({ type: "string" }),
            node_id: expect.objectContaining({
              type: "string",
              description: "Optional node id to target explicitly.",
            }),
            timeout_ms: expect.objectContaining({
              type: "number",
              description: "Optional dispatch timeout in milliseconds.",
            }),
          }),
          required: ["url"],
          additionalProperties: false,
        }),
      }),
    );
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "builtin",
        canonical_id: "tool.location.place.list",
        family: "location",
      }),
    );
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "builtin",
        canonical_id: "workboard.artifact.get",
        input_schema: {
          type: "object",
          properties: {
            artifact_id: { type: "string" },
          },
          required: ["artifact_id"],
          additionalProperties: false,
        },
      }),
    );
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "builtin",
        canonical_id: "tool.automation.schedule.list",
        family: "automation",
      }),
    );
    expect(listServerToolDescriptors).toHaveBeenCalledTimes(1);
  });
});
