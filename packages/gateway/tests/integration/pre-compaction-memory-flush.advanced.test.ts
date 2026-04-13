import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { MockLanguageModelV3 } from "ai/test";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { maybeRunPreCompactionMemoryFlush } from "../../src/modules/agent/runtime/pre-compaction-memory-flush.js";
import { prepareTurn } from "../../src/modules/agent/runtime/turn-preparation.js";
import { MemoryDal } from "../../src/modules/memory/memory-dal.js";
import {
  createMemoryToolDescriptors,
  createMemoryWriteToolStep,
  createMockMcpManager,
  createSequencedGenerateLanguageModel,
  findFlushSystemText,
  listNonTitleGenerateCalls,
  seedAgentConfig,
  usage,
} from "./pre-compaction-memory-flush.test-support.js";

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

    const languageModel = createSequencedGenerateLanguageModel([
      createMemoryWriteToolStep({
        kind: "note",
        body_md: "FLUSH_OK",
      }),
      "",
    ]);
    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      mcpManager: createMockMcpManager() as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    const conversation = await container.conversationDal.getOrCreate({
      connectorKey: "test",
      providerThreadId: "thread-idempotent",
      containerKind: "channel",
    });
    await container.conversationDal.appendTurn({
      tenantId: conversation.tenant_id,
      conversationId: conversation.conversation_id,
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
        {
          logger: container.logger,
          prepareTurnDeps: (runtime as any).prepareTurnDeps,
          channel: "test",
          threadId: "thread-idempotent",
        },
        {
          ctx: prepared.ctx,
          conversation: prepared.conversation,
          model: prepared.model,
          droppedMessages: prepared.conversation.messages,
        },
      );

    await flush();
    expect(listNonTitleGenerateCalls(languageModel)).toHaveLength(2);
    const memory = new MemoryDal(container.db);
    const firstList = await memory.list({ tenantId, agentId, limit: 50 });
    expect(firstList.items).toHaveLength(1);
    expect(firstList.items[0]?.provenance.channel).toBe("test");
    expect(firstList.items[0]?.provenance.thread_id).toBe("thread-idempotent");

    await flush();
    expect(listNonTitleGenerateCalls(languageModel)).toHaveLength(2);
    const secondList = await memory.list({ tenantId, agentId, limit: 50 });
    expect(secondList.items).toHaveLength(1);
  });

  it("bounds pre-compaction flush timeout to a slice of the turn timeout", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-preflush-timeout-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    await seedAgentConfig(container, { maxTurns: 1 });

    const languageModel = new MockLanguageModelV3({
      doGenerate: async (options) => {
        if (
          JSON.stringify((options as { prompt?: unknown[] }).prompt ?? []).includes(
            "Write a concise conversation title.",
          )
        ) {
          return {
            content: [{ type: "text" as const, text: "Generated conversation title" }],
            finishReason: { unified: "stop" as const, raw: undefined },
            usage: usage(),
            warnings: [],
          };
        }
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

        return {
          content: [{ type: "text" as const, text: "" }],
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
    const conversation = await container.conversationDal.getOrCreate({
      connectorKey: "test",
      providerThreadId: "thread-timeout",
      containerKind: "channel",
    });
    await container.conversationDal.appendTurn({
      tenantId: conversation.tenant_id,
      conversationId: conversation.conversation_id,
      userMessage: "first",
      assistantMessage: "a1",
      timestamp: new Date().toISOString(),
    });

    const prepared = await prepareTurn((runtime as any).prepareTurnDeps, {
      channel: "test",
      thread_id: "thread-timeout",
      message: "second",
    });

    const startedAtMs = performance.now();
    await maybeRunPreCompactionMemoryFlush(
      {
        logger: container.logger,
        prepareTurnDeps: (runtime as any).prepareTurnDeps,
        channel: "test",
        threadId: "thread-timeout",
      },
      {
        ctx: prepared.ctx,
        conversation: prepared.conversation,
        model: prepared.model,
        droppedMessages: prepared.conversation.messages,
        timeoutMs: 100,
      },
    );
    const elapsedTimeMs = performance.now() - startedAtMs;

    expect(elapsedTimeMs).toBeLessThan(350);
  });

  it("uses a no-inference system prompt for pre-compaction memory flushes", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-preflush-system-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    await seedAgentConfig(container, { maxTurns: 1 });

    const languageModel = createSequencedGenerateLanguageModel([
      createMemoryWriteToolStep({
        kind: "note",
        body_md: "FLUSH_OK",
      }),
      "",
    ]);
    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      mcpManager: createMockMcpManager() as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    const conversation = await container.conversationDal.getOrCreate({
      connectorKey: "test",
      providerThreadId: "thread-system-prompt",
      containerKind: "channel",
    });
    await container.conversationDal.appendTurn({
      tenantId: conversation.tenant_id,
      conversationId: conversation.conversation_id,
      userMessage: "first",
      assistantMessage: "a1",
      timestamp: new Date().toISOString(),
    });

    const prepared = await prepareTurn((runtime as any).prepareTurnDeps, {
      channel: "test",
      thread_id: "thread-system-prompt",
      message: "second",
    });

    await maybeRunPreCompactionMemoryFlush(
      {
        logger: container.logger,
        prepareTurnDeps: (runtime as any).prepareTurnDeps,
        channel: "test",
        threadId: "thread-system-prompt",
      },
      {
        ctx: prepared.ctx,
        conversation: prepared.conversation,
        model: prepared.model,
        droppedMessages: prepared.conversation.messages,
      },
    );

    const systemText = findFlushSystemText(languageModel);
    expect(systemText).toContain("Use the available memory write tool");
    expect(systemText).toContain("Do not infer beyond the provided messages.");
  });

  it("resolves canonical pre_turn_tools against legacy memory descriptors during rollout", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-preflush-canonical-config-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    const { tenantId, agentId } = await seedAgentConfig(container, {
      maxTurns: 1,
      preTurnTools: ["memory.seed"],
    });

    const languageModel = createSequencedGenerateLanguageModel([
      createMemoryWriteToolStep(
        {
          kind: "note",
          body_md: "FLUSH_OK",
        },
        "mcp.memory.write",
      ),
      "",
    ]);
    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      mcpManager: createMockMcpManager() as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    const conversation = await container.conversationDal.getOrCreate({
      connectorKey: "test",
      providerThreadId: "thread-canonical-config",
      containerKind: "channel",
    });
    await container.conversationDal.appendTurn({
      tenantId: conversation.tenant_id,
      conversationId: conversation.conversation_id,
      userMessage: "first",
      assistantMessage: "a1",
      timestamp: new Date().toISOString(),
    });

    const prepared = await prepareTurn((runtime as any).prepareTurnDeps, {
      channel: "test",
      thread_id: "thread-canonical-config",
      message: "second",
    });

    await maybeRunPreCompactionMemoryFlush(
      {
        logger: container.logger,
        prepareTurnDeps: (runtime as any).prepareTurnDeps,
        channel: "test",
        threadId: "thread-canonical-config",
      },
      {
        ctx: prepared.ctx,
        conversation: prepared.conversation,
        model: prepared.model,
        droppedMessages: prepared.conversation.messages,
      },
    );

    expect(listNonTitleGenerateCalls(languageModel)).toHaveLength(2);
    const memory = new MemoryDal(container.db);
    const list = await memory.list({ tenantId, agentId, limit: 50 });
    expect(list.items).toHaveLength(1);
  });

  it("skips flush deterministically when the chosen memory server exposes ambiguous rollout-matching write tools", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-preflush-ambiguous-write-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    const { tenantId, agentId } = await seedAgentConfig(container, { maxTurns: 1 });

    const warnSpy = vi.spyOn(container.logger, "warn");
    const baseDescriptors = createMemoryToolDescriptors();
    const duplicateWriteTool = baseDescriptors.find((tool) => tool.memoryRole === "write");
    if (!duplicateWriteTool) {
      throw new Error("expected base memory descriptors to include a write tool");
    }
    const descriptors = createMemoryToolDescriptors({
      extraDescriptors: [
        {
          ...duplicateWriteTool,
          id: "memory.write",
        },
      ],
    });
    const languageModel = createSequencedGenerateLanguageModel([
      createMemoryWriteToolStep({
        kind: "note",
        body_md: "FLUSH_OK",
      }),
      "",
    ]);
    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      mcpManager: createMockMcpManager({ descriptors }) as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    const conversation = await container.conversationDal.getOrCreate({
      connectorKey: "test",
      providerThreadId: "thread-ambiguous-write",
      containerKind: "channel",
    });
    await container.conversationDal.appendTurn({
      tenantId: conversation.tenant_id,
      conversationId: conversation.conversation_id,
      userMessage: "first",
      assistantMessage: "a1",
      timestamp: new Date().toISOString(),
    });

    const prepared = await prepareTurn((runtime as any).prepareTurnDeps, {
      channel: "test",
      thread_id: "thread-ambiguous-write",
      message: "second",
    });

    await maybeRunPreCompactionMemoryFlush(
      {
        logger: container.logger,
        prepareTurnDeps: (runtime as any).prepareTurnDeps,
        channel: "test",
        threadId: "thread-ambiguous-write",
      },
      {
        ctx: prepared.ctx,
        conversation: prepared.conversation,
        model: prepared.model,
        droppedMessages: prepared.conversation.messages,
      },
    );

    expect(listNonTitleGenerateCalls(languageModel)).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      "memory.flush_skipped",
      expect.objectContaining({
        conversation_id: conversation.conversation_id,
        reason: "memory write tool unavailable or ambiguous",
      }),
    );
    const memory = new MemoryDal(container.db);
    const list = await memory.list({ tenantId, agentId, limit: 50 });
    expect(list.items).toHaveLength(0);
  });
});
