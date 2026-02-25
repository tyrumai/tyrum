import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { MockLanguageModelV3 } from "ai/test";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("AgentRuntime within-turn loop stop reply", () => {
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

  it("includes loop stop message even when the model produced partial text", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-within-turn-loop-"));
    container = createContainer({ dbPath: ":memory:", migrationsDir });

    await writeFile(join(homeDir, "notes.txt"), "notes", "utf-8");
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
        "    - tool.fs.read",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 20",
        "  loop_detection:",
        "    within_turn:",
        "      enabled: true",
        "      consecutive_repeat_limit: 2",
        "      cycle_repeat_limit: 3",
        "    cross_turn:",
        "      enabled: false",
        "memory:",
        "  markdown_enabled: false",
      ].join("\n"),
      "utf-8",
    );

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

    const partialText = "Partial response before tool loop.";

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
                toolName: "tool.fs.read",
                input: JSON.stringify({ path: "notes.txt" }),
              },
            ],
            finishReason: { unified: "tool-calls" as const, raw: undefined },
            usage: usage(),
            warnings: [],
          };
        }

        return {
          content: [
            { type: "text" as const, text: partialText },
            {
              type: "tool-call" as const,
              toolCallId: `tc-${String(callCount)}`,
              toolName: "tool.fs.read",
              input: JSON.stringify({ path: "notes.txt" }),
            },
          ],
          finishReason: { unified: "tool-calls" as const, raw: undefined },
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
      languageModel: toolLoopModel,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    const res = await runtime.turn({
      channel: "test",
      thread_id: "thread-within-turn-loop",
      message: "read notes repeatedly",
    });

    expect(res.reply).toContain(partialText);
    expect(res.reply).toContain("Loop detected");
  }, 10_000);
});
