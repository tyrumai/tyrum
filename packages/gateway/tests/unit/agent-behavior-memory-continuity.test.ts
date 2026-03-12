import { afterEach, describe, expect, it } from "vitest";
import type { GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import {
  createPromptAwareLanguageModel,
  extractPromptSection,
  promptIncludes,
} from "./agent-behavior.test-support.js";
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

type MemoryBudgets = {
  max_total_items: number;
  max_total_chars: number;
  per_kind: {
    fact: { max_items: number; max_chars: number };
    note: { max_items: number; max_chars: number };
    procedure: { max_items: number; max_chars: number };
    episode: { max_items: number; max_chars: number };
  };
};

function makeMemoryConfig(input?: {
  maxTurns?: number;
  structuredFactKeys?: string[];
  structuredTags?: string[];
  budgets?: MemoryBudgets;
}): Record<string, unknown> {
  return {
    model: { model: "openai/gpt-4.1" },
    skills: { enabled: [] },
    mcp: { enabled: [] },
    tools: { allow: [] },
    sessions: {
      ttl_days: 30,
      max_turns: input?.maxTurns ?? 20,
    },
    memory: {
      v1: {
        enabled: true,
        keyword: { enabled: true, limit: 20 },
        semantic: { enabled: false, limit: 1 },
        structured: {
          fact_keys: input?.structuredFactKeys ?? [],
          tags: input?.structuredTags ?? [],
        },
        auto_write: {
          enabled: true,
          classifier: "rule_based",
        },
        budgets: input?.budgets ?? {
          max_total_items: 10,
          max_total_chars: 4000,
          per_kind: {
            fact: { max_items: 4, max_chars: 1200 },
            note: { max_items: 6, max_chars: 2400 },
            procedure: { max_items: 2, max_chars: 1200 },
            episode: { max_items: 4, max_chars: 1600 },
          },
        },
      },
    },
  };
}

function memorySection(promptText: string): string {
  return extractPromptSection(promptText, "Memory digest:");
}

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
      languageModel: createPromptAwareLanguageModel(({ promptText }) => {
        if (promptIncludes(promptText, "what is my name")) {
          return /my name is ron/iu.test(memorySection(promptText)) ? "Ron" : "UNKNOWN";
        }
        return "Stored.";
      }),
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

    const notes = await container.memoryV1Dal.list({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
    });
    expect(notes.items).toHaveLength(1);
    expect(notes.items[0]).toMatchObject({
      kind: "note",
      provenance: {
        source_kind: "user",
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
      languageModel: createPromptAwareLanguageModel(({ promptText }) => {
        if (promptIncludes(promptText, "what is my name")) {
          return /my name is ron/iu.test(memorySection(promptText)) ? "Ron" : "UNKNOWN";
        }
        return "Stored.";
      }),
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
      languageModel: createPromptAwareLanguageModel(({ promptText }) => {
        if (promptIncludes(promptText, "what is my name")) {
          return /my name is ron/iu.test(memorySection(promptText)) ? "Ron" : "UNKNOWN";
        }
        return "Stored.";
      }),
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
      languageModel: createPromptAwareLanguageModel(({ promptText }) => {
        if (promptIncludes(promptText, "which tea should you pick")) {
          return /i prefer tea/iu.test(memorySection(promptText)) ? "tea" : "UNKNOWN";
        }
        return "Stored.";
      }),
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

    const items = await container.memoryV1Dal.list({});
    const original = items.items.find(
      (item) =>
        item.kind === "note" &&
        item.provenance.channel === "ui" &&
        item.provenance.thread_id === "pref-ui-thread",
    );
    expect(original).toMatchObject({
      kind: "note",
      provenance: {
        source_kind: "user",
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
      languageModel: createPromptAwareLanguageModel(({ promptText }) => {
        if (promptIncludes(promptText, "which tea should you choose for me")) {
          return /jasmine tea/iu.test(memorySection(promptText)) ? "jasmine tea" : "UNKNOWN";
        }
        return "ok";
      }),
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

    const compactCounts = await container.sessionDal.compact({
      tenantId: DEFAULT_TENANT_ID,
      sessionId: first.session_id,
      keepLastMessages: 2,
    });
    expect(compactCounts.droppedMessages).toBeGreaterThan(0);
    const compactedSession = await container.sessionDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      sessionId: first.session_id,
    });
    expect(compactedSession?.summary).not.toBe("");

    const recalled = await runtime.turn({
      channel: "telegram",
      thread_id: "compact-cross-channel",
      message: "Which tea should you choose for me?",
    });

    expect(recalled.reply).toBe("jasmine tea");
  });

  it("does not store secret-like content in durable memory", async () => {
    ({ homeDir, container } = await setupTestEnv());
    await seedAgentConfig(container, { config: makeMemoryConfig() });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createPromptAwareLanguageModel(({ promptText }) => {
        if (promptIncludes(promptText, "what is my api key")) {
          return /sk-1234567890abcdefghijklmnop/iu.test(memorySection(promptText))
            ? "sk-1234567890abcdefghijklmnop"
            : "UNKNOWN";
        }
        return "Noted.";
      }),
      fetchImpl: fetch404,
    });

    const remembered = await runtime.turn({
      channel: "ui",
      thread_id: "secret-thread",
      message: "remember that my api key is sk-1234567890abcdefghijklmnop",
    });
    const recalled = await runtime.turn({
      channel: "telegram",
      thread_id: "secret-cross-channel",
      message: "what is my api key?",
    });

    expect(remembered.memory_written).toBe(false);
    expect(recalled.reply).toBe("UNKNOWN");

    const items = await container.memoryV1Dal.list({});
    expect(items.items).toHaveLength(0);
  });

  it("preserves canonical facts while budget consolidation removes low-utility history", async () => {
    ({ homeDir, container } = await setupTestEnv());
    const constrainedBudgets: MemoryBudgets = {
      max_total_items: 3,
      max_total_chars: 420,
      per_kind: {
        fact: { max_items: 1, max_chars: 120 },
        note: { max_items: 2, max_chars: 200 },
        procedure: { max_items: 1, max_chars: 120 },
        episode: { max_items: 1, max_chars: 160 },
      },
    };
    await seedAgentConfig(container, {
      config: makeMemoryConfig({
        structuredFactKeys: ["user.preferred_drink"],
        budgets: constrainedBudgets,
      }),
    });

    const fact = await container.memoryV1Dal.create({
      kind: "fact",
      key: "user.preferred_drink",
      value: "oolong tea",
      observed_at: "2026-03-11T00:00:00.000Z",
      confidence: 0.99,
      tags: ["canonical"],
      sensitivity: "private",
      provenance: { source_kind: "user", refs: [] },
    });

    for (let index = 0; index < 6; index += 1) {
      await container.memoryV1Dal.create({
        kind: "episode",
        occurred_at: `2026-03-${String(10 - index).padStart(2, "0")}T00:00:00.000Z`,
        summary_md:
          `Long episodic note ${String(index)} about an unimportant transient detail ` +
          "that should be compacted away under pressure.",
        tags: ["noise"],
        sensitivity: "private",
        provenance: { source_kind: "system", refs: [] },
      });
    }

    const consolidation = await container.memoryV1Dal.consolidateToBudgets({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      budgets: constrainedBudgets,
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createPromptAwareLanguageModel(({ promptText }) => {
        if (promptIncludes(promptText, "what is my preferred drink")) {
          return /user\.preferred_drink/iu.test(memorySection(promptText)) &&
            /oolong tea/iu.test(memorySection(promptText))
            ? "oolong tea"
            : "UNKNOWN";
        }
        return "ok";
      }),
      fetchImpl: fetch404,
    });

    const recalled = await runtime.turn({
      channel: "ui",
      thread_id: "budget-thread",
      message: "what is my preferred drink?",
    });

    expect(consolidation.ran).toBe(true);
    expect(consolidation.deleted_tombstones.length).toBeGreaterThan(0);
    expect(await container.memoryV1Dal.getById(fact.memory_item_id)).toMatchObject({
      kind: "fact",
      key: "user.preferred_drink",
    });
    expect(recalled.reply).toBe("oolong tea");
  });
});
