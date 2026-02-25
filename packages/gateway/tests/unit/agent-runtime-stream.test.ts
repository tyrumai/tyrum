import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { createStubLanguageModel } from "./stub-language-model.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("AgentRuntime.turnStream", () => {
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

  it("returns the streamed reply", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-stream-"));
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
        "  max_turns: 20",
        "  loop_detection:",
        "    within_turn:",
        "      enabled: true",
        "      consecutive_repeat_limit: 3",
        "      cycle_repeat_limit: 3",
        "    cross_turn:",
        "      enabled: false",
        "      window_assistant_messages: 3",
        "      similarity_threshold: 0.97",
        "      min_chars: 120",
        "      cooldown_assistant_messages: 6",
        "memory:",
        "  markdown_enabled: false",
      ].join("\n"),
      "utf-8",
    );

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("hello"),
    });

    const { finalize } = await runtime.turnStream({
      channel: "test",
      thread_id: "thread-stream-1",
      message: "hi",
    });

    const result = await finalize();
    expect(result.reply).toBe("hello");
    expect(result.used_tools).toEqual([]);
  }, 10_000);
});
