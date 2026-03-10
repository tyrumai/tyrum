import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { McpManager } from "../../src/modules/agent/mcp-manager.js";
import { createToolRegistryRoutes } from "../../src/routes/tool-registry.js";

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
          risk: "medium",
          requires_confirmation: true,
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
              allowlist: ["read", "websearch", "plugin.echo.say", "mcp.exa.web_search_exa"],
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
                risk: "low" as const,
                requires_confirmation: false,
                keywords: ["echo"],
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
                        risk: "low" as const,
                        requires_confirmation: false,
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

    const response = await app.request("/config/tools");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      tools: Array<Record<string, unknown>>;
    };
    expect(body.status).toBe("ok");
    expect(body.tools.some((tool) => tool.source === "builtin")).toBe(true);
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
        source: "builtin",
        canonical_id: "memory.search",
        family: "memory",
        input_schema: expect.objectContaining({
          properties: expect.objectContaining({
            query: expect.any(Object),
          }),
        }),
      }),
    );
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "builtin",
        canonical_id: "memory.add",
        family: "memory",
        input_schema: expect.objectContaining({
          oneOf: expect.any(Array),
        }),
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
