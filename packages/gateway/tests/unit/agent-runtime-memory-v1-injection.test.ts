import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { GatewayContainer } from "../../src/container.js";
import { MemoryV1Dal } from "../../src/modules/memory/v1-dal.js";
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

describe("AgentRuntime (Memory v1 digest injection)", () => {
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

  it("injects a Memory digest into the model prompt and removes markdown injection", async () => {
    generateTextMock.mockResolvedValueOnce({ text: "ok", steps: [] });

    const { createContainer } = await import("../../src/container.js");
    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
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
        "memory:",
        "  markdown_enabled: false",
        "  v1:",
        "    enabled: true",
        "    keyword:",
        "      enabled: true",
        "      limit: 20",
        "    budgets:",
        "      max_total_items: 5",
        "      max_total_chars: 2400",
        "      per_kind:",
        "        note:",
        "          max_items: 5",
        "          max_chars: 2400",
        "",
      ].join("\n"),
      "utf-8",
    );

    const memory = new MemoryV1Dal(container.db);
    const item = await memory.create(
      {
        kind: "note",
        title: "Food prefs",
        body_md: "I like pizza.",
        tags: ["prefs"],
        sensitivity: "private",
        provenance: { source_kind: "user", refs: [] },
      },
      "default",
    );

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("unused"),
      fetchImpl: fetch404,
    } as ConstructorParameters<typeof AgentRuntime>[0]);

    const res = await runtime.turn({ channel: "test", thread_id: "thread-1", message: "pizza" });
    expect(res.reply).toBe("ok");

    const call = generateTextMock.mock.calls[0]?.[0] as
      | { messages?: Array<{ role: string; content: Array<{ type: string; text: string }> }> }
      | undefined;

    const content = call?.messages?.[0]?.content ?? [];
    const stitched = content.map((part) => part.text).join("\n\n");

    expect(stitched).toContain("Memory digest:");
    expect(stitched).toContain('<data source="memory">');
    expect(stitched).toContain(item.memory_item_id);
    expect(stitched).not.toContain("Long-term memory matches:");
  });
});
