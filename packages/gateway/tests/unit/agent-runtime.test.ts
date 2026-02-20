import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { createStubLanguageModel } from "./stub-language-model.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("AgentRuntime", () => {
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

  it("does not report context-available tools as used_tools", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("hello"),
      fetchImpl: fetch404,
    });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "read a file",
    });

    expect(result.reply).toBe("hello");
    expect(result.used_tools).toEqual([]);
  });

  it("reconciles MCP servers when MCP tools become disallowed", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    await mkdir(join(homeDir, "mcp/calendar"), { recursive: true });
    await writeFile(
      join(homeDir, "agent.yml"),
      `model:\n  model: tyrum-stub-8b\nskills:\n  enabled: []\nmcp:\n  enabled:\n    - calendar\ntools:\n  allow:\n    - tool.fs.read\n    - mcp.*\nsessions:\n  ttl_days: 30\n  max_turns: 20\nmemory:\n  markdown_enabled: false\n`,
      "utf-8",
    );
    await writeFile(
      join(homeDir, "mcp/calendar/server.yml"),
      `id: calendar\nname: Calendar MCP\nenabled: true\ntransport: stdio\ncommand: node\nargs: []\n`,
      "utf-8",
    );

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
    };

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("hello"),
      fetchImpl: fetch404,
      mcpManager:
        mcpManager as unknown as ConstructorParameters<
          typeof AgentRuntime
        >[0]["mcpManager"],
    });

    await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "hello",
    });

    expect(mcpManager.listToolDescriptors).toHaveBeenCalledTimes(1);
    expect(mcpManager.listToolDescriptors).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([expect.objectContaining({ id: "calendar" })]),
    );

    await writeFile(
      join(homeDir, "agent.yml"),
      `model:\n  model: tyrum-stub-8b\nskills:\n  enabled: []\nmcp:\n  enabled:\n    - calendar\ntools:\n  allow:\n    - tool.fs.read\nsessions:\n  ttl_days: 30\n  max_turns: 20\nmemory:\n  markdown_enabled: false\n`,
      "utf-8",
    );

    await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "hello again",
    });

    expect(mcpManager.listToolDescriptors).toHaveBeenCalledTimes(2);
    expect(mcpManager.listToolDescriptors).toHaveBeenNthCalledWith(2, []);
  });

  it("shutdown calls McpManager.shutdown()", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
    };

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("hello"),
      fetchImpl: fetch404,
      mcpManager:
        mcpManager as unknown as ConstructorParameters<
          typeof AgentRuntime
        >[0]["mcpManager"],
    });

    await runtime.shutdown();
    expect(mcpManager.shutdown).toHaveBeenCalledTimes(1);
  });
});
