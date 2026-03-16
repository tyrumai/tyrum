import { afterEach, describe, expect, it } from "vitest";
import type { GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { createPromptAwareLanguageModel, promptIncludes } from "./agent-behavior.test-support.js";
import {
  compactSessionForTest,
  makeMemoryConfig,
  memorySection,
  noteDecision,
} from "./agent-behavior-memory.test-support.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  fetch404,
  restartFileBackedContainer,
  seedAgentConfig,
  setupFileBackedTestEnv,
  setupTestEnv,
  teardownTestEnv,
} from "./agent-runtime.test-helpers.js";

describe("Agent behavior - memory continuity", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;
  let dbPath: string | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
    dbPath = undefined;
  });

  it("recalls a remembered name in the same session with durable provenance", async () => {
    ({ homeDir, container } = await setupTestEnv());
    await seedAgentConfig(container, { config: makeMemoryConfig() });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createPromptAwareLanguageModel(
        ({ promptText }) => {
          if (promptIncludes(promptText, "what is my name")) {
            return /my name is ron/iu.test(memorySection(promptText)) ? "Ron" : "UNKNOWN";
          }
          return "Stored.";
        },
        {
          memoryDecision: ({ latestUserText }) =>
            promptIncludes(latestUserText, "remember that my name is ron")
              ? noteDecision("remember that my name is Ron")
              : undefined,
        },
      ),
      fetchImpl: fetch404,
    });

    const remembered = await runtime.turn({
      channel: "ui",
      thread_id: "memory-name-thread",
      message: "remember that my name is Ron",
    });
    const recalled = await runtime.turn({
      channel: "ui",
      thread_id: "memory-name-thread",
      message: "what is my name?",
    });

    expect(remembered.memory_written).toBe(true);
    expect(recalled.reply).toBe("Ron");

    const notes = await container.memoryDal.list({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
    });
    expect(notes.items).toHaveLength(1);
    expect(notes.items[0]).toMatchObject({
      kind: "note",
      provenance: {
        source_kind: "tool",
        channel: "ui",
        thread_id: "memory-name-thread",
        session_id: remembered.session_id,
      },
    });
    expect(notes.items[0]?.kind === "note" ? notes.items[0].body_md : "").toContain(
      "my name is Ron",
    );
  });

  it("recalls a remembered name after a runtime restart", async () => {
    ({ homeDir, container, dbPath } = await setupFileBackedTestEnv());
    await seedAgentConfig(container, { config: makeMemoryConfig() });

    let runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createPromptAwareLanguageModel(
        ({ promptText }) => {
          if (promptIncludes(promptText, "what is my name")) {
            return /my name is ron/iu.test(memorySection(promptText)) ? "Ron" : "UNKNOWN";
          }
          return "Stored.";
        },
        {
          memoryDecision: ({ latestUserText }) =>
            promptIncludes(latestUserText, "remember that my name is ron")
              ? noteDecision("remember that my name is Ron")
              : undefined,
        },
      ),
      fetchImpl: fetch404,
    });

    await runtime.turn({
      channel: "ui",
      thread_id: "restart-memory-thread",
      message: "remember that my name is Ron",
    });

    container = await restartFileBackedContainer({ homeDir, dbPath, container });
    runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createPromptAwareLanguageModel(
        ({ promptText }) => {
          if (promptIncludes(promptText, "what is my name")) {
            return /my name is ron/iu.test(memorySection(promptText)) ? "Ron" : "UNKNOWN";
          }
          return "Stored.";
        },
        {
          memoryDecision: ({ latestUserText }) =>
            promptIncludes(latestUserText, "remember that my name is ron")
              ? noteDecision("remember that my name is Ron")
              : undefined,
        },
      ),
      fetchImpl: fetch404,
    });

    const recalled = await runtime.turn({
      channel: "ui",
      thread_id: "restart-memory-thread",
      message: "what is my name?",
    });

    expect(recalled.reply).toBe("Ron");
  });

  it("recalls a preference across channels from agent-scoped memory", async () => {
    ({ homeDir, container } = await setupTestEnv());
    await seedAgentConfig(container, { config: makeMemoryConfig() });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createPromptAwareLanguageModel(
        ({ promptText }) => {
          if (promptIncludes(promptText, "which tea should you pick")) {
            return /i prefer tea/iu.test(memorySection(promptText)) ? "tea" : "UNKNOWN";
          }
          return "Stored.";
        },
        {
          memoryDecision: ({ latestUserText }) =>
            promptIncludes(latestUserText, "remember that i prefer tea")
              ? noteDecision("remember that I prefer tea")
              : undefined,
        },
      ),
      fetchImpl: fetch404,
    });

    await runtime.turn({
      channel: "ui",
      thread_id: "pref-ui-thread",
      message: "remember that I prefer tea",
    });
    const recalled = await runtime.turn({
      channel: "telegram",
      thread_id: "pref-telegram-thread",
      message: "Which tea should you pick?",
    });

    expect(recalled.reply).toBe("tea");

    const items = await container.memoryDal.list({});
    const original = items.items.find(
      (item) =>
        item.kind === "note" &&
        item.provenance.channel === "ui" &&
        item.provenance.thread_id === "pref-ui-thread",
    );
    expect(original).toMatchObject({
      kind: "note",
      provenance: {
        source_kind: "tool",
        channel: "ui",
        thread_id: "pref-ui-thread",
      },
    });
  });

  it("keeps durable preferences recallable after session compaction", async () => {
    ({ homeDir, container } = await setupTestEnv());
    await seedAgentConfig(container, { config: makeMemoryConfig({ maxTurns: 6 }) });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createPromptAwareLanguageModel(
        ({ promptText }) => {
          if (promptIncludes(promptText, "which tea should you choose for me")) {
            return /jasmine tea/iu.test(memorySection(promptText)) ? "jasmine tea" : "UNKNOWN";
          }
          return "ok";
        },
        {
          memoryDecision: ({ latestUserText }) =>
            promptIncludes(latestUserText, "remember that i prefer jasmine tea")
              ? noteDecision("remember that I prefer jasmine tea")
              : undefined,
        },
      ),
      fetchImpl: fetch404,
    });

    const first = await runtime.turn({
      channel: "ui",
      thread_id: "compact-thread",
      message: "remember that I prefer jasmine tea",
    });

    for (let index = 0; index < 8; index += 1) {
      await runtime.turn({
        channel: "ui",
        thread_id: "compact-thread",
        message: `filler turn ${String(index)}`,
      });
    }

    const compactCounts = await compactSessionForTest(runtime, {
      sessionId: first.session_id,
      keepLastMessages: 2,
    });
    expect(compactCounts.droppedMessages).toBeGreaterThan(0);
    const compactedSession = await container.sessionDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      sessionId: first.session_id,
    });
    expect(compactedSession?.context_state.checkpoint?.handoff_md ?? "").not.toBe("");

    const recalled = await runtime.turn({
      channel: "telegram",
      thread_id: "compact-cross-channel",
      message: "Which tea should you choose for me?",
    });

    expect(recalled.reply).toBe("jasmine tea");
  });
});
