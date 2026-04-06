import { afterEach, describe, expect, it } from "vitest";
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
import { simulateReadableStream } from "ai";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";

describe("AgentRuntime - turn timing and concurrency", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
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

      let runs: Array<{ turn_id: string; status: string; started_at: string | null }> = [];
      for (let i = 0; i < 20; i += 1) {
        runs = await container.db.all<{
          turn_id: string;
          status: string;
          started_at: string | null;
        }>(
          `SELECT turn_id AS turn_id, status, started_at
           FROM turns
           WHERE conversation_key = 'agent:default:test:default:channel:thread-1'
           ORDER BY rowid ASC`,
        );
        if (runs.length >= 2) break;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(runs.length).toBeGreaterThanOrEqual(2);

      expect(runs[1]!.status).toBe("queued");
      expect(runs[1]!.started_at).toBeNull();

      gate.resolve();

      const r1 = await p1;
      const r2 = await p2;

      expect(r1.reply).toBe("first");
      expect(r2.reply).toBe("second");

      const conversation = await container.conversationDal.getByKey({
        tenantId: DEFAULT_TENANT_ID,
        conversationKey: "agent:default:test:default:channel:thread-1",
      });
      expect(conversation).toBeTruthy();
      expect(
        conversation!.transcript
          .filter((item) => item.kind === "text")
          .map((item) => `${item.role}:${item.content}`),
      ).toEqual(["user:m1", "assistant:first", "user:m2", "assistant:second"]);
    } finally {
      gate.resolve();
      await Promise.allSettled([p1, p2]);
    }
  });
});
