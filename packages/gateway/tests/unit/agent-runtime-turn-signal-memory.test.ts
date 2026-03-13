import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayContainer } from "../../src/container.js";
import { createContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { createPromptAwareLanguageModel } from "./agent-behavior.test-support.js";
import {
  buildTurnMemoryDedupeKey,
  buildTurnMemoryDedupeTag,
} from "../../src/modules/agent/runtime/turn-memory-policy.js";
import {
  DEFAULT_TENANT_ID,
  fetch404,
  migrationsDir,
  seedAgentConfig,
  teardownTestEnv,
} from "./agent-runtime.test-helpers.js";
import { createMemoryDecisionLanguageModel } from "./stub-language-model.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const durablePreferenceDecision = {
  should_store: true as const,
  reason: "The turn contained a durable user preference.",
  memory: {
    kind: "note" as const,
    body_md: "remember that I prefer tea",
    tags: ["Durable-Memory"],
  },
};

describe("AgentRuntime turn-signal memory finalization", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  async function createMemoryEnabledContainer(): Promise<GatewayContainer> {
    const next = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });
    await seedAgentConfig(next, {
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: { enabled: [] },
        tools: { allow: [] },
        sessions: { ttl_days: 30, max_turns: 20 },
        memory: {
          v1: {
            enabled: true,
            auto_write: { enabled: true },
          },
        },
      },
    });
    return next;
  }

  it("defaults auto-written procedure confidence to 1", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createMemoryEnabledContainer();

    const createSpy = vi.spyOn(container.memoryV1Dal, "create");

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createMemoryDecisionLanguageModel({
        decision: {
          should_store: true,
          reason: "The turn produced a reusable procedure.",
          memory: {
            kind: "procedure",
            title: "Restart the worker",
            body_md: "Stop the worker, clear the queue, and restart the service.",
          },
        },
        reply: "Documented the restart procedure.",
      }),
      fetchImpl: fetch404,
    });

    await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "document the recovery procedure",
    });

    const procedureCall = createSpy.mock.calls.find(([input]) => input?.kind === "procedure");
    expect(procedureCall?.[0]).toEqual(
      expect.objectContaining({
        confidence: 1,
      }),
    );
  }, 10_000);

  it("does not auto-write turn memory when auto-write is disabled", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });
    await seedAgentConfig(container, {
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: { enabled: [] },
        tools: { allow: [] },
        sessions: { ttl_days: 30, max_turns: 20 },
        memory: {
          v1: {
            enabled: true,
            auto_write: { enabled: false },
          },
        },
      },
    });

    const createSpy = vi.spyOn(container.memoryV1Dal, "create");

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createPromptAwareLanguageModel(() => "Stored.", {
        memoryDecision: ({ promptText }) =>
          promptText.toLowerCase().includes("remember that my name is ron")
            ? {
                should_store: true,
                reason: "Durable user profile detail.",
                memory: {
                  kind: "note",
                  body_md: "Remember that my name is Ron.",
                },
              }
            : undefined,
      }),
      fetchImpl: fetch404,
    });

    const response = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "remember that my name is Ron",
    });

    expect(response.memory_written).toBe(false);
    expect(createSpy).not.toHaveBeenCalled();
  }, 10_000);

  it("stores bounded auto-turn dedupe tags for turn signal memories", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createMemoryEnabledContainer();

    const createSpy = vi.spyOn(container.memoryV1Dal, "create");

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createMemoryDecisionLanguageModel({
        decision: durablePreferenceDecision,
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
    const dedupeTag = noteCall?.[0]?.tags.find((tag: string) => tag.startsWith("at:"));

    expect(dedupeTag).toBeTruthy();
    expect(dedupeTag?.length).toBeLessThanOrEqual(32);
    expect(noteCall?.[0]?.tags.some((tag: string) => tag.startsWith("auto-turn:"))).toBe(false);
  }, 10_000);

  it("dedupes against legacy long auto-turn tags", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createMemoryEnabledContainer();

    const dedupeKey = buildTurnMemoryDedupeKey(durablePreferenceDecision, "interaction");
    const legacyDedupeTag = `auto-turn:${dedupeKey}`;
    const agentId = await container.identityScopeDal.ensureAgentId(DEFAULT_TENANT_ID, "default");

    await container.memoryV1Dal.create(
      {
        kind: "note",
        body_md: durablePreferenceDecision.memory.body_md,
        tags: ["agent-turn", "auto-turn", "durable-memory", legacyDedupeTag],
        sensitivity: "private",
        provenance: {
          source_kind: "system",
          channel: "test",
          thread_id: "thread-1",
          session_id: "seed-session",
          refs: [],
          metadata: {
            kind: "turn_signal",
            auto_turn: true,
            turn_origin: "interaction",
            reason: durablePreferenceDecision.reason,
            dedupe_key: dedupeKey,
          },
        },
      },
      { tenantId: DEFAULT_TENANT_ID, agentId },
    );

    const createSpy = vi.spyOn(container.memoryV1Dal, "create");

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createMemoryDecisionLanguageModel({
        decision: durablePreferenceDecision,
        reply: "ok",
      }),
      fetchImpl: fetch404,
    });

    await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "remember that I prefer tea",
    });

    expect(createSpy).not.toHaveBeenCalled();

    const noteItems = await container.memoryV1Dal.list({
      tenantId: DEFAULT_TENANT_ID,
      agentId,
      filter: { tags: [legacyDedupeTag, buildTurnMemoryDedupeTag(dedupeKey)] },
      limit: 10,
    });
    expect(noteItems.items).toHaveLength(1);
  }, 10_000);
});
