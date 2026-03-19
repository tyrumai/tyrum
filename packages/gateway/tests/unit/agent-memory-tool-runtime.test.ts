import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { BuiltinMemoryServerSettings } from "@tyrum/contracts";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { MemoryDal } from "../../src/modules/memory/memory-dal.js";
import { AgentMemoryToolRuntime } from "../../src/modules/memory/agent-tool-runtime.js";
import { DEFAULT_AGENT_ID, DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

function buildMemoryConfig() {
  return BuiltinMemoryServerSettings.parse({});
}

function embedDeterministic(text: string): number[] {
  const haystack = text.toLowerCase();
  return [
    haystack.includes("pizza") ? 1 : 0,
    haystack.includes("hiking") || haystack.includes("mountains") ? 1 : 0,
    haystack.includes("procedure") ? 1 : 0,
  ];
}

describe("AgentMemoryToolRuntime", () => {
  const db = openTestSqliteDb();
  const dal = new MemoryDal(db);
  const config = buildMemoryConfig();

  afterEach(async () => {
    await db.run("DELETE FROM memory_item_embeddings");
    await db.run("DELETE FROM vector_metadata");
    await db.run("DELETE FROM memory_items");
    await db.run("DELETE FROM memory_tombstones");
  });

  afterAll(async () => {
    await db.close();
  });

  it("adds note memory with tool provenance and semantic indexing", async () => {
    const consolidateSpy = vi.spyOn(dal, "consolidateToBudgets");
    const budgetsProvider = vi.fn(async () => config.budgets);
    const runtime = new AgentMemoryToolRuntime({
      db,
      dal,
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      sessionId: "session-1",
      channel: "test",
      threadId: "thread-1",
      config,
      budgetsProvider,
      resolveEmbeddingPipeline: async () => ({
        embed: async (text: string) => embedDeterministic(text),
      }),
    });

    const result = await runtime.add(
      {
        kind: "note",
        title: "Food prefs",
        body_md: "I like pizza for lunch.",
        tags: ["prefs"],
      },
      "tool-call-1",
    );

    expect(result["semantic_indexed"]).toBe(true);
    expect(budgetsProvider).toHaveBeenCalledTimes(1);
    expect(consolidateSpy).toHaveBeenCalledTimes(1);

    const item = result["item"] as { provenance: Record<string, unknown>; memory_item_id: string };
    expect(item.provenance).toEqual(
      expect.objectContaining({
        source_kind: "tool",
        channel: "test",
        thread_id: "thread-1",
        session_id: "session-1",
        tool_call_id: "tool-call-1",
      }),
    );

    const search = await runtime.search({ query: "pizza", limit: 5 });
    expect(search["semantic_available"]).toBe(true);
    expect(search["semantic_fallback_used"]).toBe(false);
    expect(search["hits"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memory_item_id: item.memory_item_id,
          kind: "note",
        }),
      ]),
    );
  });

  it("falls back to keyword search when embeddings are unavailable", async () => {
    await dal.create(
      {
        kind: "note",
        title: "Fallback note",
        body_md: "Remember the pizza order.",
        tags: ["prefs"],
        sensitivity: "private",
        provenance: { source_kind: "user", refs: [] },
      },
      { tenantId: DEFAULT_TENANT_ID, agentId: DEFAULT_AGENT_ID },
    );

    const runtime = new AgentMemoryToolRuntime({
      db,
      dal,
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      sessionId: "session-2",
      channel: "test",
      threadId: "thread-2",
      config,
      budgetsProvider: async () => config.budgets,
      resolveEmbeddingPipeline: async () => undefined,
    });

    const result = await runtime.search({ query: "pizza", limit: 5 });
    expect(result["semantic_available"]).toBe(false);
    expect(result["semantic_fallback_used"]).toBe(true);
    expect(result["hits"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "note",
          preview: expect.stringContaining("pizza"),
        }),
      ]),
    );
  });

  it("matches fact keys when the query includes punctuation", async () => {
    await dal.create(
      {
        kind: "fact",
        key: "user_name",
        value: "Ron",
        observed_at: "2026-03-14T00:00:00.000Z",
        confidence: 0.99,
        tags: ["identity", "user"],
        sensitivity: "private",
        provenance: { source_kind: "user", refs: [] },
      },
      { tenantId: DEFAULT_TENANT_ID, agentId: DEFAULT_AGENT_ID },
    );

    const runtime = new AgentMemoryToolRuntime({
      db,
      dal,
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      sessionId: "session-3",
      channel: "test",
      threadId: "thread-3",
      config,
      budgetsProvider: async () => config.budgets,
      resolveEmbeddingPipeline: async () => undefined,
    });

    const result = await runtime.search({ query: "Do you know my name?", limit: 5 });
    expect(result["hits"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "fact",
          key: "user_name",
          preview: expect.stringContaining("Ron"),
        }),
      ]),
    );
  });
});
