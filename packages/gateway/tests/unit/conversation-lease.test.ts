import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { releaseConversationLease } from "../../src/modules/conversation-queue/conversation-lease.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("releaseConversationLease", () => {
  let db: SqliteDb;
  let didOpenDb = false;

  beforeEach(() => {
    didOpenDb = false;
    db = openTestSqliteDb();
    didOpenDb = true;
  });

  afterEach(async () => {
    if (!didOpenDb) return;
    didOpenDb = false;
    await db.close();
  });

  it("clears conversation_queue_signals when a lease is released", async () => {
    await db.run(
      `INSERT INTO conversation_leases (tenant_id, conversation_key, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "key-1", "worker-1", 60_000],
    );
    await db.run(
      `INSERT INTO conversation_queue_signals (tenant_id, conversation_key, kind, inbox_id, queue_mode, message_text, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "key-1", "interrupt", 1, "interrupt", "stop", 1_000],
    );

    await releaseConversationLease(db, { key: "key-1", owner: "worker-1" });

    const lease = await db.get<{ key: string }>(
      "SELECT conversation_key AS key FROM conversation_leases WHERE tenant_id = ? AND conversation_key = ?",
      [DEFAULT_TENANT_ID, "key-1"],
    );
    expect(lease).toBeUndefined();

    const signal = await db.get<{ key: string }>(
      "SELECT conversation_key AS key FROM conversation_queue_signals WHERE tenant_id = ? AND conversation_key = ?",
      [DEFAULT_TENANT_ID, "key-1"],
    );
    expect(signal).toBeUndefined();
  });

  it("preserves conversation_queue_signals when the lease owner does not match", async () => {
    await db.run(
      `INSERT INTO conversation_leases (tenant_id, conversation_key, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "key-1", "worker-1", 60_000],
    );
    await db.run(
      `INSERT INTO conversation_queue_signals (tenant_id, conversation_key, kind, inbox_id, queue_mode, message_text, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "key-1", "interrupt", 1, "interrupt", "stop", 1_000],
    );

    await releaseConversationLease(db, { key: "key-1", owner: "worker-2" });

    const lease = await db.get<{ key: string }>(
      "SELECT conversation_key AS key FROM conversation_leases WHERE tenant_id = ? AND conversation_key = ?",
      [DEFAULT_TENANT_ID, "key-1"],
    );
    expect(lease?.key).toBe("key-1");

    const signal = await db.get<{ key: string }>(
      "SELECT conversation_key AS key FROM conversation_queue_signals WHERE tenant_id = ? AND conversation_key = ?",
      [DEFAULT_TENANT_ID, "key-1"],
    );
    expect(signal?.key).toBe("key-1");
  });
});
