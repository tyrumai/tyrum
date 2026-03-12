import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MockLanguageModelV3 } from "ai/test";
import { AgentConfig } from "@tyrum/schemas";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentConfigDal } from "../../src/modules/config/agent-config-dal.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import type { AgentContextScope } from "../../src/modules/agent/context-store.js";
import { DEFAULT_WORKSPACE_KEY } from "../../src/modules/identity/scope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

function usage() {
  return {
    inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  };
}

describe("AgentRuntime shared context scopes", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("uses resolved UUID scope ids when loading shared agent context", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-shared-scope-"));
    container = createContainer(
      { dbPath: ":memory:", migrationsDir, tyrumHome: homeDir },
      { deploymentConfig: { state: { mode: "shared" } } },
    );

    const tenantId = await container.identityScopeDal.ensureTenantId("tenant-shared-scope");
    const resolvedAgentId = await container.identityScopeDal.ensureAgentId(tenantId, "default");
    const resolvedWorkspaceId = await container.identityScopeDal.ensureWorkspaceId(
      tenantId,
      DEFAULT_WORKSPACE_KEY,
    );
    await container.identityScopeDal.ensureMembership(
      tenantId,
      resolvedAgentId,
      resolvedWorkspaceId,
    );

    await new AgentConfigDal(container.db).set({
      tenantId,
      agentId: resolvedAgentId,
      config: AgentConfig.parse({
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: { enabled: [] },
        tools: { allow: [] },
        sessions: { ttl_days: 30, max_turns: 20 },
        memory: { v1: { enabled: false } },
      }),
      createdBy: { kind: "test" },
      reason: "shared-context-scope regression",
    });

    const scopes: AgentContextScope[] = [];
    const contextStore = {
      ensureAgentContext: async (scope: AgentContextScope) => {
        scopes.push(scope);
      },
      getIdentity: async () => ({
        meta: { name: "Shared Agent", description: "shared identity" },
        body: "You are a shared agent.",
      }),
      getEnabledSkills: async () => [],
      getEnabledMcpServers: async () => [],
    };

    const languageModel = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text" as const, text: "ok" }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: usage(),
        warnings: [],
      }),
    });

    const runtime = new AgentRuntime({
      container,
      tenantId,
      home: homeDir,
      contextStore,
      languageModel,
      mcpManager: {
        listToolDescriptors: async () => [],
        callTool: async () => ({ content: [] }),
        shutdown: async () => {},
      } as never,
    });

    await runtime.status(true);
    await runtime.executeDecideAction({
      channel: "test",
      thread_id: "thread-1",
      message: "status",
    });

    expect(scopes).toEqual([
      {
        tenantId,
        agentId: resolvedAgentId,
        workspaceId: resolvedWorkspaceId,
      },
      {
        tenantId,
        agentId: resolvedAgentId,
        workspaceId: resolvedWorkspaceId,
      },
    ]);
  });

  it("keeps source-less non-builtin tools in shared mode while excluding blocked builtins", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-shared-tools-"));
    container = createContainer(
      { dbPath: ":memory:", migrationsDir, tyrumHome: homeDir },
      { deploymentConfig: { state: { mode: "shared" } } },
    );

    const tenantId = await container.identityScopeDal.ensureTenantId("tenant-shared-tools");
    const resolvedAgentId = await container.identityScopeDal.ensureAgentId(tenantId, "default");
    const resolvedWorkspaceId = await container.identityScopeDal.ensureWorkspaceId(
      tenantId,
      DEFAULT_WORKSPACE_KEY,
    );
    await container.identityScopeDal.ensureMembership(
      tenantId,
      resolvedAgentId,
      resolvedWorkspaceId,
    );

    await new AgentConfigDal(container.db).set({
      tenantId,
      agentId: resolvedAgentId,
      config: AgentConfig.parse({
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: { enabled: [] },
        tools: {
          default_mode: "deny",
          allow: ["read", "mcp.weather.forecast", "custom.plugin.echo"],
          deny: [],
        },
        sessions: { ttl_days: 30, max_turns: 20 },
        memory: { v1: { enabled: false } },
      }),
      createdBy: { kind: "test" },
      reason: "shared status tool filter regression",
    });

    const contextStore = {
      ensureAgentContext: async () => {},
      getIdentity: async () => ({
        meta: { name: "Shared Agent", description: "shared identity" },
        body: "You are a shared agent.",
      }),
      getEnabledSkills: async () => [],
      getEnabledMcpServers: async () => [],
    };

    const runtime = new AgentRuntime({
      container,
      tenantId,
      home: homeDir,
      contextStore,
      mcpManager: {
        listToolDescriptors: async () => [
          {
            id: "mcp.weather.forecast",
            description: "Weather forecast",
            risk: "medium",
            requires_confirmation: true,
            keywords: ["weather"],
          },
        ],
        callTool: async () => ({ content: [] }),
        shutdown: async () => {},
      } as never,
      plugins: {
        getToolDescriptors: () => [
          {
            id: "custom.plugin.echo",
            description: "Echo text",
            risk: "low" as const,
            requires_confirmation: false,
            keywords: ["echo"],
          },
        ],
      } as never,
    });

    await expect(runtime.status(true)).resolves.toMatchObject({
      tools: ["mcp.weather.forecast", "custom.plugin.echo"],
    });
  });
});
