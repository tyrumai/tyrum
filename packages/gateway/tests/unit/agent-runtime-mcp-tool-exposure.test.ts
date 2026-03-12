import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { createStubLanguageModel } from "./stub-language-model.js";
import {
  seedAgentConfig,
  fetch404,
  migrationsDir,
  teardownTestEnv,
} from "./agent-runtime.test-helpers.js";

describe("AgentRuntime MCP tool exposure", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  it("exposes all enabled MCP tools to the model tool set", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-mcp-tools-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    await mkdir(join(homeDir, "mcp/calendar"), { recursive: true });
    await seedAgentConfig(container, {
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: { enabled: ["calendar"] },
        tools: { allow: ["read", "mcp.*"] },
        sessions: { ttl_days: 30, max_turns: 20 },
        memory: { v1: { enabled: false } },
      },
    });
    await writeFile(
      join(homeDir, "mcp/calendar/server.yml"),
      `id: calendar\nname: Calendar MCP\nenabled: true\ntransport: stdio\ncommand: node\nargs: []\n`,
      "utf-8",
    );

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => [
        {
          id: "mcp.calendar.events_list",
          description: "List calendar events.",
          risk: "medium" as const,
          requires_confirmation: true,
          keywords: ["calendar", "events"],
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
        },
        {
          id: "mcp.calendar.events_create",
          description: "Create calendar events.",
          risk: "medium" as const,
          requires_confirmation: true,
          keywords: ["calendar", "create"],
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
        },
      ]),
      shutdown: vi.fn(async () => {}),
    };

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("hello"),
      fetchImpl: fetch404,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    await runtime.turn({
      channel: "test",
      thread_id: "thread-mcp",
      message: "calendar",
    });

    expect(runtime.getLastContextReport()?.selected_tools).toEqual([
      "mcp.calendar.events_create",
      "mcp.calendar.events_list",
      "read",
    ]);
  });
});
