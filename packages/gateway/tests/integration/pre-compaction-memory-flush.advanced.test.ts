import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { MockLanguageModelV3 } from "ai/test";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { maybeRunPreCompactionMemoryFlush } from "../../src/modules/agent/runtime/pre-compaction-memory-flush.js";
import { turnDirect } from "../../src/modules/agent/runtime/turn-direct.js";
import { prepareTurn } from "../../src/modules/agent/runtime/turn-preparation.js";
import { MemoryDal } from "../../src/modules/memory/memory-dal.js";
import {
  checkpointJson,
  createMockMcpManager,
  createSequencedTextLanguageModel,
  listNonTitleGenerateCalls,
  seedAgentConfig,
  usage,
} from "./pre-compaction-memory-flush.test-support.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("Pre-compaction memory flush - advanced", () => {
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

  it("is idempotent for the same dropped messages (no duplicate flush calls)", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-preflush-idempotent-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    const { tenantId, agentId } = await seedAgentConfig(container, { maxTurns: 1 });

    const languageModel = createSequencedTextLanguageModel(["FLUSH_OK"]);
    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      mcpManager: createMockMcpManager() as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    const session = await container.sessionDal.getOrCreate({
      connectorKey: "test",
      providerThreadId: "thread-idempotent",
      containerKind: "channel",
    });
    await container.sessionDal.appendTurn({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      userMessage: "first",
      assistantMessage: "a1",
      timestamp: new Date().toISOString(),
    });

    const prepared = await prepareTurn((runtime as any).prepareTurnDeps, {
      channel: "test",
      thread_id: "thread-idempotent",
      message: "second",
    });

    const flush = async () =>
      maybeRunPreCompactionMemoryFlush(
        { db: container.db, logger: container.logger, agentId },
        {
          ctx: prepared.ctx,
          session: prepared.session,
          model: prepared.model,
          droppedMessages: prepared.session.messages,
        },
      );

    await flush();
    expect(listNonTitleGenerateCalls(languageModel)).toHaveLength(1);
    const memory = new MemoryDal(container.db);
    const firstList = await memory.list({ tenantId, agentId, limit: 50 });
    expect(firstList.items).toHaveLength(1);

    await flush();
    expect(listNonTitleGenerateCalls(languageModel)).toHaveLength(1);
    const secondList = await memory.list({ tenantId, agentId, limit: 50 });
    expect(secondList.items).toHaveLength(1);
  });

  it("bounds pre-compaction flush timeout to a slice of the turn timeout", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-preflush-timeout-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    await seedAgentConfig(container, { maxTurns: 1 });

    let callCount = 0;
    const languageModel = new MockLanguageModelV3({
      doGenerate: async (options) => {
        if (
          JSON.stringify((options as { prompt?: unknown[] }).prompt ?? []).includes(
            "Write a concise session title.",
          )
        ) {
          return {
            content: [{ type: "text" as const, text: "Generated session title" }],
            finishReason: { unified: "stop" as const, raw: undefined },
            usage: usage(),
            warnings: [],
          };
        }
        callCount += 1;

        if (callCount === 1) {
          return {
            content: [{ type: "text" as const, text: "a1" }],
            finishReason: { unified: "stop" as const, raw: undefined },
            usage: usage(),
            warnings: [],
          };
        }

        if (callCount === 2) {
          const signal = options.abortSignal;
          if (!signal) {
            throw new Error("expected abortSignal for pre-compaction flush call");
          }

          await new Promise((_, reject) => {
            if (signal.aborted) {
              reject(new Error("aborted"));
              return;
            }
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          });
        }

        if (callCount === 3) {
          return {
            content: [{ type: "text" as const, text: checkpointJson("summary: timeout") }],
            finishReason: { unified: "stop" as const, raw: undefined },
            usage: usage(),
            warnings: [],
          };
        }

        return {
          content: [{ type: "text" as const, text: "a2" }],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: usage(),
          warnings: [],
        };
      },
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      mcpManager: createMockMcpManager() as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    const first = await turnDirect(
      (runtime as any).turnDirectDeps,
      { channel: "test", thread_id: "thread-timeout", message: "first" },
      { timeoutMs: 1_000 },
    );
    expect(first.response.reply).toBe("a1");

    const startedAtMs = performance.now();
    const second = await turnDirect(
      (runtime as any).turnDirectDeps,
      { channel: "test", thread_id: "thread-timeout", message: "second" },
      { timeoutMs: 100 },
    );
    const elapsedTimeMs = performance.now() - startedAtMs;

    expect(second.response.reply).toBe("a2");
    expect(elapsedTimeMs).toBeLessThan(350);
  });
});
