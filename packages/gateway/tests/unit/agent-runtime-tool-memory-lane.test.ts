import { afterEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import type { GatewayContainer } from "../../src/container.js";
import {
  teardownTestEnv,
  fetch404,
  DEFAULT_TENANT_ID,
  migrationsDir,
  seedAgentConfig,
} from "./agent-runtime.test-helpers.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { LaneQueueSignalDal } from "../../src/modules/lanes/queue-signal-dal.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { resolveExecutionProfile } from "../../src/modules/agent/runtime/intake-delegation.js";
import {
  createMemoryDecisionLanguageModel,
  createStubLanguageModel,
} from "./stub-language-model.js";

async function createObservedContainer(): Promise<GatewayContainer> {
  return await createContainer(
    {
      dbPath: ":memory:",
      migrationsDir,
    },
    {
      deploymentConfig: {
        policy: {
          mode: "observe",
        },
      },
    },
  );
}

function makeMemoryToolConfig(input?: { memoryEnabled?: boolean }): Record<string, unknown> {
  return {
    model: { model: "openai/gpt-4.1" },
    skills: { default_mode: "deny", workspace_trusted: false },
    mcp: {
      default_mode: "allow",
      pre_turn_tools: ["mcp.memory.seed"],
      server_settings: {
        memory: {
          enabled: input?.memoryEnabled ?? true,
        },
      },
    },
    tools: { default_mode: "allow" },
    sessions: { ttl_days: 30, max_turns: 20 },
  };
}

describe("AgentRuntime - tool tracking, memory, and lane signals", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  it("does not report context-available tools as used_tools", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createObservedContainer();

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("hello"),
      fetchImpl: fetch404,
    });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "read a file",
    });

    expect(result.reply).toBe("hello");
    expect(result.used_tools).toEqual([]);
  }, 10_000);

  it("records an episode for a meaningful turn outcome", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createObservedContainer();
    await seedAgentConfig(container, { config: makeMemoryToolConfig() });

    const createSpy = vi.spyOn(container.memoryDal, "create");

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createMemoryDecisionLanguageModel({
        decision: {
          should_store: true,
          reason: "The turn resolved a reusable failure.",
          memory: {
            kind: "episode",
            summary_md: "Fixed the failing workflow by updating the agent config.",
          },
        },
        reply: "Fixed the failing workflow by updating the agent config.",
      }),
      fetchImpl: fetch404,
    });

    await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "please fix the failing workflow",
    });

    expect(createSpy).toHaveBeenCalled();

    const agentTurnEpisode = createSpy.mock.calls.find(([input]) => input?.kind === "episode");

    expect(agentTurnEpisode).toBeDefined();
    expect(agentTurnEpisode?.[0]).toEqual(
      expect.objectContaining({
        summary_md: expect.stringContaining("Fixed the failing workflow"),
        provenance: expect.objectContaining({
          source_kind: "tool",
          metadata: { tool_id: "mcp.memory.write" },
        }),
      }),
    );
  }, 10_000);

  it("does not mark memory_written when mcp.memory.write returns an error", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createObservedContainer();
    await seedAgentConfig(container, {
      config: makeMemoryToolConfig({ memoryEnabled: false }),
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createMemoryDecisionLanguageModel({
        decision: {
          should_store: true,
          reason: "The user shared a durable preference.",
          memory: {
            kind: "note",
            body_md: "remember that I prefer tea",
          },
        },
        reply: "I could not save that preference.",
      }),
      fetchImpl: fetch404,
    });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-memory-error",
      message: "remember that I prefer tea",
    });

    expect(result.used_tools).toContain("mcp.memory.write");
    expect(result.memory_written).toBe(false);
  }, 10_000);

  it("persists explicit note tags without duplicates", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createObservedContainer();
    await seedAgentConfig(container, { config: makeMemoryToolConfig() });

    const createSpy = vi.spyOn(container.memoryDal, "create");

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createMemoryDecisionLanguageModel({
        decision: {
          should_store: true,
          reason: "The turn contained a durable user preference.",
          memory: {
            kind: "note",
            body_md: "remember that I prefer tea",
            tags: ["Durable-Memory", "Durable-Memory", " prefs "],
          },
        },
        reply: "ok",
      }),
      fetchImpl: fetch404,
    });

    await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "remember that I prefer tea",
    });

    const noteCall = createSpy.mock.calls.find(([input]) => input?.kind === "note");
    expect(noteCall?.[0]).toEqual(
      expect.objectContaining({
        tags: ["Durable-Memory", "prefs"],
      }),
    );
  }, 10_000);

  it("logs when subagent execution profile resolution fails", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createObservedContainer();

    const warnSpy = vi.spyOn(container.logger, "warn").mockImplementation(() => undefined);
    const getSubagentSpy = vi
      .spyOn(WorkboardDal.prototype, "getSubagent")
      .mockRejectedValue(new Error("boom"));

    // Construct runtime to ensure container is initialized for the test scope.
    void new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("hello"),
      fetchImpl: fetch404,
    });

    const subagentId = "subagent-1";
    const key = `agent:default:subagent:${subagentId}`;

    const profile = await resolveExecutionProfile(
      { container, agentId: "default", workspaceId: "default" },
      { laneQueueScope: { key, lane: "subagent" }, metadata: { subagent_id: subagentId } },
    );

    expect(profile.id).toBe("explorer_ro");
    expect(warnSpy).toHaveBeenCalledWith(
      "workboard.subagent_profile_resolve_failed",
      expect.objectContaining({ subagent_id: subagentId, error: "boom" }),
    );

    getSubagentSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("clears lane interrupt signals when the lane lease is released", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    await writeFile(join(homeDir, "notes.txt"), "important notes", "utf-8");
    await writeFile(
      join(homeDir, "agent.yml"),
      [
        "model:",
        "  model: openai/gpt-4.1",
        "skills:",
        "  enabled: []",
        "mcp:",
        "  enabled: []",
        "tools:",
        "  allow:",
        "    - read",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 20",
        "memory:",
        "  v1: { enabled: false }",
      ].join("\n"),
      "utf-8",
    );

    const key = "agent:default:test:thread-1";
    const lane = "main";
    const leaseOwner = "test-owner";
    const nowMs = Date.now();

    await container.db.run(
      `INSERT INTO lane_leases (tenant_id, key, lane, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, key, lane, leaseOwner, nowMs + 60_000],
    );

    const signals = new LaneQueueSignalDal(container.db);
    await signals.setSignal({
      tenant_id: DEFAULT_TENANT_ID,
      key,
      lane,
      kind: "interrupt",
      inbox_id: null,
      queue_mode: "interrupt",
      message_text: "interrupt",
      created_at_ms: nowMs,
    });

    const runtime1 = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("hello"),
      fetchImpl: fetch404,
    });

    await runtime1.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "hello",
      metadata: { tyrum_key: key, lane },
    });

    const remaining = await container.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM lane_queue_signals WHERE key = ? AND lane = ?",
      [key, lane],
    );
    expect(remaining?.n).toBe(1);

    await container.db.transaction(async (tx) => {
      const res = await tx.run(
        `DELETE FROM lane_leases
         WHERE key = ? AND lane = ? AND lease_owner = ?`,
        [key, lane, leaseOwner],
      );
      if (res.changes === 1) {
        await tx.run("DELETE FROM lane_queue_signals WHERE key = ? AND lane = ?", [key, lane]);
      }
    });

    const afterRelease = await container.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM lane_queue_signals WHERE key = ? AND lane = ?",
      [key, lane],
    );
    expect(afterRelease?.n).toBe(0);

    const usage = () => ({
      inputTokens: {
        total: 10,
        noCache: 10,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: 5,
        text: 5,
        reasoning: undefined,
      },
    });

    let callCount = 0;
    const toolLoopModel = new MockLanguageModelV3({
      doGenerate: async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: [
              {
                type: "tool-call" as const,
                toolCallId: "tc-1",
                toolName: "read",
                input: JSON.stringify({ path: "notes.txt" }),
              },
            ],
            finishReason: { unified: "tool-calls" as const, raw: undefined },
            usage: usage(),
            warnings: [],
          };
        }

        return {
          content: [{ type: "text" as const, text: "done" }],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: usage(),
          warnings: [],
        };
      },
    });

    const runtime2 = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: toolLoopModel,
      fetchImpl: fetch404,
    });

    const res2 = await runtime2.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "read notes",
      metadata: { tyrum_key: key, lane },
    });

    expect(res2.reply).toBe("done");
    expect(res2.used_tools).toContain("read");
  }, 10_000);

  it("does not clear unclaimed steer signals mid-run (so they can be claimed at a later tool boundary)", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    await writeFile(join(homeDir, "notes.txt"), "important notes", "utf-8");
    await writeFile(
      join(homeDir, "agent.yml"),
      [
        "model:",
        "  model: openai/gpt-4.1",
        "skills:",
        "  enabled: []",
        "mcp:",
        "  enabled: []",
        "tools:",
        "  allow:",
        "    - read",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 20",
        "memory:",
        "  v1: { enabled: false }",
      ].join("\n"),
      "utf-8",
    );

    const key = "agent:default:test:thread-1";
    const lane = "main";
    const leaseOwner = "test-owner";
    const nowMs = Date.now();

    await container.db.run(
      `INSERT INTO lane_leases (tenant_id, key, lane, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, key, lane, leaseOwner, nowMs + 60_000],
    );

    const inbox = new ChannelInboxDal(container.db);
    const { row: steerInbox } = await inbox.enqueue({
      source: "test:default",
      thread_id: "thread-1",
      message_id: "steer-1",
      key,
      lane,
      queue_mode: "steer",
      received_at_ms: nowMs,
      payload: {},
    });

    const signals = new LaneQueueSignalDal(container.db);
    await signals.setSignal({
      tenant_id: DEFAULT_TENANT_ID,
      key,
      lane,
      kind: "steer",
      inbox_id: steerInbox.inbox_id,
      queue_mode: "steer",
      message_text: "use plan B",
      created_at_ms: nowMs,
    });

    const runtime1 = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("hello"),
      fetchImpl: fetch404,
    });

    await runtime1.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "hello",
      metadata: { tyrum_key: key, lane },
    });

    const signalStillThere = await container.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM lane_queue_signals WHERE key = ? AND lane = ?",
      [key, lane],
    );
    expect(signalStillThere?.n).toBe(1);

    const inboxQueued = await container.db.get<{ status: string }>(
      "SELECT status FROM channel_inbox WHERE inbox_id = ?",
      [steerInbox.inbox_id],
    );
    expect(inboxQueued?.status).toBe("queued");

    const usage = () => ({
      inputTokens: {
        total: 10,
        noCache: 10,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: 5,
        text: 5,
        reasoning: undefined,
      },
    });

    let callCount = 0;
    const toolLoopModel = new MockLanguageModelV3({
      doGenerate: async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: [
              {
                type: "tool-call" as const,
                toolCallId: "tc-1",
                toolName: "read",
                input: JSON.stringify({ path: "notes.txt" }),
              },
            ],
            finishReason: { unified: "tool-calls" as const, raw: undefined },
            usage: usage(),
            warnings: [],
          };
        }

        return {
          content: [{ type: "text" as const, text: "done" }],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: usage(),
          warnings: [],
        };
      },
    });

    const runtime2 = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: toolLoopModel,
      fetchImpl: fetch404,
    });

    const res2 = await runtime2.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "read notes",
      metadata: { tyrum_key: key, lane },
    });

    expect(res2.reply).toBe("done");
    expect(res2.used_tools).not.toContain("read");

    const signalConsumed = await container.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM lane_queue_signals WHERE key = ? AND lane = ?",
      [key, lane],
    );
    expect(signalConsumed?.n).toBe(0);

    const inboxCompleted = await container.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM channel_inbox WHERE inbox_id = ?",
      [steerInbox.inbox_id],
    );
    expect(inboxCompleted?.n).toBe(0);
  }, 10_000);
});
