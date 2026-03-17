import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { MemoryDal } from "../../src/modules/memory/memory-dal.js";
import {
  checkpointJson,
  countFlushCalls,
  createMemoryWriteToolStep,
  createMockMcpManager,
  createSequencedGenerateLanguageModel,
  findFlushPromptText,
  listNonTitleGenerateCalls,
  seedAgentConfig,
} from "./pre-compaction-memory-flush.test-support.js";

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

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("Pre-compaction memory flush", () => {
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

  it("runs a silent flush turn before session compaction", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-preflush-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    const { agentId } = await seedAgentConfig(container, { maxTurns: 1 });

    const languageModel = createSequencedGenerateLanguageModel([
      "a1",
      createMemoryWriteToolStep({
        kind: "note",
        body_md: "FLUSH_OK",
      }),
      "",
      checkpointJson("summary: first / a1"),
      "a2",
    ]);

    const mcpManager = createMockMcpManager();

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    const first = await runtime.turn({
      channel: "test",
      thread_id: "thread-flush",
      message: "first",
    });
    expect(first.reply).toBe("a1");

    const second = await runtime.turn({
      channel: "test",
      thread_id: "thread-flush",
      message: "second",
    });
    expect(second.reply).toBe("a2");

    expect(listNonTitleGenerateCalls(languageModel)).toHaveLength(5);

    const flushPromptText = findFlushPromptText(languageModel);

    expect(flushPromptText).toContain("pre-compaction");
    expect(flushPromptText).toContain("first");
    expect(flushPromptText).not.toContain("Assistant (");

    const session = await container.sessionDal.getOrCreate({
      connectorKey: "test",
      providerThreadId: "thread-flush",
      containerKind: "channel",
    });
    const handoff = session.context_state.checkpoint?.handoff_md ?? "";
    expect(handoff).toContain("summary: first / a1");
    expect(handoff).not.toContain("FLUSH_OK");

    const memory = new MemoryDal(container.db);
    const search = await memory.search({ v: 1, query: "FLUSH_OK", limit: 5 }, agentId);
    expect(search.hits.length).toBeGreaterThan(0);
    const hit = search.hits[0];
    if (!hit) {
      throw new Error("expected memory v1 search hit");
    }
    const item = await memory.getById(hit.memory_item_id, agentId);
    expect(item?.kind).toBe("note");
    expect(item?.provenance.session_id).toBe(session.session_id);
    expect(item?.provenance.channel).toBe("test");
    expect(item?.provenance.thread_id).toBe("thread-flush");
    expect(item && "body_md" in item ? item.body_md : "").toContain("FLUSH_OK");
  });

  it("redacts secret-like text from the flush prompt", async () => {
    const secret = "sk-123456789012345678901234567890";

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-preflush-secret-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    await seedAgentConfig(container, { maxTurns: 1 });

    const languageModel = createSequencedGenerateLanguageModel([
      "a1",
      createMemoryWriteToolStep({
        kind: "note",
        body_md: "FLUSH_OK",
      }),
      "",
      checkpointJson("summary: secret redaction"),
      "a2",
    ]);

    const mcpManager = createMockMcpManager();

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    const first = await runtime.turn({
      channel: "test",
      thread_id: "thread-secret",
      message: `my key is ${secret}`,
    });
    expect(first.reply).toBe("a1");

    const second = await runtime.turn({
      channel: "test",
      thread_id: "thread-secret",
      message: "second",
    });
    expect(second.reply).toBe("a2");

    expect(listNonTitleGenerateCalls(languageModel)).toHaveLength(5);

    const flushPromptText = findFlushPromptText(languageModel);

    expect(flushPromptText).not.toContain(secret);
    expect(flushPromptText).toContain("[REDACTED]");
  });

  it("redacts secret-like text from the flush result before storing it in memory v1", async () => {
    const secret = "ghp_123456789012345678901234567890";

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-preflush-secret-out-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    const { tenantId, agentId } = await seedAgentConfig(container, { maxTurns: 1 });

    const languageModel = createSequencedGenerateLanguageModel([
      "a1",
      createMemoryWriteToolStep({
        kind: "note",
        body_md: `Remember this: ${secret}`,
      }),
      "",
      checkpointJson("summary: secret output redaction"),
      "a2",
    ]);

    const mcpManager = createMockMcpManager();

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    const first = await runtime.turn({
      channel: "test",
      thread_id: "thread-secret-out",
      message: "first",
    });
    expect(first.reply).toBe("a1");

    const second = await runtime.turn({
      channel: "test",
      thread_id: "thread-secret-out",
      message: "second",
    });
    expect(second.reply).toBe("a2");

    const memory = new MemoryDal(container.db);
    const list = await memory.list({ tenantId, agentId, limit: 50 });
    const notes = list.items.filter((item) => item.kind === "note");
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.some((item) => item.body_md.includes("[REDACTED]"))).toBe(true);
    for (const item of notes) {
      expect(item.body_md).not.toContain(secret);
    }
  });

  it("truncates very long message content in the flush prompt", async () => {
    const tail = "TAIL_SHOULD_NOT_APPEAR_IN_PROMPT";
    const longMessage = `prefix ${"x".repeat(10_000)} ${tail}`;

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-preflush-truncate-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    await seedAgentConfig(container, { maxTurns: 1 });

    const languageModel = createSequencedGenerateLanguageModel([
      "a1",
      "",
      checkpointJson("summary: truncate"),
      "a2",
    ]);

    const mcpManager = createMockMcpManager();

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    const first = await runtime.turn({
      channel: "test",
      thread_id: "thread-truncate",
      message: longMessage,
    });
    expect(first.reply).toBe("a1");

    const second = await runtime.turn({
      channel: "test",
      thread_id: "thread-truncate",
      message: "second",
    });
    expect(second.reply).toBe("a2");

    expect(listNonTitleGenerateCalls(languageModel)).toHaveLength(4);

    const flushPromptText = findFlushPromptText(languageModel);

    expect(flushPromptText).toContain("prefix");
    expect(flushPromptText).not.toContain(tail);
    expect(flushPromptText).toContain("...(truncated)");
  });

  it("only triggers the flush when the next append would compact (threshold behavior)", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-preflush-threshold-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    const { agentId } = await seedAgentConfig(container, { maxTurns: 3 });

    const languageModel = createSequencedGenerateLanguageModel([
      "a1",
      "a2",
      "a3",
      createMemoryWriteToolStep({
        kind: "note",
        body_md: "FLUSH_OK",
      }),
      "",
      checkpointJson("summary: threshold"),
      "a4",
    ]);

    const mcpManager = createMockMcpManager();

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    const first = await runtime.turn({
      channel: "test",
      thread_id: "thread-threshold",
      message: "first",
    });
    expect(first.reply).toBe("a1");
    expect(countFlushCalls(languageModel)).toBe(0);

    const second = await runtime.turn({
      channel: "test",
      thread_id: "thread-threshold",
      message: "second",
    });
    expect(second.reply).toBe("a2");
    expect(listNonTitleGenerateCalls(languageModel)).toHaveLength(2);
    expect(countFlushCalls(languageModel)).toBe(0);

    const third = await runtime.turn({
      channel: "test",
      thread_id: "thread-threshold",
      message: "third",
    });
    expect(third.reply).toBe("a3");
    expect(listNonTitleGenerateCalls(languageModel)).toHaveLength(3);
    expect(countFlushCalls(languageModel)).toBe(0);

    const fourth = await runtime.turn({
      channel: "test",
      thread_id: "thread-threshold",
      message: "fourth",
    });
    expect(fourth.reply).toBe("a4");
    expect(listNonTitleGenerateCalls(languageModel)).toHaveLength(7);
    expect(countFlushCalls(languageModel)).toBe(1);

    const memory = new MemoryDal(container.db);
    const search = await memory.search({ v: 1, query: "FLUSH_OK", limit: 5 }, agentId);
    expect(search.hits.length).toBeGreaterThan(0);
  });

  it("uses prompt-visible recent messages for max_turns after prompt-only compaction", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-preflush-prompt-only-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    await seedAgentConfig(container, { maxTurns: 3 });

    const languageModel = createSequencedGenerateLanguageModel([
      "a1",
      "a2",
      "a3",
      createMemoryWriteToolStep({
        kind: "note",
        body_md: "FLUSH_OK",
      }),
      "",
      checkpointJson("summary: prompt-only"),
      "a4",
      "a5",
    ]);

    const mcpManager = createMockMcpManager();

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    expect(
      (
        await runtime.turn({
          channel: "test",
          thread_id: "thread-prompt-only",
          message: "first",
        })
      ).reply,
    ).toBe("a1");
    expect(
      (
        await runtime.turn({
          channel: "test",
          thread_id: "thread-prompt-only",
          message: "second",
        })
      ).reply,
    ).toBe("a2");
    expect(
      (
        await runtime.turn({
          channel: "test",
          thread_id: "thread-prompt-only",
          message: "third",
        })
      ).reply,
    ).toBe("a3");

    expect(listNonTitleGenerateCalls(languageModel)).toHaveLength(3);
    expect(countFlushCalls(languageModel)).toBe(0);

    expect(
      (
        await runtime.turn({
          channel: "test",
          thread_id: "thread-prompt-only",
          message: "fourth",
        })
      ).reply,
    ).toBe("a4");

    expect(listNonTitleGenerateCalls(languageModel)).toHaveLength(7);
    expect(countFlushCalls(languageModel)).toBe(1);

    expect(
      (
        await runtime.turn({
          channel: "test",
          thread_id: "thread-prompt-only",
          message: "fifth",
        })
      ).reply,
    ).toBe("a5");

    expect(listNonTitleGenerateCalls(languageModel)).toHaveLength(8);
    expect(countFlushCalls(languageModel)).toBe(1);
  });
});
