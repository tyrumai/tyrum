import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayContainer } from "../../src/container.js";
import {
  createDeferred,
  teardownTestEnv,
  fetch404,
  DEFAULT_TENANT_ID,
  migrationsDir,
} from "./agent-runtime.test-helpers.js";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { simulateReadableStream } from "ai";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { createStubLanguageModel } from "./stub-language-model.js";

describe("AgentRuntime - engine timing and concurrency", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  it("does not abort turns immediately when execution step timeouts are non-finite", async () => {
    let aborted = false;

    const model: LanguageModelV3 = {
      specificationVersion: "v3",
      provider: "test",
      modelId: "nan-timeout",
      supportedUrls: {},

      async doStream(_options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "text-start" as const, id: "text-1" },
              { type: "text-delta" as const, id: "text-1", delta: "ok" },
              { type: "text-end" as const, id: "text-1" },
              {
                type: "finish" as const,
                finishReason: { unified: "stop" as const, raw: undefined },
                logprobs: undefined,
                usage: {
                  inputTokens: {
                    total: 1,
                    noCache: 1,
                    cacheRead: undefined,
                    cacheWrite: undefined,
                  },
                  outputTokens: { total: 1, text: 1, reasoning: undefined },
                },
              },
            ],
          }),
          warnings: [],
        };
      },

      async doGenerate(
        options: LanguageModelV3CallOptions,
      ): Promise<LanguageModelV3GenerateResult> {
        const anyOptions = options as unknown as LanguageModelV3CallOptions & {
          signal?: AbortSignal;
        };
        const abortSignal = anyOptions.abortSignal ?? anyOptions.signal;
        if (abortSignal?.aborted) {
          aborted = true;
          throw new Error("timed out");
        }

        return await new Promise<LanguageModelV3GenerateResult>((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve({
              content: [{ type: "text" as const, text: "ok" }],
              finishReason: { unified: "stop" as const, raw: undefined },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 1, text: 1, reasoning: undefined },
              },
              warnings: [],
            });
          }, 50);

          options.abortSignal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              clearTimeout(timer);
              reject(new Error("timed out"));
            },
            { once: true },
          );
        });
      },
    };

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: model,
      fetchImpl: fetch404,
      turnEngineWaitMs: 500,
    } as ConstructorParameters<typeof AgentRuntime>[0]);

    const engine = (runtime as unknown as { executionEngine: ExecutionEngine }).executionEngine;
    const engineAny = engine as unknown as Record<string, unknown>;

    const originalEnqueuePlan = engine.enqueuePlan.bind(engine);
    engine.enqueuePlan = async (input) => {
      const res = await originalEnqueuePlan(input);
      await container!.db.run("UPDATE execution_steps SET max_attempts = 1 WHERE run_id = ?", [
        res.runId,
      ]);
      return res;
    };

    const originalExecuteWithTimeout = engineAny["executeWithTimeout"] as
      | ((...args: unknown[]) => Promise<unknown>)
      | undefined;
    if (typeof originalExecuteWithTimeout !== "function") {
      throw new Error("expected ExecutionEngine.executeWithTimeout to exist");
    }

    engineAny["executeWithTimeout"] = async (...args: unknown[]) => {
      // Force the inline executor to see a non-finite timeout value.
      return await originalExecuteWithTimeout.apply(engine, [
        args[0],
        args[1],
        args[2],
        args[3],
        Number.NaN,
      ]);
    };

    const res = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "hello",
    });

    expect(res.reply).toBe("ok");
    expect(aborted).toBe(false);
  });

  it("does not time out after a run succeeds on the last engine tick", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const turnEngineWaitMs = 2_000;
    const realNow = Date.now.bind(Date);
    let timeOffsetMs = 0;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => realNow() + timeOffsetMs);

    try {
      const runtime = new AgentRuntime({
        container,
        home: homeDir,
        languageModel: createStubLanguageModel("ok"),
        fetchImpl: fetch404,
        turnEngineWaitMs,
      } as ConstructorParameters<typeof AgentRuntime>[0]);

      const engine = (runtime as unknown as { executionEngine: ExecutionEngine }).executionEngine;
      const originalWorkerTick = engine.workerTick.bind(engine);
      let advancedClock = false;

      engine.workerTick = async (opts) => {
        const didWork = await originalWorkerTick(opts);
        if (didWork) {
          const runId = (opts as { runId?: string }).runId;
          if (runId) {
            const run = await container!.db.get<{ status: string }>(
              "SELECT status FROM execution_runs WHERE run_id = ?",
              [runId],
            );
            if (run?.status === "succeeded") {
              // Simulate expensive work after the run has already completed by
              // advancing the clock beyond the turn deadline before the caller
              // can observe the terminal run status in the next polling loop.
              if (!advancedClock) {
                timeOffsetMs = turnEngineWaitMs + 500;
                advancedClock = true;
              }
            }
          }
        }
        return didWork;
      };

      const res = await runtime.turn({
        channel: "test",
        thread_id: "thread-1",
        message: "hello",
      });

      expect(res.reply).toBe("ok");
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("prefers the attempt error for failed runs over stale pause metadata", async () => {
    const model: LanguageModelV3 = {
      specificationVersion: "v3",
      provider: "test",
      modelId: "fail",
      supportedUrls: {},

      async doStream(_options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "text-start" as const, id: "text-1" },
              { type: "text-delta" as const, id: "text-1", delta: "" },
              { type: "text-end" as const, id: "text-1" },
              {
                type: "finish" as const,
                finishReason: { unified: "stop" as const, raw: undefined },
                logprobs: undefined,
                usage: {
                  inputTokens: {
                    total: 1,
                    noCache: 1,
                    cacheRead: undefined,
                    cacheWrite: undefined,
                  },
                  outputTokens: { total: 1, text: 1, reasoning: undefined },
                },
              },
            ],
          }),
          warnings: [],
        };
      },

      async doGenerate(
        _options: LanguageModelV3CallOptions,
      ): Promise<LanguageModelV3GenerateResult> {
        throw new Error("real failure");
      },
    };

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: model,
      fetchImpl: fetch404,
    });

    const engine = (runtime as unknown as { executionEngine: ExecutionEngine }).executionEngine;
    const originalEnqueuePlan = engine.enqueuePlan.bind(engine);
    engine.enqueuePlan = async (input) => {
      const res = await originalEnqueuePlan(input);
      await container!.db.run("UPDATE execution_steps SET max_attempts = 1 WHERE run_id = ?", [
        res.runId,
      ]);
      await container!.db.run(
        "UPDATE execution_runs SET paused_reason = 'stale', paused_detail = 'stale pause' WHERE run_id = ?",
        [res.runId],
      );
      return res;
    };

    let message = "";
    try {
      await runtime.turn({
        channel: "test",
        thread_id: "thread-1",
        message: "hello",
      });
      throw new Error("expected turn() to fail");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).toMatch(/real failure/i);
    expect(message).not.toMatch(/stale pause/i);
  });

  it("serializes concurrent turns for the same thread", async () => {
    const gate = createDeferred<void>();
    const firstStarted = createDeferred<void>();

    let calls = 0;
    const model: LanguageModelV3 = {
      specificationVersion: "v3",
      provider: "test",
      modelId: "serial",
      supportedUrls: {},

      async doStream(_options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "text-start" as const, id: "text-1" },
              { type: "text-delta" as const, id: "text-1", delta: "stream" },
              { type: "text-end" as const, id: "text-1" },
              {
                type: "finish" as const,
                finishReason: { unified: "stop" as const, raw: undefined },
                logprobs: undefined,
                usage: {
                  inputTokens: {
                    total: 1,
                    noCache: 1,
                    cacheRead: undefined,
                    cacheWrite: undefined,
                  },
                  outputTokens: { total: 1, text: 1, reasoning: undefined },
                },
              },
            ],
          }),
          warnings: [],
        };
      },

      async doGenerate(
        _options: LanguageModelV3CallOptions,
      ): Promise<LanguageModelV3GenerateResult> {
        calls += 1;
        if (calls === 1) {
          firstStarted.resolve();
          await gate.promise;
          return {
            content: [{ type: "text" as const, text: "first" }],
            finishReason: { unified: "stop" as const, raw: undefined },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
            },
            warnings: [],
          };
        }
        return {
          content: [{ type: "text" as const, text: "second" }],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
          },
          warnings: [],
        };
      },
    };

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: model,
      fetchImpl: fetch404,
    });

    const p1 = runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "m1",
    });

    await firstStarted.promise;

    const p2 = runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "m2",
    });

    try {
      // Yield to allow the second turn to start its own attempt if turns are not serialized.
      for (let i = 0; i < 5; i += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      let runs: Array<{ run_id: string; status: string }> = [];
      for (let i = 0; i < 20; i += 1) {
        runs = await container.db.all<{ run_id: string; status: string }>(
          `SELECT run_id, status
           FROM execution_runs
           WHERE key = 'agent:default:test:default:channel:thread-1' AND lane = 'main'
           ORDER BY rowid ASC`,
        );
        if (runs.length >= 2) break;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(runs.length).toBeGreaterThanOrEqual(2);

      const secondRunId = runs[1]!.run_id;
      let secondAttempts: Array<{ attempt_id: string; status: string }> = [];
      for (let i = 0; i < 20; i += 1) {
        secondAttempts = await container.db.all<{ attempt_id: string; status: string }>(
          `SELECT a.attempt_id, a.status
           FROM execution_attempts a
           JOIN execution_steps s ON s.step_id = a.step_id
           WHERE s.run_id = ?`,
          [secondRunId],
        );
        if (secondAttempts.length > 0) break;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      expect(secondAttempts).toEqual([]);

      gate.resolve();

      const r1 = await p1;
      const r2 = await p2;

      expect(r1.reply).toBe("first");
      expect(r2.reply).toBe("second");

      const session = await container.sessionDal.getByKey({
        tenantId: DEFAULT_TENANT_ID,
        sessionKey: "agent:default:test:default:channel:thread-1",
      });
      expect(session).toBeTruthy();
      expect(session!.turns.map((t) => `${t.role}:${t.content}`)).toEqual([
        "user:m1",
        "assistant:first",
        "user:m2",
        "assistant:second",
      ]);
    } finally {
      gate.resolve();
      await Promise.allSettled([p1, p2]);
    }
  });
});
