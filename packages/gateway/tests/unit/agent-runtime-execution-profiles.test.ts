import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { createStubLanguageModel } from "./stub-language-model.js";
import { AgentConfig } from "@tyrum/contracts";
import { AgentConfigDal } from "../../src/modules/config/agent-config-dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("AgentRuntime (execution profiles)", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;
  const fetch404 = (async () => new Response("not found", { status: 404 })) as typeof fetch;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("filters tools by profile for main vs subagent runs", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    await new AgentConfigDal(container.db).set({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      config: AgentConfig.parse({
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: {
          enabled: [],
          server_settings: { memory: { enabled: false } },
        },
        tools: { allow: ["read", "write", "bash"] },
        sessions: { ttl_days: 30, max_turns: 20 },
      }),
      createdBy: { kind: "test" },
      reason: "test",
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("ok"),
      fetchImpl: fetch404,
      turnEngineWaitMs: 30_000,
    });

    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const workboard = new WorkboardDal(container.db);

    const explorerSubagentId = randomUUID();
    const explorerSessionKey = `agent:default:subagent:${explorerSubagentId}`;
    await workboard.createSubagent({
      scope,
      subagent: {
        execution_profile: "explorer_ro",
        session_key: explorerSessionKey,
        lane: "subagent",
        status: "running",
      },
      subagentId: explorerSubagentId,
    });

    await runtime.turn({
      channel: "subagent",
      thread_id: explorerSubagentId,
      message: "write a file",
      metadata: {
        tyrum_key: explorerSessionKey,
        lane: "subagent",
        subagent_id: explorerSubagentId,
      },
    });

    const explorerTools = runtime.getLastContextReport()?.selected_tools ?? [];
    expect(explorerTools).toContain("read");
    expect(explorerTools).not.toContain("write");
    expect(explorerTools).not.toContain("bash");

    await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "write a file",
    });

    const mainTools = runtime.getLastContextReport()?.selected_tools ?? [];
    expect(mainTools).toContain("read");
    expect(mainTools).toContain("write");
    expect(mainTools).toContain("bash");

    const executorSubagentId = randomUUID();
    const executorSessionKey = `agent:default:subagent:${executorSubagentId}`;
    await workboard.createSubagent({
      scope,
      subagent: {
        execution_profile: "executor",
        session_key: executorSessionKey,
        lane: "subagent",
        status: "running",
      },
      subagentId: executorSubagentId,
    });

    await runtime.turn({
      channel: "subagent",
      thread_id: executorSubagentId,
      message: "write a file",
      metadata: {
        tyrum_key: executorSessionKey,
        lane: "subagent",
        subagent_id: executorSubagentId,
      },
    });

    const executorTools = runtime.getLastContextReport()?.selected_tools ?? [];
    expect(executorTools).toContain("read");
    expect(executorTools).toContain("write");
    expect(executorTools).toContain("bash");
  });

  it("exposes the full post-gating tool set without truncation", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-tools-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    await new AgentConfigDal(container.db).set({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      config: AgentConfig.parse({
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: {
          enabled: [],
          server_settings: { memory: { enabled: false } },
        },
        tools: {
          allow: [
            "read",
            "write",
            "edit",
            "apply_patch",
            "bash",
            "glob",
            "grep",
            "websearch",
            "webfetch",
            "codesearch",
          ],
        },
        sessions: { ttl_days: 30, max_turns: 20 },
      }),
      createdBy: { kind: "test" },
      reason: "test",
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("ok"),
      fetchImpl: fetch404,
      turnEngineWaitMs: 30_000,
    });

    await runtime.turn({
      channel: "test",
      thread_id: "thread-tools",
      message: "hello",
    });

    expect(runtime.getLastContextReport()?.selected_tools).toEqual([
      "apply_patch",
      "bash",
      "codesearch",
      "edit",
      "glob",
      "grep",
      "read",
      "webfetch",
      "websearch",
      "write",
    ]);
  });

  it("keeps interaction broad while narrowing its workboard exposure", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-interaction-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    await new AgentConfigDal(container.db).set({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      config: AgentConfig.parse({
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: {
          enabled: [],
          server_settings: { memory: { enabled: false } },
        },
        tools: { allow: ["*"] },
        sessions: { ttl_days: 30, max_turns: 20 },
      }),
      createdBy: { kind: "test" },
      reason: "test",
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("ok"),
      fetchImpl: fetch404,
      turnEngineWaitMs: 30_000,
    });

    await runtime.turn({
      channel: "test",
      thread_id: "thread-interaction",
      message: "inspect state and delegate helper work",
    });

    const selectedTools = runtime.getLastContextReport()?.selected_tools ?? [];
    expect(selectedTools).toContain("write");
    expect(selectedTools).toContain("bash");
    expect(selectedTools).toContain("subagent.spawn");
    expect(selectedTools).toContain("workboard.capture");
    expect(selectedTools).toContain("workboard.item.list");
    expect(selectedTools).toContain("workboard.clarification.answer");
    expect(selectedTools).not.toContain("workboard.item.update");
    expect(selectedTools).not.toContain("workboard.clarification.request");
    expect(selectedTools).not.toContain("workboard.subagent.spawn");
  });
});
