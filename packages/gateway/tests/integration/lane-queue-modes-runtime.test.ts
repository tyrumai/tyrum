import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { MockLanguageModelV3 } from "ai/test";
import {
  LaneQueueSignalDal,
  LaneQueueInterruptError,
} from "../../src/modules/lanes/queue-signal-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { AgentConfig } from "@tyrum/schemas";
import { AgentConfigDal } from "../../src/modules/config/agent-config-dal.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

function usage() {
  return {
    inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 5, text: 5, reasoning: undefined },
  };
}

describe("AgentRuntime lane queue modes", () => {
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

  it("steer cancels pending tool calls and injects the steer message", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-lane-steer-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    const agentId = await container.identityScopeDal.ensureAgentId(DEFAULT_TENANT_ID, "default");
    await new AgentConfigDal(container.db).set({
      tenantId: DEFAULT_TENANT_ID,
      agentId,
      config: AgentConfig.parse({
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: { enabled: [] },
        tools: { allow: ["tool.test"] },
        sessions: { ttl_days: 30, max_turns: 20 },
        memory: { markdown_enabled: false },
      }),
      createdBy: { kind: "test" },
      reason: "lane queue steer test",
    });

    const key = "agent:default:telegram:default:dm:chat-1";
    const lane = "main";
    const signals = new LaneQueueSignalDal(container.db);

    let callCount = 0;
    const languageModel = new MockLanguageModelV3({
      doGenerate: async (options) => {
        callCount += 1;
        if (callCount === 1) {
          await signals.setSignal({
            tenant_id: DEFAULT_TENANT_ID,
            key,
            lane,
            kind: "steer",
            inbox_id: null,
            queue_mode: "steer",
            message_text: "STEERED",
            created_at_ms: Date.now(),
          });
          return {
            content: [
              {
                type: "tool-call" as const,
                toolCallId: "tc-1",
                toolName: "tool.test",
                input: "{}",
              },
            ],
            finishReason: { unified: "tool-calls" as const, raw: undefined },
            usage: usage(),
            warnings: [],
          };
        }

        const sawSteer = options.prompt.some((msg) => {
          if (msg.role !== "user") return false;
          return msg.content.some((part) => part.type === "text" && part.text.includes("STEERED"));
        });

        return {
          content: [{ type: "text" as const, text: sawSteer ? "saw STEERED" : "missing STEERED" }],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: usage(),
          warnings: [],
        };
      },
    });

    const plugins = {
      getToolDescriptors: () => [
        {
          id: "tool.test",
          description: "test tool",
          risk: "low",
          requires_confirmation: false,
          keywords: ["test"],
          inputSchema: { type: "object", additionalProperties: true },
        },
      ],
      executeTool: vi.fn(async () => ({ output: "tool executed" })),
    };

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
      plugins: plugins as unknown as ConstructorParameters<typeof AgentRuntime>[0]["plugins"],
    });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "run the test tool",
      metadata: { tyrum_key: key, lane },
    });

    expect(result.reply).toBe("saw STEERED");
    expect(plugins.executeTool).not.toHaveBeenCalled();
  });

  it("interrupt aborts at the next tool boundary", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-lane-interrupt-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    const agentId = await container.identityScopeDal.ensureAgentId(DEFAULT_TENANT_ID, "default");
    await new AgentConfigDal(container.db).set({
      tenantId: DEFAULT_TENANT_ID,
      agentId,
      config: AgentConfig.parse({
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: { enabled: [] },
        tools: { allow: ["tool.test"] },
        sessions: { ttl_days: 30, max_turns: 20 },
        memory: { markdown_enabled: false },
      }),
      createdBy: { kind: "test" },
      reason: "lane queue interrupt test",
    });

    const key = "agent:default:telegram:default:dm:chat-1";
    const lane = "main";
    const signals = new LaneQueueSignalDal(container.db);

    let callCount = 0;
    const languageModel = new MockLanguageModelV3({
      doGenerate: async () => {
        callCount += 1;
        if (callCount === 1) {
          await signals.setSignal({
            tenant_id: DEFAULT_TENANT_ID,
            key,
            lane,
            kind: "interrupt",
            inbox_id: null,
            queue_mode: "interrupt",
            message_text: "INTERRUPT",
            created_at_ms: Date.now(),
          });

          return {
            content: [
              {
                type: "tool-call" as const,
                toolCallId: "tc-1",
                toolName: "tool.test",
                input: "{}",
              },
            ],
            finishReason: { unified: "tool-calls" as const, raw: undefined },
            usage: usage(),
            warnings: [],
          };
        }

        return {
          content: [{ type: "text" as const, text: "should not reach" }],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: usage(),
          warnings: [],
        };
      },
    });

    const plugins = {
      getToolDescriptors: () => [
        {
          id: "tool.test",
          description: "test tool",
          risk: "low",
          requires_confirmation: false,
          keywords: ["test"],
          inputSchema: { type: "object", additionalProperties: true },
        },
      ],
      executeTool: vi.fn(async () => ({ output: "tool executed" })),
    };

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
      plugins: plugins as unknown as ConstructorParameters<typeof AgentRuntime>[0]["plugins"],
    });

    await expect(
      runtime.turn({
        channel: "test",
        thread_id: "thread-1",
        message: "run the test tool",
        metadata: { tyrum_key: key, lane },
      }),
    ).rejects.toBeInstanceOf(LaneQueueInterruptError);

    expect(plugins.executeTool).not.toHaveBeenCalled();
  });
});
