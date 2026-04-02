import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayContainer } from "../../src/container.js";
import {
  seedAgentConfig,
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
import { MockLanguageModelV3 } from "ai/test";

describe("AgentRuntime - engine isolation and backoff", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  it("does not execute other agents' queued runs when ticking inline", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const engine = new ExecutionEngine({ db: container.db });
    const queued = await engine.enqueuePlan({
      tenantId: DEFAULT_TENANT_ID,
      key: "agent:agent-b:test:channel:thread-b",
      planId: "test-plan-b",
      requestId: "req-b",
      steps: [
        {
          type: "Decide",
          args: { channel: "test", thread_id: "thread-b", message: "hello b" },
        },
      ],
    });

    // Ensure this run sorts ahead of the new run enqueued by runtime.turn().
    await container.db.run(
      "UPDATE turns SET created_at = '2000-01-01 00:00:00' WHERE turn_id = ?",
      [queued.turnId],
    );

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      agentId: "agent-a",
      workspaceId: "agent-a",
      languageModel: createStubLanguageModel("from a"),
      fetchImpl: fetch404,
    });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-a",
      message: "hello a",
    });

    expect(result.reply).toBe("from a");

    const other = await container.db.get<{ status: string }>(
      "SELECT status FROM turns WHERE turn_id = ?",
      [queued.turnId],
    );

    expect(other).toBeTruthy();
    expect(other!.status).toBe("queued");
  });

  it("backs off between engine ticks instead of busy-waiting the database", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));

    try {
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

      const key = "agent:default:test:default:channel:thread-1";
      await container.db.run(
        `INSERT INTO conversation_leases (tenant_id, conversation_key, lease_owner, lease_expires_at_ms)
         VALUES (?, ?, 'other', ?)`,
        [DEFAULT_TENANT_ID, key, Date.now() + 10_000],
      );

      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

      const turnPromise = runtime
        .turn({
          channel: "test",
          thread_id: "thread-1",
          message: "hello",
        })
        .catch((err) => err as unknown);

      await vi.advanceTimersByTimeAsync(100);

      expect(setTimeoutSpy).toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(10_000);

      const res = await turnPromise;
      if (res instanceof Error) {
        throw res;
      }
      expect((res as { reply?: string }).reply).toBe("hello");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels execution runs when turn engine wait times out", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));

    try {
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
        turnEngineWaitMs: 50,
      } as ConstructorParameters<typeof AgentRuntime>[0]);

      const key = "agent:default:test:default:channel:thread-1";
      await container.db.run(
        `INSERT INTO conversation_leases (tenant_id, conversation_key, lease_owner, lease_expires_at_ms)
         VALUES (?, ?, 'other', ?)`,
        [DEFAULT_TENANT_ID, key, Date.now() + 10_000],
      );

      const turnPromise = runtime
        .turn({
          channel: "test",
          thread_id: "thread-1",
          message: "hello",
        })
        .catch((err) => err as unknown);
      await vi.advanceTimersByTimeAsync(250);
      const result = await turnPromise;

      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/did not complete within/i);

      const run = await container.db.get<{ turn_id: string; status: string; job_id: string }>(
        `SELECT turn_id, status, job_id
         FROM turns
         ORDER BY rowid DESC
         LIMIT 1`,
      );

      expect(run).toBeTruthy();
      expect(run!.status).toBe("cancelled");

      const job = await container.db.get<{ status: string }>(
        "SELECT status FROM turn_jobs WHERE job_id = ?",
        [run!.job_id],
      );
      expect(job).toBeTruthy();
      expect(job!.status).toBe("cancelled");

      const steps = await container.db.all<{ status: string }>(
        "SELECT status FROM execution_steps WHERE turn_id = ? ORDER BY step_index ASC",
        [run!.turn_id],
      );
      expect(steps).toEqual([{ status: "cancelled" }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("backs off when advancing a paused approval but resumeTurn does not resume", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    await seedAgentConfig(container, {
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: {
          enabled: [],
          server_settings: { memory: { enabled: false } },
        },
        tools: { allow: ["bash"] },
        conversations: { ttl_days: 30, max_turns: 20 },
      },
    });

    const policyService = {
      isEnabled: () => false,
      isObserveOnly: () => false,
      evaluateToolCall: vi.fn(async () => ({
        decision: "require_approval",
        applied_override_ids: [],
      })),
    };

    const usage = () => ({
      inputTokens: {
        total: 10,
        noCache: 10,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: 5,
        text: 5,
        reasoning: undefined,
      },
    });

    let callCount = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: [
              {
                type: "tool-call" as const,
                toolCallId: "tc-1",
                toolName: "bash",
                input: JSON.stringify({ command: "echo hi" }),
              },
            ],
            finishReason: { unified: "tool-calls" as const, raw: undefined },
            usage: usage(),
            warnings: [],
          };
        }

        return {
          content: [{ type: "text" as const, text: "done" }],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: usage(),
          warnings: [],
        };
      },
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: model,
      fetchImpl: fetch404,
      turnEngineWaitMs: 350,
      policyService: policyService as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["policyService"],
    } as ConstructorParameters<typeof AgentRuntime>[0]);

    const engine = (runtime as unknown as { executionEngine: ExecutionEngine }).executionEngine;
    const resumeSpy = vi.fn(async () => undefined as string | undefined);
    engine.resumeTurn = resumeSpy;

    const turnPromise = runtime
      .turn({
        channel: "test",
        thread_id: "thread-1",
        message: "run tool",
      })
      .catch((err) => err as unknown);

    const deadlineMs = Date.now() + 2_000;
    let approvalId: string | undefined;
    while (Date.now() < deadlineMs) {
      const pending = await container.approvalDal.getPending({ tenantId: DEFAULT_TENANT_ID });
      if (pending.length > 0) {
        approvalId = pending[0]!.approval_id;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    if (!approvalId) {
      throw new Error("timed out waiting for pending approval");
    }

    await container.approvalDal.respond({
      tenantId: DEFAULT_TENANT_ID,
      approvalId,
      decision: "approved",
    });

    const result = await turnPromise;
    expect(result).toBeInstanceOf(Error);
    expect(resumeSpy.mock.calls.length).toBeLessThanOrEqual(12);
  }, 10_000);

  it("enforces the engine deadline against slow model calls", async () => {
    let aborted = false;

    const model: LanguageModelV3 = {
      specificationVersion: "v3",
      provider: "test",
      modelId: "slow",
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
        options: LanguageModelV3CallOptions,
      ): Promise<LanguageModelV3GenerateResult> {
        return await new Promise<LanguageModelV3GenerateResult>((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve({
              content: [{ type: "text" as const, text: "late" }],
              finishReason: { unified: "stop" as const, raw: undefined },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 1, text: 1, reasoning: undefined },
              },
              warnings: [],
            });
          }, 100);

          const anyOptions = options as unknown as LanguageModelV3CallOptions & {
            signal?: AbortSignal;
          };
          const abortSignal = anyOptions.abortSignal ?? anyOptions.signal;
          if (abortSignal?.aborted) {
            aborted = true;
            clearTimeout(timer);
            reject(new Error("timed out"));
            return;
          }
          abortSignal?.addEventListener(
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
      turnEngineWaitMs: 50,
    } as ConstructorParameters<typeof AgentRuntime>[0]);

    await expect(
      runtime.turn({
        channel: "test",
        thread_id: "thread-1",
        message: "hello",
      }),
    ).rejects.toThrow(/did not complete|timed out/i);

    expect(aborted).toBe(true);
  });
});
