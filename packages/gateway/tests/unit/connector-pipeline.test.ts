import { afterEach, describe, expect, it } from "vitest";
import { ConnectorPipeline } from "../../src/modules/connector/pipeline.js";
import type { NormalizedMessage } from "../../src/modules/connector/pipeline.js";
import { DedupeDal } from "../../src/modules/connector/dedupe-dal.js";
import { PolicyBundleManager } from "../../src/modules/policy/bundle.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("ConnectorPipeline", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  function createPipeline(
    opts?: { debounceDurationMs?: number },
  ): ConnectorPipeline {
    db = openTestSqliteDb();
    const dedupeDal = new DedupeDal(db);
    return new ConnectorPipeline({
      dedupeDal,
      debounceDurationMs: opts?.debounceDurationMs,
    });
  }

  function makeMessage(overrides?: Partial<NormalizedMessage>): NormalizedMessage {
    return {
      message_id: "msg-1",
      channel: "telegram",
      thread_id: "thread-1",
      text: "hello",
      ...overrides,
    };
  }

  it("passes through non-duplicate messages", async () => {
    const pipeline = createPipeline();
    const msg = makeMessage();
    const result = await pipeline.ingest(msg);
    expect(result).toEqual(msg);
  });

  it("filters duplicate messages", async () => {
    const pipeline = createPipeline();
    const msg = makeMessage();
    await pipeline.ingest(msg);
    const result = await pipeline.ingest(msg);
    expect(result).toBeNull();
  });

  it("allows same message_id on different channels", async () => {
    const pipeline = createPipeline();
    const msg1 = makeMessage({ channel: "telegram" });
    const msg2 = makeMessage({ channel: "discord" });

    const r1 = await pipeline.ingest(msg1);
    const r2 = await pipeline.ingest(msg2);

    expect(r1).toEqual(msg1);
    expect(r2).toEqual(msg2);
  });

  it("cleanup delegates to DedupeDal", async () => {
    const pipeline = createPipeline();

    // Ingest a message with short TTL
    await pipeline.ingest(makeMessage({ message_id: "msg-short" }));

    // Nothing should be cleaned yet (TTL is 1 hour by default)
    const cleaned = await pipeline.cleanup();
    expect(cleaned).toBe(0);
  });

  it("debounce returns only the latest message per thread", async () => {
    const pipeline = createPipeline({ debounceDurationMs: 50 });

    const msg1 = makeMessage({ message_id: "msg-1", text: "first" });
    const msg2 = makeMessage({ message_id: "msg-2", text: "second" });

    const p1 = pipeline.ingest(msg1);
    const p2 = pipeline.ingest(msg2);

    const [r1, r2] = await Promise.all([p1, p2]);

    // First promise should resolve to null (superseded by second)
    expect(r1).toBeNull();
    // Second promise should resolve to the second message
    expect(r2).toEqual(msg2);
  });

  // -----------------------------------------------------------------------
  // Policy gate
  // -----------------------------------------------------------------------

  it("rejects messages when policy denies messaging domain", async () => {
    db = openTestSqliteDb();
    const dedupeDal = new DedupeDal(db);
    const policyBundleManager = new PolicyBundleManager();
    policyBundleManager.addBundle({
      rules: [{ domain: "messaging", action: "deny", priority: 1, description: "blocked" }],
      precedence: "deployment",
    });
    const pipeline = new ConnectorPipeline({ dedupeDal, policyBundleManager });

    const msg = makeMessage();
    const result = await pipeline.ingest(msg);
    expect(result).toBeNull();
  });

  it("allows messages when policy allows messaging domain", async () => {
    db = openTestSqliteDb();
    const dedupeDal = new DedupeDal(db);
    const policyBundleManager = new PolicyBundleManager();
    policyBundleManager.addBundle({
      rules: [{ domain: "messaging", action: "allow", priority: 1 }],
      precedence: "deployment",
    });
    const pipeline = new ConnectorPipeline({ dedupeDal, policyBundleManager });

    const msg = makeMessage();
    const result = await pipeline.ingest(msg);
    expect(result).toEqual(msg);
  });
});
