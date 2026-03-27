import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { GatewayContainer } from "../../src/container.js";
import { MemoryDal } from "../../src/modules/memory/memory-dal.js";
import { seedAgentConfig } from "./agent-runtime.test-helpers.js";
import { createStubLanguageModel } from "./stub-language-model.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

const generateTextMock = vi.hoisted(() => vi.fn());
const baseMemoryBudgets = {
  max_total_items: 5,
  max_total_chars: 2400,
  per_kind: {
    fact: { max_items: 2, max_chars: 600 },
    note: { max_items: 5, max_chars: 2400 },
    procedure: { max_items: 2, max_chars: 600 },
    episode: { max_items: 2, max_chars: 600 },
  },
} as const;

function textParts(text: string): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text }];
}

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: generateTextMock,
  };
});

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

describe("AgentRuntime (memory MCP pre-turn injection)", () => {
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

  it("injects pre-turn memory context into the model prompt", async () => {
    generateTextMock.mockResolvedValue({ text: "ok", steps: [] });

    const { createContainer } = await import("../../src/container.js");
    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    await seedAgentConfig(container, {
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { default_mode: "deny", workspace_trusted: false },
        mcp: {
          default_mode: "allow",
          pre_turn_tools: ["mcp.memory.seed"],
          server_settings: {
            memory: {
              enabled: true,
              keyword: { enabled: true, limit: 20 },
              semantic: { enabled: false, limit: 1 },
              budgets: baseMemoryBudgets,
            },
          },
        },
        tools: { default_mode: "allow" },
        conversations: { ttl_days: 30, max_turns: 20 },
      },
    });

    const memory = new MemoryDal(container.db);
    const item = await memory.create({
      kind: "note",
      title: "Food prefs",
      body_md: "I like pizza.",
      tags: ["prefs"],
      sensitivity: "private",
      provenance: { source_kind: "user", refs: [] },
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("unused"),
      fetchImpl: fetch404,
    } as ConstructorParameters<typeof AgentRuntime>[0]);

    const res = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      parts: textParts("pizza"),
    });
    expect(res.reply).toBe("ok");
    const reportRow = (
      await container.contextReportDal.list({ conversationId: res.session_id, limit: 1 })
    )[0];
    const report = reportRow?.report as
      | { pre_turn_tools?: Array<Record<string, unknown>> }
      | undefined;

    const call = generateTextMock.mock.calls[0]?.[0] as
      | { messages?: Array<{ role: string; content: Array<{ type: string; text: string }> }> }
      | undefined;

    const content = call?.messages?.[0]?.content ?? [];
    const stitched = content.map((part) => part.text).join("\n\n");

    expect(report?.pre_turn_tools?.[0]).toMatchObject({
      tool_id: "mcp.memory.seed",
      status: "succeeded",
    });
    expect(stitched).toContain("Pre-turn recall (mcp.memory.seed):");
    expect(stitched).toContain('<data source="tool">');
    expect(stitched).toContain(item.memory_item_id);
  });

  it("skips pre-turn memory context when memory is disabled", async () => {
    generateTextMock.mockResolvedValue({ text: "ok", steps: [] });

    const { createContainer } = await import("../../src/container.js");
    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    await seedAgentConfig(container, {
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { default_mode: "deny", workspace_trusted: false },
        mcp: {
          default_mode: "allow",
          pre_turn_tools: ["mcp.memory.seed"],
          server_settings: { memory: { enabled: false } },
        },
        tools: { default_mode: "allow" },
        conversations: { ttl_days: 30, max_turns: 20 },
      },
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("unused"),
      fetchImpl: fetch404,
    } as ConstructorParameters<typeof AgentRuntime>[0]);

    const res = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      parts: textParts("hello"),
    });
    expect(res.reply).toBe("ok");

    const call = generateTextMock.mock.calls[0]?.[0] as
      | {
          system?: string;
          tools?: Record<string, unknown>;
          messages?: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
        }
      | undefined;
    const stitched = (call?.messages?.[0]?.content ?? []).map((part) => part.text).join("\n\n");

    expect(call?.system).not.toContain("Turn memory protocol:");
    expect(call?.system).not.toContain("memory_turn_decision");
    expect(call?.tools).not.toHaveProperty("memory_turn_decision");
    expect(stitched).not.toContain("Pre-turn recall (mcp.memory.seed):");
  });

  it("still injects pre-turn memory context when memory MCP settings are partial", async () => {
    generateTextMock.mockResolvedValue({ text: "ok", steps: [] });

    const { createContainer } = await import("../../src/container.js");
    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    await seedAgentConfig(container, {
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { default_mode: "deny", workspace_trusted: false },
        mcp: {
          default_mode: "allow",
          pre_turn_tools: ["mcp.memory.seed"],
          server_settings: { memory: { enabled: true } },
        },
        tools: { default_mode: "allow" },
        conversations: { ttl_days: 30, max_turns: 20 },
      },
    });
    await container.memoryDal.create({
      kind: "note",
      body_md: "remember that I prefer tea",
      tags: ["prefs"],
      sensitivity: "private",
      provenance: { source_kind: "user", refs: [] },
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("unused"),
      fetchImpl: fetch404,
    } as ConstructorParameters<typeof AgentRuntime>[0]);

    const res = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      parts: textParts("hello"),
    });
    expect(res.reply).toBe("ok");
    const reportRow = (
      await container.contextReportDal.list({ conversationId: res.session_id, limit: 1 })
    )[0];
    const report = reportRow?.report as
      | { pre_turn_tools?: Array<Record<string, unknown>> }
      | undefined;

    const call = generateTextMock.mock.calls[0]?.[0] as
      | {
          system?: string;
          tools?: Record<string, unknown>;
          messages?: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
        }
      | undefined;
    const stitched = (call?.messages?.[0]?.content ?? []).map((part) => part.text).join("\n\n");

    expect(call?.system).not.toContain("Turn memory protocol:");
    expect(call?.system).not.toContain("memory_turn_decision");
    expect(call?.tools).not.toHaveProperty("memory_turn_decision");
    expect(report?.pre_turn_tools?.[0]).toMatchObject({
      tool_id: "mcp.memory.seed",
      status: "succeeded",
    });
    expect(stitched).toContain("Pre-turn recall (mcp.memory.seed):");
  });

  it("injects fact recall for punctuated identity questions", async () => {
    generateTextMock.mockResolvedValue({ text: "ok", steps: [] });

    const { createContainer } = await import("../../src/container.js");
    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    await seedAgentConfig(container, {
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { default_mode: "deny", workspace_trusted: false },
        mcp: {
          default_mode: "allow",
          pre_turn_tools: ["mcp.memory.seed"],
          server_settings: {
            memory: {
              enabled: true,
              keyword: { enabled: true, limit: 20 },
              semantic: { enabled: false, limit: 1 },
              budgets: baseMemoryBudgets,
            },
          },
        },
        tools: { default_mode: "allow" },
        conversations: { ttl_days: 30, max_turns: 20 },
      },
    });

    const memory = new MemoryDal(container.db);
    const item = await memory.create({
      kind: "fact",
      key: "user_name",
      value: "Ron",
      observed_at: "2026-03-14T10:06:11.684Z",
      confidence: 0.99,
      tags: ["identity", "user"],
      sensitivity: "private",
      provenance: { source_kind: "tool", refs: [] },
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("unused"),
      fetchImpl: fetch404,
    } as ConstructorParameters<typeof AgentRuntime>[0]);

    const res = await runtime.turn({
      channel: "ui",
      thread_id: "thread-identity",
      parts: textParts("Do you know my name?"),
    });
    expect(res.reply).toBe("ok");

    const call = generateTextMock.mock.calls[0]?.[0] as
      | { messages?: Array<{ role: string; content: Array<{ type: string; text: string }> }> }
      | undefined;
    const stitched = (call?.messages?.[0]?.content ?? []).map((part) => part.text).join("\n\n");

    expect(stitched).toContain("Pre-turn recall (mcp.memory.seed):");
    expect(stitched).toContain(item.memory_item_id);
    expect(stitched).toContain("key=user_name");
    expect(stitched).toContain('value="Ron"');
  });
});
