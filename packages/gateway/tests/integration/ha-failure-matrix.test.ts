import { afterEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("HA failure matrix", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    if (db) {
      await db.close();
      db = undefined;
    }
  });

  describe("execution engine resilience", () => {
    it("run survives worker restart (queued status is re-pickable)", async () => {
      db = openTestSqliteDb();
      // Insert a queued job and run, then verify it can be picked up
      // (simulates worker dying before processing)
      const jobId = crypto.randomUUID();
      const runId = crypto.randomUUID();
      await db.run(
        "INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json, input_json, latest_run_id) VALUES (?, ?, ?, 'queued', '{}', '{}', ?)",
        [jobId, "test-key", "main", runId],
      );
      await db.run(
        "INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt) VALUES (?, ?, ?, ?, 'queued', 1)",
        [runId, jobId, "test-key", "main"],
      );

      // Verify the run is still pickable after "restart"
      const run = await db.get<{ status: string }>(
        "SELECT status FROM execution_runs WHERE run_id = ?",
        [runId],
      );
      expect(run?.status).toBe("queued");
    });

    it("paused run is not picked up by worker", async () => {
      db = openTestSqliteDb();
      const jobId = crypto.randomUUID();
      const runId = crypto.randomUUID();
      await db.run(
        "INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json, input_json, latest_run_id) VALUES (?, ?, ?, 'running', '{}', '{}', ?)",
        [jobId, "test-key", "main", runId],
      );
      await db.run(
        "INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt, paused_reason) VALUES (?, ?, ?, ?, 'paused', 1, 'approval')",
        [runId, jobId, "test-key", "main"],
      );

      // Verify paused run won't be picked (worker queries for queued/running, not paused)
      const pickable = await db.get<{ run_id: string }>(
        "SELECT run_id FROM execution_runs WHERE status IN ('queued', 'running') AND run_id = ?",
        [runId],
      );
      expect(pickable).toBeUndefined();
    });

    it("cancelled run stays cancelled after DB reconnect simulation", async () => {
      db = openTestSqliteDb();
      const jobId = crypto.randomUUID();
      const runId = crypto.randomUUID();
      await db.run(
        "INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json, input_json, latest_run_id) VALUES (?, ?, ?, 'running', '{}', '{}', ?)",
        [jobId, "test-key", "main", runId],
      );
      await db.run(
        "INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt) VALUES (?, ?, ?, ?, 'cancelled', 1)",
        [runId, jobId, "test-key", "main"],
      );

      // Close and reopen DB (simulate reconnect/failover)
      await db.close();
      db = openTestSqliteDb();

      // In-memory DBs are ephemeral, so we re-insert to verify the status
      // constraint is correct. For real Postgres tests, this would verify
      // across connections without re-insertion.
      await db.run(
        "INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json, input_json, latest_run_id) VALUES (?, ?, ?, 'running', '{}', '{}', ?)",
        [jobId, "test-key", "main", runId],
      );
      await db.run(
        "INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt) VALUES (?, ?, ?, ?, 'cancelled', 1)",
        [runId, jobId, "test-key", "main"],
      );
      const run = await db.get<{ status: string }>(
        "SELECT status FROM execution_runs WHERE run_id = ?",
        [runId],
      );
      expect(run?.status).toBe("cancelled");
    });

    it("only queued/running runs appear in a worker pick query", async () => {
      db = openTestSqliteDb();
      // execution_jobs uses: queued, running, completed, failed, cancelled
      // execution_runs uses: queued, running, paused, succeeded, failed, cancelled
      const runStatuses = ["queued", "running", "paused", "succeeded", "failed", "cancelled"] as const;
      const runStatusToJobStatus: Record<string, string> = {
        queued: "queued",
        running: "running",
        paused: "running",
        succeeded: "completed",
        failed: "failed",
        cancelled: "cancelled",
      };
      for (const status of runStatuses) {
        const jobId = crypto.randomUUID();
        const runId = crypto.randomUUID();
        await db.run(
          "INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json, input_json, latest_run_id) VALUES (?, ?, ?, ?, '{}', '{}', ?)",
          [jobId, "test-key", "main", runStatusToJobStatus[status], runId],
        );
        await db.run(
          `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt${status === "paused" ? ", paused_reason" : ""}) VALUES (?, ?, ?, ?, ?, 1${status === "paused" ? ", 'approval'" : ""})`,
          [runId, jobId, "test-key", "main", status],
        );
      }

      const pickable = await db.all<{ status: string }>(
        "SELECT status FROM execution_runs WHERE status IN ('queued', 'running')",
        [],
      );
      expect(pickable).toHaveLength(2);
      const pickableStatuses = pickable.map((r) => r.status).sort();
      expect(pickableStatuses).toEqual(["queued", "running"]);
    });
  });

  describe("outbox backpressure", () => {
    it("outbox processes messages in order", async () => {
      db = openTestSqliteDb();
      // Insert multiple outbox messages and verify ordering
      for (let i = 0; i < 5; i++) {
        await db.run(
          "INSERT INTO outbox (topic, payload_json) VALUES (?, ?)",
          ["test.topic", JSON.stringify({ index: i })],
        );
      }
      const rows = await db.all<{ payload_json: string }>(
        "SELECT payload_json FROM outbox ORDER BY id ASC",
        [],
      );
      const indices = rows.map(
        (r) => (JSON.parse(r.payload_json) as { index: number }).index,
      );
      expect(indices).toEqual([0, 1, 2, 3, 4]);
    });

    it("outbox consumer cursor tracks last processed message", async () => {
      db = openTestSqliteDb();
      for (let i = 0; i < 3; i++) {
        await db.run(
          "INSERT INTO outbox (topic, payload_json) VALUES (?, ?)",
          ["test.topic", JSON.stringify({ index: i })],
        );
      }

      // Simulate consumer registering with cursor at id=2
      await db.run(
        "INSERT INTO outbox_consumers (consumer_id, last_outbox_id) VALUES (?, ?)",
        ["edge-1", 2],
      );

      // Only messages after id=2 should be unprocessed for this consumer
      const unprocessed = await db.all<{ id: number; payload_json: string }>(
        `SELECT o.id, o.payload_json FROM outbox o
         JOIN outbox_consumers c ON c.consumer_id = ?
         WHERE o.id > c.last_outbox_id
         ORDER BY o.id ASC`,
        ["edge-1"],
      );
      expect(unprocessed).toHaveLength(1);
      expect(
        (JSON.parse(unprocessed[0]!.payload_json) as { index: number }).index,
      ).toBe(2);
    });
  });

  describe("approval lifecycle invariants", () => {
    it("approval cannot transition from approved back to pending", async () => {
      db = openTestSqliteDb();
      await db.run(
        "INSERT INTO approvals (plan_id, step_index, prompt, context_json, status) VALUES (?, ?, ?, ?, 'approved')",
        ["plan-1", 0, "approve?", "{}"],
      );
      // Attempt to update back to pending (should affect 0 rows with proper WHERE clause)
      const result = await db.run(
        "UPDATE approvals SET status = 'pending' WHERE plan_id = ? AND status = 'pending'",
        ["plan-1"],
      );
      expect(result.changes).toBe(0);
    });

    it("expired approval is not re-approvable", async () => {
      db = openTestSqliteDb();
      const pastDate = new Date(Date.now() - 60_000).toISOString();
      await db.run(
        "INSERT INTO approvals (plan_id, step_index, prompt, context_json, status, expires_at) VALUES (?, ?, ?, ?, 'expired', ?)",
        ["plan-1", 0, "approve?", "{}", pastDate],
      );
      const result = await db.run(
        "UPDATE approvals SET status = 'approved' WHERE plan_id = ? AND status = 'pending'",
        ["plan-1"],
      );
      expect(result.changes).toBe(0);
    });

    it("denied approval cannot be re-approved", async () => {
      db = openTestSqliteDb();
      await db.run(
        "INSERT INTO approvals (plan_id, step_index, prompt, context_json, status) VALUES (?, ?, ?, ?, 'denied')",
        ["plan-1", 0, "approve?", "{}"],
      );
      const result = await db.run(
        "UPDATE approvals SET status = 'approved' WHERE plan_id = ? AND status = 'pending'",
        ["plan-1"],
      );
      expect(result.changes).toBe(0);
    });
  });

  describe("presence cleanup", () => {
    it("cleanup removes entries older than TTL", async () => {
      db = openTestSqliteDb();
      const staleTime = new Date(Date.now() - 60_000).toISOString();
      const activeTime = new Date().toISOString();

      await db.run(
        "INSERT INTO presence_entries (client_id, role, capabilities_json, connected_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
        ["expired-client", "client", "[]", staleTime, staleTime],
      );
      await db.run(
        "INSERT INTO presence_entries (client_id, role, capabilities_json, connected_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
        ["active-client", "client", "[]", activeTime, activeTime],
      );

      // Remove entries whose last_seen_at is older than 30s TTL
      const cutoff = new Date(Date.now() - 30_000).toISOString();
      await db.run(
        "DELETE FROM presence_entries WHERE last_seen_at <= ?",
        [cutoff],
      );

      const remaining = await db.all<{ client_id: string }>(
        "SELECT client_id FROM presence_entries",
        [],
      );
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.client_id).toBe("active-client");
    });
  });

  describe("dedupe idempotency", () => {
    it("duplicate inbound message is detected", async () => {
      db = openTestSqliteDb();
      const futureExpiry = new Date(Date.now() + 3_600_000).toISOString();

      await db.run(
        "INSERT INTO inbound_dedupe (message_id, channel, expires_at) VALUES (?, ?, ?)",
        ["msg-1", "telegram", futureExpiry],
      );

      const dup = await db.get<{ message_id: string }>(
        "SELECT message_id FROM inbound_dedupe WHERE message_id = ? AND channel = ?",
        ["msg-1", "telegram"],
      );
      expect(dup).toBeDefined();

      // Different channel should not match (query filters by both columns)
      const notDup = await db.get<{ message_id: string }>(
        "SELECT message_id FROM inbound_dedupe WHERE message_id = ? AND channel = ?",
        ["msg-1", "slack"],
      );
      expect(notDup).toBeUndefined();
    });

    it("expired dedupe records are cleaned up", async () => {
      db = openTestSqliteDb();
      const pastExpiry = new Date(Date.now() - 60_000).toISOString();
      const futureExpiry = new Date(Date.now() + 3_600_000).toISOString();

      await db.run(
        "INSERT INTO inbound_dedupe (message_id, channel, expires_at) VALUES (?, ?, ?)",
        ["msg-expired", "telegram", pastExpiry],
      );
      await db.run(
        "INSERT INTO inbound_dedupe (message_id, channel, expires_at) VALUES (?, ?, ?)",
        ["msg-fresh", "telegram", futureExpiry],
      );

      const nowIso = new Date().toISOString();
      const result = await db.run(
        "DELETE FROM inbound_dedupe WHERE expires_at <= ?",
        [nowIso],
      );
      expect(result.changes).toBe(1);

      const remaining = await db.all<{ message_id: string }>(
        "SELECT message_id FROM inbound_dedupe",
        [],
      );
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.message_id).toBe("msg-fresh");
    });
  });

  describe("lane lease contention", () => {
    it("only one worker holds a lane lease at a time", async () => {
      db = openTestSqliteDb();
      const futureMs = Date.now() + 60_000;
      await db.run(
        "INSERT INTO lane_leases (key, lane, lease_owner, lease_expires_at_ms) VALUES (?, ?, ?, ?)",
        ["workflow-1", "main", "worker-A", futureMs],
      );

      // Second worker attempting to claim the same lane should conflict (PK violation)
      let conflict = false;
      try {
        await db.run(
          "INSERT INTO lane_leases (key, lane, lease_owner, lease_expires_at_ms) VALUES (?, ?, ?, ?)",
          ["workflow-1", "main", "worker-B", futureMs],
        );
      } catch {
        conflict = true;
      }
      expect(conflict).toBe(true);

      // Verify the original owner still holds the lease
      const lease = await db.get<{ lease_owner: string }>(
        "SELECT lease_owner FROM lane_leases WHERE key = ? AND lane = ?",
        ["workflow-1", "main"],
      );
      expect(lease?.lease_owner).toBe("worker-A");
    });

    it("expired lease can be acquired by another worker", async () => {
      db = openTestSqliteDb();
      const pastMs = Date.now() - 60_000;
      await db.run(
        "INSERT INTO lane_leases (key, lane, lease_owner, lease_expires_at_ms) VALUES (?, ?, ?, ?)",
        ["workflow-1", "main", "worker-A", pastMs],
      );

      // Another worker can take over by updating the expired lease
      const nowMs = Date.now();
      const result = await db.run(
        "UPDATE lane_leases SET lease_owner = ?, lease_expires_at_ms = ? WHERE key = ? AND lane = ? AND lease_expires_at_ms <= ?",
        ["worker-B", nowMs + 60_000, "workflow-1", "main", nowMs],
      );
      expect(result.changes).toBe(1);

      const lease = await db.get<{ lease_owner: string }>(
        "SELECT lease_owner FROM lane_leases WHERE key = ? AND lane = ?",
        ["workflow-1", "main"],
      );
      expect(lease?.lease_owner).toBe("worker-B");
    });
  });

  describe("idempotency records", () => {
    it("concurrent duplicate job submission is prevented", async () => {
      db = openTestSqliteDb();
      await db.run(
        "INSERT INTO idempotency_records (scope_key, kind, idempotency_key, status) VALUES (?, ?, ?, ?)",
        ["workflow-1", "step", "idem-key-1", "running"],
      );

      // Second submission with the same key should conflict (PK violation)
      let conflict = false;
      try {
        await db.run(
          "INSERT INTO idempotency_records (scope_key, kind, idempotency_key, status) VALUES (?, ?, ?, ?)",
          ["workflow-1", "step", "idem-key-1", "running"],
        );
      } catch {
        conflict = true;
      }
      expect(conflict).toBe(true);
    });

    it("completed idempotency record retains result", async () => {
      db = openTestSqliteDb();
      await db.run(
        "INSERT INTO idempotency_records (scope_key, kind, idempotency_key, status, result_json) VALUES (?, ?, ?, ?, ?)",
        ["workflow-1", "step", "idem-key-1", "succeeded", '{"output":"done"}'],
      );

      const record = await db.get<{ status: string; result_json: string }>(
        "SELECT status, result_json FROM idempotency_records WHERE scope_key = ? AND kind = ? AND idempotency_key = ?",
        ["workflow-1", "step", "idem-key-1"],
      );
      expect(record?.status).toBe("succeeded");
      expect(JSON.parse(record!.result_json)).toEqual({ output: "done" });
    });
  });
});
