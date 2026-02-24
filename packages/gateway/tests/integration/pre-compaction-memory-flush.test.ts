import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { MockLanguageModelV3 } from "ai/test";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";

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
        "  markdown_enabled: true",
      ].join("\n"),
      "utf-8",
    );

    const languageModel = createSequencedTextLanguageModel([
      "a1",
      "FLUSH_OK",
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
      mcpManager: mcpManager as unknown as ConstructorParameters<typeof AgentRuntime>[0]["mcpManager"],
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

    const isoDay = new Date().toISOString().slice(0, 10);
    const daily = await readFile(join(homeDir, "memory", `${isoDay}.md`), "utf-8");
    expect(daily).toContain("Pre-compaction memory flush");
    expect(daily).toContain("FLUSH_OK");
  });
});

