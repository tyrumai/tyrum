import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { MockLanguageModelV3 } from "ai/test";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { MemoryV1Dal } from "../../src/modules/memory/v1-dal.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

function usage() {
  return {
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
  };
}

function createSequencedTextLanguageModel(texts: readonly string[]): MockLanguageModelV3 {
  let callCount = 0;

  return new MockLanguageModelV3({
    doGenerate: async () => {
      const text = texts[callCount] ?? texts.at(-1) ?? "";
      callCount += 1;
      return {
        content: [{ type: "text" as const, text }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: usage(),
        warnings: [],
      };
    },
  });
}

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
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

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
        "  allow: []",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 1",
        "memory:",
        "  markdown_enabled: false",
        "  v1:",
        "    enabled: true",
      ].join("\n"),
      "utf-8",
    );

    const languageModel = createSequencedTextLanguageModel(["a1", "FLUSH_OK", "a2"]);

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
      callTool: vi.fn(async () => ({ content: [] })),
    };

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

    expect(languageModel.doGenerateCalls).toHaveLength(3);

    const flushCall = languageModel.doGenerateCalls[1];
    const flushPromptText = flushCall
      ? flushCall.prompt
          .filter((msg) => msg.role === "user")
          .flatMap((msg) => (Array.isArray(msg.content) ? msg.content : []))
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
      : "";

    expect(flushPromptText).toContain("pre-compaction");
    expect(flushPromptText).toContain("first");
    expect(flushPromptText).toContain("a1");

    const session = await container.sessionDal.getOrCreate("test", "thread-flush");
    expect(session.summary).toContain("first");
    expect(session.summary).toContain("a1");
    expect(session.summary).not.toContain("FLUSH_OK");

    const memory = new MemoryV1Dal(container.db);
    const search = await memory.search({ v: 1, query: "FLUSH_OK", limit: 5 }, "default");
    expect(search.hits.length).toBeGreaterThan(0);
    const hit = search.hits[0];
    if (!hit) {
      throw new Error("expected memory v1 search hit");
    }
    const item = await memory.getById(hit.memory_item_id, "default");
    expect(item?.kind).toBe("note");
    expect(item?.provenance.session_id).toBe(session.session_id);
    expect(item?.provenance.channel).toBe("test");
    expect(item?.provenance.thread_id).toBe("thread-flush");
    expect(item && "body_md" in item ? item.body_md : "").toContain("FLUSH_OK");
  });

  it("redacts secret-like text from the flush prompt", async () => {
    const secret = "sk-123456789012345678901234567890";

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-preflush-secret-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

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
        "  allow: []",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 1",
        "memory:",
        "  markdown_enabled: false",
        "  v1:",
        "    enabled: true",
      ].join("\n"),
      "utf-8",
    );

    const languageModel = createSequencedTextLanguageModel(["a1", "FLUSH_OK", "a2"]);

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
      callTool: vi.fn(async () => ({ content: [] })),
    };

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

    expect(languageModel.doGenerateCalls).toHaveLength(3);
    const flushCall = languageModel.doGenerateCalls[1];
    const flushPromptText = flushCall
      ? flushCall.prompt
          .filter((msg) => msg.role === "user")
          .flatMap((msg) => (Array.isArray(msg.content) ? msg.content : []))
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
      : "";

    expect(flushPromptText).not.toContain(secret);
    expect(flushPromptText).toContain("[REDACTED]");
  });

  it("redacts secret-like text from the flush result before storing it in memory v1", async () => {
    const secret = "ghp_123456789012345678901234567890";

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-preflush-secret-out-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

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
        "  allow: []",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 1",
        "memory:",
        "  markdown_enabled: false",
        "  v1:",
        "    enabled: true",
      ].join("\n"),
      "utf-8",
    );

    const languageModel = createSequencedTextLanguageModel([
      "a1",
      `Remember this: ${secret}`,
      "a2",
    ]);

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
      callTool: vi.fn(async () => ({ content: [] })),
    };

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

    const memory = new MemoryV1Dal(container.db);
    const list = await memory.list({ agentId: "default", limit: 50 });
    const notes = list.items.filter((item) => item.kind === "note");
    expect(notes).toHaveLength(1);
    const item = notes[0];
    if (!item) throw new Error("expected memory v1 note item");

    expect(item.body_md).not.toContain(secret);
    expect(item.body_md).toContain("[REDACTED]");
  });

  it("truncates very long message content in the flush prompt", async () => {
    const tail = "TAIL_SHOULD_NOT_APPEAR_IN_PROMPT";
    const longMessage = `prefix ${"x".repeat(10_000)} ${tail}`;

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-preflush-truncate-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

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
        "  allow: []",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 1",
        "memory:",
        "  markdown_enabled: false",
        "  v1:",
        "    enabled: true",
      ].join("\n"),
      "utf-8",
    );

    const languageModel = createSequencedTextLanguageModel(["a1", "NOOP", "a2"]);

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
      callTool: vi.fn(async () => ({ content: [] })),
    };

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

    expect(languageModel.doGenerateCalls).toHaveLength(3);
    const flushCall = languageModel.doGenerateCalls[1];
    const flushPromptText = flushCall
      ? flushCall.prompt
          .filter((msg) => msg.role === "user")
          .flatMap((msg) => (Array.isArray(msg.content) ? msg.content : []))
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
      : "";

    expect(flushPromptText).toContain("prefix");
    expect(flushPromptText).not.toContain(tail);
    expect(flushPromptText).toContain("...(truncated)");
  });

  it("only triggers the flush when the next append would compact (threshold behavior)", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-preflush-threshold-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

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
        "  allow: []",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 2",
        "memory:",
        "  markdown_enabled: false",
        "  v1:",
        "    enabled: true",
      ].join("\n"),
      "utf-8",
    );

    const languageModel = createSequencedTextLanguageModel(["a1", "a2", "FLUSH_OK", "a3"]);

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
      callTool: vi.fn(async () => ({ content: [] })),
    };

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
    expect(languageModel.doGenerateCalls).toHaveLength(1);

    const second = await runtime.turn({
      channel: "test",
      thread_id: "thread-threshold",
      message: "second",
    });
    expect(second.reply).toBe("a2");
    expect(languageModel.doGenerateCalls).toHaveLength(2);

    const third = await runtime.turn({
      channel: "test",
      thread_id: "thread-threshold",
      message: "third",
    });
    expect(third.reply).toBe("a3");
    expect(languageModel.doGenerateCalls).toHaveLength(4);

    const memory = new MemoryV1Dal(container.db);
    const search = await memory.search({ v: 1, query: "FLUSH_OK", limit: 5 }, "default");
    expect(search.hits.length).toBeGreaterThan(0);
  });

  it("is idempotent for the same dropped turns (no duplicate flush calls)", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-preflush-idempotent-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

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
        "  allow: []",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 1",
        "memory:",
        "  markdown_enabled: false",
        "  v1:",
        "    enabled: true",
      ].join("\n"),
      "utf-8",
    );

    const languageModel = createSequencedTextLanguageModel(["FLUSH_OK"]);

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
      callTool: vi.fn(async () => ({ content: [] })),
    };

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    const session = await container.sessionDal.getOrCreate("test", "thread-idempotent");
    await container.sessionDal.appendTurn(
      session.session_id,
      "first",
      "a1",
      1,
      new Date().toISOString(),
      "default",
    );

    const prepared = await (runtime as unknown as { prepareTurn: Function }).prepareTurn({
      channel: "test",
      thread_id: "thread-idempotent",
      message: "second",
    });

    const flush = (
      runtime as unknown as { maybeRunPreCompactionMemoryFlush: Function }
    ).maybeRunPreCompactionMemoryFlush.bind(runtime);

    await flush({
      ctx: prepared.ctx,
      session: prepared.session,
      model: prepared.model,
      systemPrompt: prepared.systemPrompt,
    });
    expect(languageModel.doGenerateCalls).toHaveLength(1);

    const memory = new MemoryV1Dal(container.db);
    const firstList = await memory.list({ agentId: "default", limit: 50 });
    expect(firstList.items).toHaveLength(1);

    await flush({
      ctx: prepared.ctx,
      session: prepared.session,
      model: prepared.model,
      systemPrompt: prepared.systemPrompt,
    });
    expect(languageModel.doGenerateCalls).toHaveLength(1);

    const secondList = await memory.list({ agentId: "default", limit: 50 });
    expect(secondList.items).toHaveLength(1);
  });

  it("bounds pre-compaction flush timeout to a slice of the turn timeout", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-preflush-timeout-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

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
        "  allow: []",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 1",
        "memory:",
        "  markdown_enabled: false",
        "  v1:",
        "    enabled: true",
      ].join("\n"),
      "utf-8",
    );

    let callCount = 0;
    const languageModel = new MockLanguageModelV3({
      doGenerate: async (options) => {
        callCount += 1;

        if (callCount === 1) {
          return {
            content: [{ type: "text" as const, text: "a1" }],
            finishReason: { unified: "stop" as const, raw: undefined },
            usage: usage(),
            warnings: [],
          };
        }

        if (callCount === 2) {
          const signal = options.abortSignal;
          if (!signal) {
            throw new Error("expected abortSignal for pre-compaction flush call");
          }

          await new Promise((_, reject) => {
            if (signal.aborted) {
              reject(new Error("aborted"));
              return;
            }
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          });
        }

        return {
          content: [{ type: "text" as const, text: "a2" }],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: usage(),
          warnings: [],
        };
      },
    });

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
      callTool: vi.fn(async () => ({ content: [] })),
    };

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    const first = await (runtime as unknown as { turnDirect: Function }).turnDirect(
      { channel: "test", thread_id: "thread-timeout", message: "first" },
      { timeoutMs: 1_000 },
    );
    expect(first.reply).toBe("a1");

    const startMs = performance.now();
    const second = await (runtime as unknown as { turnDirect: Function }).turnDirect(
      { channel: "test", thread_id: "thread-timeout", message: "second" },
      { timeoutMs: 100 },
    );
    const elapsedMs = performance.now() - startMs;

    expect(second.reply).toBe("a2");
    expect(elapsedMs).toBeLessThan(200);
  });
});
