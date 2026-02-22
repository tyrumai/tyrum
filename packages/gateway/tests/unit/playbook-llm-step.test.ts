import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { executePlaybookLlmStep } from "../../src/modules/playbook/llm-step.js";
import { createStubLanguageModel } from "./stub-language-model.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("executePlaybookLlmStep", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;
  const fetch404 = (async () => new Response("not found", { status: 404 })) as typeof fetch;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  async function makeRuntime(reply: string): Promise<AgentRuntime> {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-llm-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    // Minimal config: no tools, no skills, no MCP.
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

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
      callTool: vi.fn(async () => ({ content: [] })),
    };

    return new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel(reply),
      fetchImpl: fetch404,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
      maxSteps: 4,
    });
  }

  it("fails when output=json but reply is not JSON", async () => {
    const runtime = await makeRuntime("not json");
    const res = await executePlaybookLlmStep(runtime, {
      channel: "playbook",
      thread_id: "run-1",
      prompt: "return json",
      output: "json",
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain("expected JSON");
  });

  it("parses reply when output=json", async () => {
    const runtime = await makeRuntime("{\"a\":1}");
    const res = await executePlaybookLlmStep(runtime, {
      channel: "playbook",
      thread_id: "run-2",
      prompt: "return json",
      output: "json",
    });
    expect(res.success).toBe(true);
    expect(res.output_json).toEqual({ a: 1 });
  });

  it("returns text when output is unspecified", async () => {
    const runtime = await makeRuntime("hello");
    const res = await executePlaybookLlmStep(runtime, {
      channel: "playbook",
      thread_id: "run-3",
      prompt: "hello",
    });
    expect(res.success).toBe(true);
    expect(res.output_text).toBe("hello");
  });
});
