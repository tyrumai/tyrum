import { describe, expect, it, vi } from "vitest";
import {
  shouldCompact,
  buildCompactionPrompt,
  compactSession,
} from "../../src/modules/agent/compaction.js";
import { SessionDal } from "../../src/modules/agent/session-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SessionMessage } from "../../src/modules/agent/session-dal.js";

function makeTurns(count: number): SessionMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `Message ${i + 1}`,
    timestamp: new Date(Date.now() + i * 1000).toISOString(),
  }));
}

const defaultConfig = { enabled: true, preserve_recent: 6, trigger_message_count: 20 };

describe("shouldCompact", () => {
  it("returns false below threshold", () => {
    expect(shouldCompact(makeTurns(10), defaultConfig)).toBe(false);
  });

  it("returns true at threshold", () => {
    expect(shouldCompact(makeTurns(20), defaultConfig)).toBe(true);
  });

  it("returns false when disabled", () => {
    expect(shouldCompact(makeTurns(30), { ...defaultConfig, enabled: false })).toBe(false);
  });
});

describe("buildCompactionPrompt", () => {
  it("preserves recent messages and compacts older ones", () => {
    const turns = makeTurns(10);
    const { olderTurns, recentTurns, prompt } = buildCompactionPrompt(turns, 4, "");
    expect(olderTurns).toHaveLength(6);
    expect(recentTurns).toHaveLength(4);
    expect(prompt).toContain("Message 1");
    expect(prompt).not.toContain("Message 10");
  });

  it("includes previous summary when provided", () => {
    const turns = makeTurns(6);
    const { prompt } = buildCompactionPrompt(turns, 2, "User prefers dark mode.");
    expect(prompt).toContain("Previous session summary:");
    expect(prompt).toContain("User prefers dark mode.");
  });
});

describe("compactSession", () => {
  it("calls generateFn with correct prompt and returns summary + recent", async () => {
    const generateFn = vi.fn().mockResolvedValue({ text: "Compacted summary." });
    const turns = makeTurns(20);

    const result = await compactSession({
      turns,
      previousSummary: "",
      config: defaultConfig,
      generateFn,
    });

    expect(generateFn).toHaveBeenCalledOnce();
    const callArgs = generateFn.mock.calls[0]![0]!;
    expect(callArgs.system).toContain("compaction assistant");
    expect(callArgs.prompt).toContain("Message 1");
    expect(result.summary).toBe("Compacted summary.");
    expect(result.remainingTurns).toHaveLength(6);
  });

  it("calls flushMemory before generating summary", async () => {
    const callOrder: string[] = [];
    const flushMemory = vi.fn().mockImplementation(async () => {
      callOrder.push("flush");
    });
    const generateFn = vi.fn().mockImplementation(async () => {
      callOrder.push("generate");
      return { text: "Summary." };
    });

    await compactSession({
      turns: makeTurns(20),
      previousSummary: "",
      config: defaultConfig,
      generateFn,
      flushMemory,
    });

    expect(flushMemory).toHaveBeenCalledOnce();
    expect(callOrder).toEqual(["flush", "generate"]);
  });
});

describe("SessionDal.updateCompaction", () => {
  it("persists compacted summary and increments count", async () => {
    const db = openTestSqliteDb();
    const dal = new SessionDal(db);

    const session = await dal.getOrCreate("test-chan", "thread-1");
    const nowIso = new Date().toISOString();
    await dal.appendTurn(session.session_id, "hello", "hi there", 100, nowIso);

    await dal.updateCompaction(session.session_id, "Compacted.", [
      { role: "user", content: "recent", timestamp: nowIso },
    ]);

    const updated = await dal.getById(session.session_id);
    expect(updated).toBeDefined();
    expect(updated!.compacted_summary).toBe("Compacted.");
    expect(updated!.compaction_count).toBe(1);
    expect(updated!.turns).toHaveLength(1);
    expect(updated!.turns[0]!.content).toBe("recent");

    // Second compaction increments count
    await dal.updateCompaction(session.session_id, "Second compaction.", []);
    const second = await dal.getById(session.session_id);
    expect(second!.compaction_count).toBe(2);
  });
});
