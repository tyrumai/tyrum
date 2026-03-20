import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { GatewayContainer } from "../../src/container.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { createStubLanguageModel } from "./stub-language-model.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

const generateTextMock = vi.hoisted(() => vi.fn());
const TITLE_PROMPT_TEXT = "Write a concise session title.";

function textParts(text: string): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text }];
}

function isTitleGenerateRequest(value: unknown): boolean {
  return (
    typeof (value as { system?: unknown } | undefined)?.system === "string" &&
    ((value as { system: string }).system.includes(TITLE_PROMPT_TEXT) ?? false)
  );
}

function mockNoNonTitleInference(): void {
  generateTextMock.mockImplementation(async (input) => {
    if (isTitleGenerateRequest(input)) {
      return { text: "Generated session title", steps: [] };
    }
    throw new Error("unexpected model inference");
  });
}

function firstNonTitleGenerateCall(): unknown {
  return generateTextMock.mock.calls
    .map(([first]) => first)
    .find((entry) => !isTitleGenerateRequest(entry));
}

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: generateTextMock,
  };
});

vi.mock("../../src/modules/models/provider-factory.js", () => ({
  createProviderFromNpm: (input: { providerId: string }) => ({
    languageModel(modelId: string) {
      return {
        specificationVersion: "v3",
        provider: input.providerId,
        modelId,
        supportedUrls: {},
        async doGenerate() {
          return { text: "ok" } as never;
        },
        async doStream() {
          throw new Error("not implemented");
        },
      };
    },
  }),
}));

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
    mockNoNonTitleInference();

    const { createContainer } = await import("../../src/container.js");
    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
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
      parts: textParts("status?"),
    });

    expect(result.reply).toContain(workItemId);
    expect(result.reply).toContain("Test work item");
    expect(result.reply).toContain(taskId);
    expect(firstNonTitleGenerateCall()).toBeUndefined();
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

    await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      parts: textParts("hello"),
    });

    const row = await container.db.get<{ last_active_session_key: string }>(
      `SELECT last_active_session_key
       FROM work_scope_activity
       WHERE tenant_id = ? AND agent_id = ? AND workspace_id = ?`,
      [DEFAULT_TENANT_ID, DEFAULT_AGENT_ID, DEFAULT_WORKSPACE_ID],
    );

    expect(row?.last_active_session_key).toBe("agent:default:test:default:channel:thread-1");
  });

  it("injects a Work focus digest into the model prompt", async () => {
    generateTextMock.mockResolvedValueOnce({ text: "ok", steps: [] });

    const { createContainer } = await import("../../src/container.js");
    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
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

    const res = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      parts: textParts("hello"),
    });
    expect(res.reply).toBe("ok");

    const call = firstNonTitleGenerateCall() as
      | { messages?: Array<{ role: string; content: Array<{ type: string; text: string }> }> }
      | undefined;

    const content = call?.messages?.[0]?.content ?? [];
    const stitched = content.map((part) => part.text).join("\n\n");

    expect(stitched).toContain("Active work state:");
    expect(stitched).toContain(workItemId);
    expect(stitched).toContain("Focus digest work item");
  });

  it("keeps Doing WorkItems in the Work focus digest even when Ready is large", async () => {
    generateTextMock.mockResolvedValueOnce({ text: "ok", steps: [] });

    const { createContainer } = await import("../../src/container.js");
    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
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
      const item = await dal.createItem({
        scope,
        createdAtIso: "2026-02-28T00:00:00.000Z",
        createdFromSessionKey: "agent:default:test:default:channel:thread-1",
        item: { kind: "action", title: `Ready item ${String(i)}` },
      });
      await dal.transitionItem({ scope, work_item_id: item.work_item_id, status: "ready" });
    }

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("unused"),
      fetchImpl: fetch404,
    } as ConstructorParameters<typeof AgentRuntime>[0]);

    const res = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      parts: textParts("hello"),
    });
    expect(res.reply).toBe("ok");

    const call = firstNonTitleGenerateCall() as
      | { messages?: Array<{ role: string; content: Array<{ type: string; text: string }> }> }
      | undefined;

    const content = call?.messages?.[0]?.content ?? [];
    const stitched = content.map((part) => part.text).join("\n\n");

    expect(stitched).toContain(doingId);
    expect(stitched).toContain("Old doing item");
  });

  it("treats /delegate_execute as normal text input", async () => {
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
      parts: textParts("/delegate_execute Ship a WorkItem quickly"),
    });

    expect(result.reply).toBe("ok");
    expect(generateTextMock).toHaveBeenCalled();

    const count = await container.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM work_items
       WHERE tenant_id = ? AND agent_id = ? AND workspace_id = ?`,
      [DEFAULT_TENANT_ID, DEFAULT_AGENT_ID, DEFAULT_WORKSPACE_ID],
    );
    expect(count?.count ?? 0).toBe(0);
  });

  it("treats /delegate_plan as normal text input", async () => {
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
      parts: textParts("/delegate_plan Design a safe rollout plan"),
    });

    expect(result.reply).toBe("ok");
    expect(generateTextMock).toHaveBeenCalled();

    const count = await container.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM work_items
       WHERE tenant_id = ? AND agent_id = ? AND workspace_id = ?`,
      [DEFAULT_TENANT_ID, DEFAULT_AGENT_ID, DEFAULT_WORKSPACE_ID],
    );
    expect(count?.count ?? 0).toBe(0);
  });
});
