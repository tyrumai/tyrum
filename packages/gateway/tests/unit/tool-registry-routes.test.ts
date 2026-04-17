import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { SECRET_CLIPBOARD_TOOL_ID } from "../../src/modules/agent/tool-secret-definitions.js";
import { createToolRegistryRoutes } from "../../src/routes/tool-registry.js";
import { buildToolRegistryCatalogFixture } from "./tool-registry-routes.test-support.js";

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

function createAuthenticatedToolRegistryApp(
  deps: Parameters<typeof createToolRegistryRoutes>[0],
): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("authClaims", authClaims());
    await next();
  });
  app.route("/", createToolRegistryRoutes(deps));
  return app;
}

describe("tool registry routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats runtime inventory with canonical taxonomy metadata and interaction-default inspection", async () => {
    const { descriptors, disabledByReason, inventory, mcpServerSpecs, pluginDescriptors } =
      buildToolRegistryCatalogFixture();
    const listRegisteredTools = vi.fn(async () => ({
      allowlist: [
        "read",
        "websearch",
        "webfetch",
        "codesearch",
        "plugin.echo.say",
        "plugin.echo.union",
        "mcp.exa.web_search_exa",
        SECRET_CLIPBOARD_TOOL_ID,
      ],
      tools: descriptors.filter((descriptor) => !disabledByReason.has(descriptor.id)),
      mcpServers: ["exa"],
      inventory,
      mcpServerSpecs,
    }));

    const app = createAuthenticatedToolRegistryApp({
      agents: {
        getRuntime: vi.fn(async () => ({
          listRegisteredTools,
        })),
      } as never,
      db: {
        all: vi.fn(async () => []),
      } as never,
      pluginCatalogProvider: {
        loadGlobalRegistry: vi.fn(),
        loadTenantRegistry: vi.fn(async () => ({
          getToolDescriptors: () => pluginDescriptors,
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
                }
              : undefined,
        })),
        invalidateTenantRegistry: vi.fn(async () => undefined),
        shutdown: vi.fn(async () => undefined),
      } as never,
    });

    const response = await app.request("/config/tools?agent_key=default");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      tools: Array<Record<string, unknown>>;
    };

    expect(body.status).toBe("ok");
    expect(listRegisteredTools).toHaveBeenCalledWith({
      executionProfile: "interaction",
    });

    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "builtin",
        canonical_id: "read",
        lifecycle: "canonical",
        visibility: "public",
        aliases: [{ id: "tool.fs.read", lifecycle: "alias" }],
        family: "filesystem",
        group: "core",
        tier: "default",
        effective_exposure: {
          enabled: true,
          reason: "enabled",
          agent_key: "default",
        },
      }),
    );
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "builtin_mcp",
        canonical_id: "websearch",
        lifecycle: "canonical",
        visibility: "public",
        aliases: [],
        family: "web",
        group: "retrieval",
        tier: "default",
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
        source: "mcp",
        canonical_id: "mcp.exa.web_search_exa",
        lifecycle: "canonical",
        visibility: "public",
        aliases: [],
        family: "mcp",
        group: "extension",
        tier: "advanced",
      }),
    );
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "mcp",
        canonical_id: "memory.search",
        lifecycle: "deprecated",
        visibility: "public",
        aliases: [{ id: "mcp.memory.search", lifecycle: "deprecated" }],
        family: "memory",
        group: "memory",
        tier: "default",
      }),
    );
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "plugin",
        canonical_id: "plugin.echo.optional",
        lifecycle: "canonical",
        visibility: "public",
        aliases: [],
        group: "extension",
        tier: "advanced",
        effective_exposure: expect.objectContaining({
          enabled: false,
          reason: "disabled_by_plugin_opt_in",
        }),
      }),
    );
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "plugin",
        canonical_id: "plugin.echo.blocked",
        effective_exposure: expect.objectContaining({
          enabled: false,
          reason: "disabled_by_plugin_policy",
        }),
      }),
    );
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "builtin",
        canonical_id: "edit",
        effective_exposure: expect.objectContaining({
          enabled: false,
          reason: "disabled_by_state_mode",
        }),
      }),
    );
  });

  it("emits canonical ids while surfacing compatibility aliases separately", async () => {
    const { descriptors, disabledByReason, inventory, mcpServerSpecs, pluginDescriptors } =
      buildToolRegistryCatalogFixture();
    const listRegisteredTools = vi.fn(async () => ({
      allowlist: [
        "read",
        "write",
        "bash",
        "webfetch",
        "websearch",
        "codesearch",
        "plugin.echo.say",
        "plugin.echo.union",
        "mcp.exa.web_search_exa",
        SECRET_CLIPBOARD_TOOL_ID,
      ],
      tools: descriptors.filter((descriptor) => !disabledByReason.has(descriptor.id)),
      mcpServers: ["exa"],
      inventory,
      mcpServerSpecs,
    }));

    const app = createAuthenticatedToolRegistryApp({
      agents: {
        getRuntime: vi.fn(async () => ({
          listRegisteredTools,
        })),
      } as never,
      db: {
        all: vi.fn(async () => []),
      } as never,
      pluginCatalogProvider: {
        loadGlobalRegistry: vi.fn(),
        loadTenantRegistry: vi.fn(async () => ({
          getToolDescriptors: () => pluginDescriptors,
          getTool: () => undefined,
        })),
        invalidateTenantRegistry: vi.fn(async () => undefined),
        shutdown: vi.fn(async () => undefined),
      } as never,
    });

    const response = await app.request("/config/tools?agent_key=default");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      tools: Array<{
        canonical_id: string;
        aliases: Array<{ id: string; lifecycle: string }>;
      }>;
    };
    const aliasIds = new Set(body.tools.flatMap((tool) => tool.aliases.map((alias) => alias.id)));

    expect(body.tools.map((tool) => tool.canonical_id)).not.toContain("tool.fs.read");
    expect(body.tools.map((tool) => tool.canonical_id)).not.toContain("tool.fs.write");
    expect(body.tools.map((tool) => tool.canonical_id)).not.toContain("tool.exec");
    expect(body.tools.map((tool) => tool.canonical_id)).not.toContain("tool.http.fetch");
    expect(body.tools.map((tool) => tool.canonical_id)).not.toContain("mcp.memory.search");
    for (const tool of body.tools) {
      expect(aliasIds.has(tool.canonical_id)).toBe(false);
    }

    expect(
      body.tools.find((tool) => tool.canonical_id === "read")?.aliases.map((alias) => alias.id),
    ).toEqual(["tool.fs.read"]);
    expect(
      body.tools.find((tool) => tool.canonical_id === "write")?.aliases.map((alias) => alias.id),
    ).toEqual(["tool.fs.write"]);
    expect(
      body.tools.find((tool) => tool.canonical_id === "bash")?.aliases.map((alias) => alias.id),
    ).toEqual(["tool.exec"]);
    expect(
      body.tools.find((tool) => tool.canonical_id === "webfetch")?.aliases.map((alias) => alias.id),
    ).toEqual(["tool.http.fetch"]);
    expect(
      body.tools
        .find((tool) => tool.canonical_id === "memory.search")
        ?.aliases.map((alias) => alias.id),
    ).toEqual(["mcp.memory.search"]);
    expect(
      body.tools
        .find((tool) => tool.canonical_id === "memory.search")
        ?.aliases.map((alias) => alias.lifecycle),
    ).toEqual(["deprecated"]);
  });

  it("passes explicit execution_profile inspection through to runtime", async () => {
    const listRegisteredTools = vi.fn(async () => ({
      allowlist: [],
      tools: [],
      mcpServers: [],
      inventory: [],
      mcpServerSpecs: [],
    }));
    const app = createAuthenticatedToolRegistryApp({
      agents: {
        getRuntime: vi.fn(async () => ({
          listRegisteredTools,
        })),
      } as never,
      db: {
        all: vi.fn(async () => []),
      } as never,
    });

    const response = await app.request("/config/tools?agent_key=default&execution_profile=planner");

    expect(response.status).toBe(200);
    expect(listRegisteredTools).toHaveBeenCalledWith({
      executionProfile: "planner",
    });
  });

  it("rejects invalid execution_profile values", async () => {
    const app = createAuthenticatedToolRegistryApp({
      db: {
        all: vi.fn(async () => []),
      } as never,
    });

    const response = await app.request(
      "/config/tools?agent_key=default&execution_profile=not-a-profile",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_request",
      message:
        "execution_profile must be one of: interaction, explorer_ro, reviewer_ro, planner, jury, executor_rw, executor, explorer, reviewer, integrator (got 'not-a-profile')",
    });
  });

  it("returns internal_error when runtime tool inventory is unavailable", async () => {
    const app = createAuthenticatedToolRegistryApp({
      agents: {
        getRuntime: vi.fn(async () => ({
          listRegisteredTools: vi.fn(async () => ({
            allowlist: [],
            tools: [],
            mcpServers: [],
          })),
        })),
      } as never,
      db: {
        all: vi.fn(async () => []),
      } as never,
    });

    const response = await app.request("/config/tools?agent_key=default");
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "internal_error",
      message: "runtime tool inventory is unavailable",
    });
  });
});
