import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { SECRET_CLIPBOARD_TOOL_ID } from "../../src/modules/agent/tool-secret-definitions.js";
import { createToolRegistryRoutes } from "../../src/routes/tool-registry.js";
import { buildToolRegistryCatalogFixture } from "./tool-registry-routes.test-support.js";

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

  it("formats runtime inventory with shared exposure verdicts and source metadata", async () => {
    const { descriptors, disabledByReason, inventory, mcpServerSpecs, pluginDescriptors } =
      buildToolRegistryCatalogFixture();

    const app = createAuthenticatedToolRegistryApp({
      agents: {
        getRuntime: vi.fn(async () => ({
          listRegisteredTools: vi.fn(async () => ({
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
          })),
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
    });

    const response = await app.request("/config/tools?agent_key=default");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      tools: Array<Record<string, unknown>>;
    };
    expect(body.status).toBe("ok");
    expect(body.tools.some((tool) => tool.source === "builtin")).toBe(true);
    for (const legacyNodeToolId of [LEGACY_NODE_INSPECT_TOOL_ID, LEGACY_NODE_DISPATCH_TOOL_ID]) {
      expect(body.tools).not.toContainEqual(
        expect.objectContaining({
          canonical_id: legacyNodeToolId,
        }),
      );
    }
    for (const canonicalId of ["websearch", "webfetch", "codesearch"]) {
      expect(body.tools).toContainEqual(
        expect.objectContaining({
          source: "builtin_mcp",
          canonical_id: canonicalId,
          family: "web",
          group: "retrieval",
          tier: "default",
          effect: "read_only",
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
    }
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "builtin",
        canonical_id: SECRET_CLIPBOARD_TOOL_ID,
        effective_exposure: expect.objectContaining({
          enabled: true,
          reason: "enabled",
          agent_key: "default",
        }),
      }),
    );
    const rawMcpWebSearch = body.tools.find(
      (tool: { canonical_id?: string }) => tool.canonical_id === "mcp.exa.web_search_exa",
    );
    expect(rawMcpWebSearch).toBeDefined();
    expect(rawMcpWebSearch).toMatchObject({
      source: "mcp",
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
    });
    expect(rawMcpWebSearch).not.toHaveProperty("group");
    expect(rawMcpWebSearch).not.toHaveProperty("tier");
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
        effective_exposure: expect.objectContaining({
          enabled: false,
          reason: "disabled_by_agent_allowlist",
          agent_key: "default",
        }),
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
        source: "plugin",
        canonical_id: "plugin.echo.blocked",
        effective_exposure: expect.objectContaining({
          enabled: false,
          reason: "disabled_by_agent_allowlist",
          agent_key: "default",
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
          agent_key: "default",
        }),
      }),
    );
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "builtin",
        canonical_id: "read",
        family: "filesystem",
        group: "core",
      }),
    );
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "builtin",
        canonical_id: "bash",
        family: "shell",
        group: "core",
      }),
    );
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "builtin",
        canonical_id: "artifact.describe",
        family: "artifact",
        group: "core",
      }),
    );
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "builtin",
        canonical_id: "sandbox.current",
        family: "sandbox",
        group: "orchestration",
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
        canonical_id: "tool.node.capability.get",
        family: "node",
        input_schema: expect.objectContaining({
          type: "object",
          required: ["node_id", "capability"],
          properties: expect.objectContaining({
            node_id: expect.objectContaining({ type: "string" }),
            capability: expect.objectContaining({ type: "string" }),
            include_disabled: expect.objectContaining({ type: "boolean" }),
          }),
        }),
      }),
    );
    const cameraTool = body.tools.find(
      (tool: { canonical_id?: string }) => tool.canonical_id === "tool.camera.capture-photo",
    );
    expect(cameraTool).toMatchObject({
      source: "builtin",
      canonical_id: "tool.camera.capture-photo",
      input_schema: expect.objectContaining({
        type: "object",
        properties: expect.objectContaining({
          facing_mode: expect.objectContaining({ type: "string" }),
          format: expect.objectContaining({ type: "string" }),
          quality: expect.objectContaining({ type: "number" }),
          node_id: expect.objectContaining({ type: "string" }),
          timeout_ms: expect.objectContaining({ type: "number" }),
        }),
      }),
    });
    expect(cameraTool?.input_schema?.properties).not.toHaveProperty("camera");
    expect(cameraTool?.input_schema?.properties).not.toHaveProperty("device_id");

    const audioTool = body.tools.find(
      (tool: { canonical_id?: string }) => tool.canonical_id === "tool.audio.record",
    );
    expect(audioTool).toMatchObject({
      source: "builtin",
      canonical_id: "tool.audio.record",
      input_schema: expect.objectContaining({
        type: "object",
        properties: expect.objectContaining({
          duration_ms: expect.objectContaining({ type: "integer" }),
          mime: expect.objectContaining({ type: "string" }),
          node_id: expect.objectContaining({ type: "string" }),
          timeout_ms: expect.objectContaining({ type: "number" }),
        }),
      }),
    });
    expect(audioTool?.input_schema?.properties).not.toHaveProperty("device_id");
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "builtin",
        canonical_id: "tool.location.place.list",
        family: "tool.location.place",
        group: "environment",
        tier: "advanced",
      }),
    );
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "builtin",
        canonical_id: "workboard.artifact.get",
        family: "workboard",
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
    const workboardArtifactTool = body.tools.find(
      (tool: { canonical_id?: string }) => tool.canonical_id === "workboard.artifact.get",
    );
    expect(workboardArtifactTool).not.toHaveProperty("group");
    expect(workboardArtifactTool).not.toHaveProperty("tier");
    const subagentSpawnTool = body.tools.find(
      (tool: { canonical_id?: string }) => tool.canonical_id === "subagent.spawn",
    );
    expect(subagentSpawnTool).toMatchObject({
      source: "builtin",
      canonical_id: "subagent.spawn",
      family: "subagent",
    });
    expect(subagentSpawnTool).not.toHaveProperty("group");
    expect(subagentSpawnTool).not.toHaveProperty("tier");
    expect(body.tools).toContainEqual(
      expect.objectContaining({
        source: "builtin",
        canonical_id: "tool.automation.schedule.list",
        family: "tool.automation.schedule",
        group: "environment",
        tier: "advanced",
      }),
    );
  });

  it("returns internal_error when the agent registry is unavailable", async () => {
    const app = createAuthenticatedToolRegistryApp({
      db: {
        all: vi.fn(async () => []),
      } as never,
    });

    const response = await app.request("/config/tools?agent_key=default");
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "internal_error",
      message: "agent registry is unavailable",
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
