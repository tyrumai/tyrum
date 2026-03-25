import { afterEach, describe, expect, it } from "vitest";
import type { GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { createPromptAwareLanguageModel, promptIncludes } from "./agent-behavior.test-support.js";
import type { MemoryBudgets } from "./agent-behavior-memory.test-support.js";
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

describe("Agent behavior - memory compaction", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;
  let dbPath: string | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
    dbPath = undefined;
  });

  it("prefers the corrected memory after compaction, restart, and cross-channel recall", async () => {
    ({ homeDir, container, dbPath } = await setupFileBackedTestEnv());
    await seedAgentConfig(container, { config: makeMemoryConfig({ maxTurns: 6 }) });

    let capturedMemoryDigest = "";
    const createRuntime = (currentContainer: GatewayContainer) =>
      new AgentRuntime({
        container: currentContainer,
        home: homeDir,
        languageModel: createPromptAwareLanguageModel(
          ({ promptText }) => {
            if (promptIncludes(promptText, "what is my name now")) {
              capturedMemoryDigest = memorySection(promptText);
              if (/my name is robert/iu.test(capturedMemoryDigest)) {
                return "Robert";
              }
              if (/my name is ron/iu.test(capturedMemoryDigest)) {
                return "Ron";
              }
              return "UNKNOWN";
            }
            return "Stored.";
          },
          {
            allowRepeatedMemoryDecisions: true,
            memoryDecision: ({ latestUserText }) => {
              if (promptIncludes(latestUserText, "remember that my name is robert")) {
                return noteDecision("remember that my name is Robert");
              }
              if (promptIncludes(latestUserText, "remember that my name is ron")) {
                return noteDecision("remember that my name is Ron");
              }
              return undefined;
            },
          },
        ),
        fetchImpl: fetch404,
      });

    let runtime = createRuntime(container);
    const original = await runtime.turn({
      channel: "ui",
      thread_id: "correction-thread",
      message: "remember that my name is Ron",
    });
    await runtime.turn({
      channel: "ui",
      thread_id: "correction-thread",
      message: "remember that my name is Robert",
    });

    expect(original.memory_written).toBe(true);

    for (let index = 0; index < 8; index += 1) {
      await runtime.turn({
        channel: "ui",
        thread_id: "correction-thread",
        message: `filler correction turn ${String(index)}`,
      });
    }

    const compacted = await compactSessionForTest(runtime, {
      sessionId: original.conversation_id,
      keepLastMessages: 2,
    });
    expect(compacted.droppedMessages).toBeGreaterThan(0);

    container = await restartFileBackedContainer({ homeDir, dbPath, container });
    runtime = createRuntime(container);

    const recalled = await runtime.turn({
      channel: "telegram",
      thread_id: "correction-cross-channel",
      message: "what is my name now?",
    });

    expect(recalled.reply).toBe("Robert");
    expect(capturedMemoryDigest).toContain("my name is Robert");
    expect(capturedMemoryDigest).toContain("my name is Ron");
    expect(capturedMemoryDigest.indexOf("my name is Robert")).toBeLessThan(
      capturedMemoryDigest.indexOf("my name is Ron"),
    );

    const items = await container.memoryDal.list({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
    });
    const nameNotes = items.items.filter(
      (item) => item.kind === "note" && /my name is (robert|ron)/iu.test(item.body_md),
    );
    expect(nameNotes.length).toBeGreaterThanOrEqual(2);
    expect(nameNotes[0]?.kind === "note" ? nameNotes[0].body_md : "").toContain(
      "my name is Robert",
    );
    expect(
      nameNotes.some((item) => item.kind === "note" && item.body_md.includes("my name is Ron")),
    ).toBe(true);
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

    const items = await container.memoryDal.list({});
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

    const fact = await container.memoryDal.create({
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
      await container.memoryDal.create({
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

    const consolidation = await container.memoryDal.consolidateToBudgets({
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
    expect(await container.memoryDal.getById(fact.memory_item_id)).toMatchObject({
      kind: "fact",
      key: "user.preferred_drink",
    });
    expect(recalled.reply).toBe("oolong tea");
  });
});
