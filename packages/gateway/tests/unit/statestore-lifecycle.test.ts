import { afterEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { StateStoreLifecycleScheduler } from "../../src/modules/statestore/lifecycle.js";

describe("StateStoreLifecycleScheduler", () => {
  let db: SqliteDb | undefined;
  const originalSessionsTtlDays = process.env["TYRUM_SESSIONS_TTL_DAYS"];

  afterEach(async () => {
    await db?.close();
    db = undefined;
    if (typeof originalSessionsTtlDays === "undefined") {
      delete process.env["TYRUM_SESSIONS_TTL_DAYS"];
    } else {
      process.env["TYRUM_SESSIONS_TTL_DAYS"] = originalSessionsTtlDays;
    }
  });

  it("prunes expired sessions and TTL-derived tables", async () => {
    process.env["TYRUM_SESSIONS_TTL_DAYS"] = "1";
    db = openTestSqliteDb();

    const now = new Date("2026-02-24T00:00:00.000Z");
    const nowMs = now.getTime();

    const expiredSessionUpdatedAt = "2026-02-22T23:59:59.000Z";
    const freshSessionUpdatedAt = "2026-02-23T00:00:01.000Z";

    await db.run(
      `INSERT INTO sessions (session_id, channel, thread_id, summary, turns_json, created_at, updated_at, workspace_id, agent_id)
       VALUES (?, ?, ?, '', '[]', ?, ?, 'default', 'default')`,
      ["session-expired", "telegram", "thread-1", now.toISOString(), expiredSessionUpdatedAt],
    );
    await db.run(
      `INSERT INTO sessions (session_id, channel, thread_id, summary, turns_json, created_at, updated_at, workspace_id, agent_id)
       VALUES (?, ?, ?, '', '[]', ?, ?, 'default', 'default')`,
      ["session-fresh", "telegram", "thread-2", now.toISOString(), freshSessionUpdatedAt],
    );

    await db.run(
      `INSERT INTO auth_profiles (profile_id, agent_id, provider, type)
       VALUES (?, 'default', ?, ?)`,
      ["profile-1", "openai", "api_key"],
    );
    await db.run(
      `INSERT INTO session_provider_pins (agent_id, session_id, provider, profile_id)
       VALUES ('default', ?, 'openai', 'profile-1')`,
      ["session-expired"],
    );

    await db.run(
      `INSERT INTO context_reports (context_report_id, session_id, channel, thread_id, report_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["cr-1", "session-expired", "telegram", "thread-1", "{}", now.toISOString()],
    );

    await db.run(
      `INSERT INTO presence_entries (instance_id, role, connected_at_ms, last_seen_at_ms, expires_at_ms)
       VALUES (?, 'client', ?, ?, ?)`,
      ["presence-expired", nowMs - 10_000, nowMs - 10_000, nowMs - 1],
    );
    await db.run(
      `INSERT INTO presence_entries (instance_id, role, connected_at_ms, last_seen_at_ms, expires_at_ms)
       VALUES (?, 'client', ?, ?, ?)`,
      ["presence-fresh", nowMs - 10_000, nowMs - 10_000, nowMs + 60_000],
    );

    await db.run(
      `INSERT INTO connection_directory (connection_id, edge_id, connected_at_ms, last_seen_at_ms, expires_at_ms)
       VALUES (?, 'edge-1', ?, ?, ?)`,
      ["conn-expired", nowMs - 10_000, nowMs - 10_000, nowMs - 1],
    );
    await db.run(
      `INSERT INTO connection_directory (connection_id, edge_id, connected_at_ms, last_seen_at_ms, expires_at_ms)
       VALUES (?, 'edge-1', ?, ?, ?)`,
      ["conn-fresh", nowMs - 10_000, nowMs - 10_000, nowMs + 60_000],
    );

    await db.run(
      `INSERT INTO channel_inbound_dedupe (channel, account_id, container_id, message_id, inbox_id, expires_at_ms)
       VALUES ('telegram', 'default', 'thread-1', ?, NULL, ?)`,
      ["msg-expired", nowMs - 1],
    );
    await db.run(
      `INSERT INTO channel_inbound_dedupe (channel, account_id, container_id, message_id, inbox_id, expires_at_ms)
       VALUES ('telegram', 'default', 'thread-1', ?, NULL, ?)`,
      ["msg-fresh", nowMs + 60_000],
    );

    const scheduler = new StateStoreLifecycleScheduler({
      db,
      clock: () => ({ nowIso: now.toISOString(), nowMs }),
    });

    await scheduler.tick();

    const sessions = await db.all<{ session_id: string }>(
      "SELECT session_id FROM sessions ORDER BY session_id ASC",
    );
    expect(sessions).toEqual([{ session_id: "session-fresh" }]);

    const pins = await db.all<{ session_id: string }>(
      "SELECT session_id FROM session_provider_pins ORDER BY session_id ASC",
    );
    expect(pins).toEqual([]);

    const reports = await db.all<{ context_report_id: string }>(
      "SELECT context_report_id FROM context_reports ORDER BY context_report_id ASC",
    );
    expect(reports).toEqual([]);

    const presence = await db.all<{ instance_id: string }>(
      "SELECT instance_id FROM presence_entries ORDER BY instance_id ASC",
    );
    expect(presence).toEqual([{ instance_id: "presence-fresh" }]);

    const directory = await db.all<{ connection_id: string }>(
      "SELECT connection_id FROM connection_directory ORDER BY connection_id ASC",
    );
    expect(directory).toEqual([{ connection_id: "conn-fresh" }]);

    const dedupe = await db.all<{ message_id: string }>(
      "SELECT message_id FROM channel_inbound_dedupe ORDER BY message_id ASC",
    );
    expect(dedupe).toEqual([{ message_id: "msg-fresh" }]);
  });
});

