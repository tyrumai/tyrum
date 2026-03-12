import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { GatewayContainer } from "../../src/container.js";
import { createContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { createPromptAwareLanguageModel } from "./agent-behavior.test-support.js";
import {
  fetch404,
  migrationsDir,
  seedAgentConfig,
  teardownTestEnv,
} from "./agent-runtime.test-helpers.js";
import { createMemoryDecisionLanguageModel } from "./stub-language-model.js";

describe("AgentRuntime turn-signal memory finalization", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  it("defaults auto-written procedure confidence to 1", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });
    await seedAgentConfig(container, {
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: { enabled: [] },
        tools: { allow: [] },
        sessions: { ttl_days: 30, max_turns: 20 },
        memory: {
          v1: {
            enabled: true,
            auto_write: { enabled: true },
          },
        },
      },
    });

    const createSpy = vi.spyOn(container.memoryV1Dal, "create");

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createMemoryDecisionLanguageModel({
        decision: {
          should_store: true,
          reason: "The turn produced a reusable procedure.",
          memory: {
            kind: "procedure",
            title: "Restart the worker",
            body_md: "Stop the worker, clear the queue, and restart the service.",
          },
        },
        reply: "Documented the restart procedure.",
      }),
      fetchImpl: fetch404,
    });

    await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "document the recovery procedure",
    });

    const procedureCall = createSpy.mock.calls.find(([input]) => input?.kind === "procedure");
    expect(procedureCall?.[0]).toEqual(
      expect.objectContaining({
        confidence: 1,
      }),
    );
  }, 10_000);

  it("does not auto-write turn memory when auto-write is disabled", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });
    await seedAgentConfig(container, {
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: { enabled: [] },
        tools: { allow: [] },
        sessions: { ttl_days: 30, max_turns: 20 },
        memory: {
          v1: {
            enabled: true,
            auto_write: { enabled: false },
          },
        },
      },
    });

    const createSpy = vi.spyOn(container.memoryV1Dal, "create");

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createPromptAwareLanguageModel(() => "Stored.", {
        memoryDecision: ({ promptText }) =>
          promptText.toLowerCase().includes("remember that my name is ron")
            ? {
                should_store: true,
                reason: "Durable user profile detail.",
                memory: {
                  kind: "note",
                  body_md: "Remember that my name is Ron.",
                },
              }
            : undefined,
      }),
      fetchImpl: fetch404,
    });

    const response = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "remember that my name is Ron",
    });

    expect(response.memory_written).toBe(false);
    expect(createSpy).not.toHaveBeenCalled();
  }, 10_000);
});
