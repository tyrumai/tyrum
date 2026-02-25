import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { createStubLanguageModel } from "./stub-language-model.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("AgentRuntime cross-turn loop warning", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("warns once when replies repeat across turns", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-loop-warning-"));
    container = createContainer({ dbPath: ":memory:", migrationsDir });

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
        "  max_turns: 20",
        "memory:",
        "  markdown_enabled: false",
      ].join("\n"),
      "utf-8",
    );

    const longReply = [
      "Here is a long reply that should be treated as repetitive when it shows up again.",
      "It contains enough characters to exceed the default cross-turn loop detection min_chars threshold.",
      "No tools are needed for this test.",
    ].join(" ");

    const languageModel = createStubLanguageModel(longReply);
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
      thread_id: "thread-cross-turn-loop",
      message: "hi",
    });
    expect(first.reply).toBe(longReply);

    const second = await runtime.turn({
      channel: "test",
      thread_id: "thread-cross-turn-loop",
      message: "hi again",
    });
    expect(second.reply).toContain("Loop warning:");

    const third = await runtime.turn({
      channel: "test",
      thread_id: "thread-cross-turn-loop",
      message: "hi again again",
    });
    expect(third.reply).toBe(longReply);
  });
});

