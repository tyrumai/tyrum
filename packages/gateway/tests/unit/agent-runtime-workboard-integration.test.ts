import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { GatewayContainer } from "../../src/container.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { createStubLanguageModel } from "./stub-language-model.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

const generateTextMock = vi.hoisted(() => vi.fn());

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: generateTextMock,
  };
});

describe("AgentRuntime (WorkBoard integration)", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  const fetch404 = (async () => new Response("not found", { status: 404 })) as typeof fetch;

  afterEach(async () => {
    generateTextMock.mockReset();
    await container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("answers status? via WorkBoard without model inference", async () => {
    generateTextMock.mockImplementation(() => {
      throw new Error("unexpected model inference");
    });

    const { createContainer } = await import("../../src/container.js");
    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;
    const workItemId = "123e4567-e89b-12d3-a456-426614174000";
    const taskId = "123e4567-e89b-12d3-a456-426614174001";

    const dal = new WorkboardDal(container.db);
    await dal.createItem({
      scope,
      workItemId,
      createdFromSessionKey: "agent:default:test:default:channel:thread-1",
      item: { kind: "action", title: "Test work item" },
    });
    await dal.transitionItem({ scope, work_item_id: workItemId, status: "ready" });
    await dal.transitionItem({ scope, work_item_id: workItemId, status: "doing" });
    await dal.createTask({
      scope,
      taskId,
      task: {
        work_item_id: workItemId,
        status: "running",
        execution_profile: "executor",
        side_effect_class: "workspace",
      },
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("unused"),
      fetchImpl: fetch404,
    } as ConstructorParameters<typeof AgentRuntime>[0]);

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "status?",
    });

    expect(result.reply).toContain(workItemId);
    expect(result.reply).toContain("Test work item");
    expect(result.reply).toContain(taskId);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("records last_active_session_key on inbound interactive turns", async () => {
    generateTextMock.mockResolvedValueOnce({ text: "ok", steps: [] });

    const { createContainer } = await import("../../src/container.js");
    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("unused"),
      fetchImpl: fetch404,
    } as ConstructorParameters<typeof AgentRuntime>[0]);

    await runtime.turn({ channel: "test", thread_id: "thread-1", message: "hello" });

    const row = await container.db.get<{ last_active_session_key: string }>(
      `SELECT last_active_session_key
       FROM work_scope_activity
       WHERE tenant_id = 'default' AND agent_id = 'default' AND workspace_id = 'default'`,
    );

    expect(row?.last_active_session_key).toBe("agent:default:test:default:channel:thread-1");
  });

  it("injects a Work focus digest into the model prompt", async () => {
    generateTextMock.mockResolvedValueOnce({ text: "ok", steps: [] });

    const { createContainer } = await import("../../src/container.js");
    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;
    const workItemId = "123e4567-e89b-12d3-a456-426614174010";

    const dal = new WorkboardDal(container.db);
    await dal.createItem({
      scope,
      workItemId,
      createdFromSessionKey: "agent:default:test:default:channel:thread-1",
      item: { kind: "action", title: "Focus digest work item" },
    });
    await dal.transitionItem({ scope, work_item_id: workItemId, status: "ready" });
    await dal.transitionItem({ scope, work_item_id: workItemId, status: "doing" });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("unused"),
      fetchImpl: fetch404,
    } as ConstructorParameters<typeof AgentRuntime>[0]);

    const res = await runtime.turn({ channel: "test", thread_id: "thread-1", message: "hello" });
    expect(res.reply).toBe("ok");

    const call = generateTextMock.mock.calls[0]?.[0] as
      | { messages?: Array<{ role: string; content: Array<{ type: string; text: string }> }> }
      | undefined;

    const content = call?.messages?.[0]?.content ?? [];
    const stitched = content.map((part) => part.text).join("\n\n");

    expect(stitched).toContain("Work focus digest:");
    expect(stitched).toContain(workItemId);
    expect(stitched).toContain("Focus digest work item");
  });

  it("keeps Doing WorkItems in the Work focus digest even when backlog is large", async () => {
    generateTextMock.mockResolvedValueOnce({ text: "ok", steps: [] });

    const { createContainer } = await import("../../src/container.js");
    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;
    const doingId = "123e4567-e89b-12d3-a456-426614174020";

    const dal = new WorkboardDal(container.db);
    await dal.createItem({
      scope,
      workItemId: doingId,
      createdAtIso: "2026-02-27T00:00:00.000Z",
      createdFromSessionKey: "agent:default:test:default:channel:thread-1",
      item: { kind: "action", title: "Old doing item" },
    });
    await dal.transitionItem({ scope, work_item_id: doingId, status: "ready" });
    await dal.transitionItem({ scope, work_item_id: doingId, status: "doing" });

    for (let i = 0; i < 60; i += 1) {
      await dal.createItem({
        scope,
        createdAtIso: "2026-02-28T00:00:00.000Z",
        createdFromSessionKey: "agent:default:test:default:channel:thread-1",
        item: { kind: "action", title: `Backlog item ${String(i)}` },
      });
    }

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("unused"),
      fetchImpl: fetch404,
    } as ConstructorParameters<typeof AgentRuntime>[0]);

    const res = await runtime.turn({ channel: "test", thread_id: "thread-1", message: "hello" });
    expect(res.reply).toBe("ok");

    const call = generateTextMock.mock.calls[0]?.[0] as
      | { messages?: Array<{ role: string; content: Array<{ type: string; text: string }> }> }
      | undefined;

    const content = call?.messages?.[0]?.content ?? [];
    const stitched = content.map((part) => part.text).join("\n\n");

    expect(stitched).toContain(doingId);
    expect(stitched).toContain("Old doing item");
  });

  it("delegates /delegate_execute to a WorkItem and returns its id immediately", async () => {
    generateTextMock.mockImplementation(() => {
      throw new Error("unexpected model inference");
    });

    const { createContainer } = await import("../../src/container.js");
    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("unused"),
      fetchImpl: fetch404,
    } as ConstructorParameters<typeof AgentRuntime>[0]);

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "/delegate_execute Ship a WorkItem quickly",
    });

    const item = await container.db.get<{
      work_item_id: string;
      kind: string;
      title: string;
      created_from_session_key: string;
    }>(
      `SELECT work_item_id, kind, title, created_from_session_key
       FROM work_items
       WHERE tenant_id = 'default' AND agent_id = 'default' AND workspace_id = 'default'`,
    );

    expect(item?.kind).toBe("action");
    expect(item?.title).toContain("Ship a WorkItem quickly");
    expect(item?.created_from_session_key).toBe("agent:default:test:default:channel:thread-1");
    expect(result.reply).toContain(item?.work_item_id ?? "");

    const activeKv = await container.db.get<{ value_json: string }>(
      `SELECT value_json
       FROM agent_state_kv
       WHERE tenant_id = 'default'
         AND agent_id = 'default'
         AND workspace_id = 'default'
         AND key = 'work.active_work_item_id'`,
    );
    expect(activeKv?.value_json).toContain(item?.work_item_id ?? "");
  });

  it("delegates /delegate_plan to an initiative WorkItem", async () => {
    generateTextMock.mockImplementation(() => {
      throw new Error("unexpected model inference");
    });

    const { createContainer } = await import("../../src/container.js");
    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("unused"),
      fetchImpl: fetch404,
    } as ConstructorParameters<typeof AgentRuntime>[0]);

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "/delegate_plan Design a safe rollout plan",
    });

    const item = await container.db.get<{ work_item_id: string; kind: string; title: string }>(
      `SELECT work_item_id, kind, title
       FROM work_items
       WHERE tenant_id = 'default' AND agent_id = 'default' AND workspace_id = 'default'`,
    );

    expect(item?.kind).toBe("initiative");
    expect(item?.title).toContain("Design a safe rollout plan");
    expect(result.reply).toContain(item?.work_item_id ?? "");

    const task = await container.db.get<{ execution_profile: string }>(
      `SELECT execution_profile
       FROM work_item_tasks
       WHERE work_item_id = ?`,
      [item?.work_item_id ?? ""],
    );
    expect(task?.execution_profile).toBe("planner");
  });

  it("does not treat /delegate_executeX as a delegation directive", async () => {
    generateTextMock.mockResolvedValueOnce({ text: "ok", steps: [] });

    const { createContainer } = await import("../../src/container.js");
    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("unused"),
      fetchImpl: fetch404,
    } as ConstructorParameters<typeof AgentRuntime>[0]);

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "/delegate_executeX not a real directive",
    });

    expect(result.reply).toBe("ok");
    expect(generateTextMock).toHaveBeenCalled();

    const count = await container.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM work_items
       WHERE tenant_id = 'default' AND agent_id = 'default' AND workspace_id = 'default'`,
    );
    expect(count?.count ?? 0).toBe(0);
  });
});
