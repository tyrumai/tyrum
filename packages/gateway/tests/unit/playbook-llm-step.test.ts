import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { executePlaybookLlmStep } from "../../src/modules/playbook/llm-step.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

function resolveFetchUrl(urlOrInput: string | URL | Request): string {
  if (typeof urlOrInput === "string") return urlOrInput;
  if (urlOrInput instanceof URL) return urlOrInput.toString();
  const maybeRequest = urlOrInput as unknown as { url?: string };
  if (typeof maybeRequest.url === "string") return maybeRequest.url;
  return String(urlOrInput);
}

function createSimpleFetchStub(reply: string): typeof fetch {
  return (async (urlOrInput: string | URL | Request, _init?: RequestInit) => {
    const url = resolveFetchUrl(urlOrInput);
    if (!url.includes("/chat/completions")) {
      return new Response("not found", { status: 404 });
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: reply } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

describe("executePlaybookLlmStep", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  async function makeRuntime(fetchImpl: typeof fetch): Promise<AgentRuntime> {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-llm-"));
    container = createContainer({ dbPath: ":memory:", migrationsDir });

    // Minimal config: no tools, no skills, no MCP.
    await writeFile(
      join(homeDir, "agent.yml"),
      [
        "model:",
        "  model: test-model",
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
      fetchImpl,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
      maxSteps: 4,
    });
  }

  it("fails when output=json but reply is not JSON", async () => {
    const runtime = await makeRuntime(createSimpleFetchStub("not json"));
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
    const runtime = await makeRuntime(createSimpleFetchStub("{\"a\":1}"));
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
    const runtime = await makeRuntime(createSimpleFetchStub("hello"));
    const res = await executePlaybookLlmStep(runtime, {
      channel: "playbook",
      thread_id: "run-3",
      prompt: "hello",
    });
    expect(res.success).toBe(true);
    expect(res.output_text).toBe("hello");
  });
});

