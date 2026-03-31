import { afterEach, describe, expect, it } from "vitest";
import { TurnRunner } from "../../src/modules/agent/runtime/turn-runner.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

const TENANT_ID = DEFAULT_TENANT_ID;
const AGENT_ID = DEFAULT_AGENT_ID;
const WORKSPACE_ID = DEFAULT_WORKSPACE_ID;
const JOB_ID = "10000000-0000-4000-8000-000000000000";
const TURN_ID = "20000000-0000-4000-8000-000000000000";
const STEP_ID = "30000000-0000-4000-8000-000000000000";
const CONVERSATION_KEY = "agent:default:test:default:channel:thread-1";

type SeedTurnInput = {
  triggerKind?: "conversation" | "heartbeat";
  turnStatus?: "queued" | "running" | "paused" | "succeeded" | "failed" | "cancelled";
  jobStatus?: "queued" | "running" | "completed" | "failed" | "cancelled";
  blockedReason?: string | null;
  blockedDetail?: string | null;
  leaseOwner?: string | null;
  leaseExpiresAtMs?: number | null;
  startedAt?: string | null;
  budgetOverriddenAt?: string | null;
};

describe("TurnRunner", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  async function seedTurn(sqliteDb: SqliteDb, input: SeedTurnInput = {}): Promise<void> {
    const triggerKind = input.triggerKind ?? "conversation";
    const turnStatus = input.turnStatus ?? "queued";
    const jobStatus = input.jobStatus ?? (turnStatus === "queued" ? "queued" : "running");

    await sqliteDb.run(
      `INSERT INTO turn_jobs (
         tenant_id,
         job_id,
         agent_id,
         workspace_id,
         conversation_key,
         status,
         trigger_json,
         latest_turn_id,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        TENANT_ID,
        JOB_ID,
        AGENT_ID,
        WORKSPACE_ID,
        CONVERSATION_KEY,
        jobStatus,
        JSON.stringify({ kind: triggerKind, conversation_key: CONVERSATION_KEY }),
        TURN_ID,
        "2026-03-31T14:00:00.000Z",
      ],
    );

    await sqliteDb.run(
      `INSERT INTO turns (
         tenant_id,
         turn_id,
         job_id,
         conversation_key,
         status,
         attempt,
         started_at,
         blocked_reason,
         blocked_detail,
         budget_overridden_at,
         lease_owner,
         lease_expires_at_ms,
         created_at
       ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      [
        TENANT_ID,
        TURN_ID,
        JOB_ID,
        CONVERSATION_KEY,
        turnStatus,
        input.startedAt ?? null,
        input.blockedReason ?? null,
        input.blockedDetail ?? null,
        input.budgetOverriddenAt ?? null,
        input.leaseOwner ?? null,
        input.leaseExpiresAtMs ?? null,
        "2026-03-31T14:00:00.000Z",
      ],
    );
  }

  async function seedExecutionStep(sqliteDb: SqliteDb, status = "paused"): Promise<void> {
    await sqliteDb.run(
      `INSERT INTO execution_steps (tenant_id, step_id, turn_id, step_index, status, action_json)
       VALUES (?, ?, ?, 0, ?, '{}')`,
      [TENANT_ID, STEP_ID, TURN_ID, status],
    );
  }

  it("claims queued conversation turns and leaves execution steps untouched", async () => {
    db = openTestSqliteDb();
    await seedTurn(db);
    await seedExecutionStep(db, "queued");

    const runner = new TurnRunner(db);
    const claimed = await runner.claim({
      tenantId: TENANT_ID,
      turnId: TURN_ID,
      owner: "worker-1",
      nowMs: 5_000,
      nowIso: "2026-03-31T14:00:05.000Z",
      leaseTtlMs: 60_000,
    });

    expect(claimed.kind).toBe("claimed");
    if (claimed.kind !== "claimed") {
      return;
    }

    expect(claimed.turn.status).toBe("running");
    expect(claimed.turn.started_at).toBe("2026-03-31T14:00:05.000Z");
    expect(claimed.turn.lease_owner).toBe("worker-1");
    expect(claimed.turn.lease_expires_at_ms).toBe(65_000);

    const step = await db.get<{ status: string }>(
      "SELECT status FROM execution_steps WHERE tenant_id = ? AND step_id = ?",
      [TENANT_ID, STEP_ID],
    );
    expect(step?.status).toBe("queued");
  });

  it("resumes paused conversation turns without touching execution steps", async () => {
    db = openTestSqliteDb();
    await seedTurn(db, {
      turnStatus: "paused",
      jobStatus: "running",
      blockedReason: "budget",
      blockedDetail: "waiting for override",
      leaseOwner: "worker-old",
      leaseExpiresAtMs: 1_000,
      startedAt: "2026-03-31T14:00:01.000Z",
    });
    await seedExecutionStep(db, "paused");

    const runner = new TurnRunner(db);
    const resumed = await runner.resume({
      tenantId: TENANT_ID,
      turnId: TURN_ID,
      owner: "worker-2",
      nowMs: 2_000,
      nowIso: "2026-03-31T14:00:02.000Z",
      leaseTtlMs: 30_000,
      overrideBudget: true,
    });

    expect(resumed.kind).toBe("resumed");
    if (resumed.kind !== "resumed") {
      return;
    }

    expect(resumed.turn.status).toBe("running");
    expect(resumed.turn.blocked_reason).toBeNull();
    expect(resumed.turn.blocked_detail).toBeNull();
    expect(resumed.turn.budget_overridden_at).toBe("2026-03-31T14:00:02.000Z");
    expect(resumed.turn.lease_owner).toBe("worker-2");
    expect(resumed.turn.lease_expires_at_ms).toBe(32_000);

    const step = await db.get<{ status: string }>(
      "SELECT status FROM execution_steps WHERE tenant_id = ? AND step_id = ?",
      [TENANT_ID, STEP_ID],
    );
    expect(step?.status).toBe("paused");
  });

  it("heartbeats running turns by refreshing both lease state and checkpoint state", async () => {
    db = openTestSqliteDb();
    await seedTurn(db, {
      turnStatus: "running",
      jobStatus: "running",
      leaseOwner: "worker-1",
      leaseExpiresAtMs: 10_000,
      startedAt: "2026-03-31T14:00:01.000Z",
    });
    await db.run(
      `INSERT INTO conversation_leases (tenant_id, conversation_key, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)`,
      [TENANT_ID, CONVERSATION_KEY, "worker-1", 10_000],
    );

    const runner = new TurnRunner(db);
    const heartbeat = await runner.heartbeat({
      tenantId: TENANT_ID,
      turnId: TURN_ID,
      owner: "worker-1",
      nowMs: 12_000,
      nowIso: "2026-03-31T14:00:12.000Z",
      leaseTtlMs: 60_000,
      checkpoint: { cursor: "message-2" },
      progress: { kind: "turn.heartbeat", note: "still streaming" },
    });

    expect(heartbeat).toBe(true);

    const turn = await db.get<{
      lease_owner: string | null;
      lease_expires_at_ms: number | null;
      checkpoint_json: string | null;
      last_progress_json: string | null;
    }>(
      `SELECT lease_owner, lease_expires_at_ms, checkpoint_json, last_progress_json
       FROM turns
       WHERE tenant_id = ? AND turn_id = ?`,
      [TENANT_ID, TURN_ID],
    );
    expect(turn).toEqual({
      lease_owner: "worker-1",
      lease_expires_at_ms: 72_000,
      checkpoint_json: JSON.stringify({ cursor: "message-2" }),
      last_progress_json: JSON.stringify({ kind: "turn.heartbeat", note: "still streaming" }),
    });

    const lease = await db.get<{ lease_expires_at_ms: number | null }>(
      `SELECT lease_expires_at_ms
       FROM conversation_leases
       WHERE tenant_id = ? AND conversation_key = ? AND lease_owner = ?`,
      [TENANT_ID, CONVERSATION_KEY, "worker-1"],
    );
    expect(lease?.lease_expires_at_ms).toBe(72_000);
  });

  it("rejects unsupported and terminal turns", async () => {
    db = openTestSqliteDb();
    await seedTurn(db, { triggerKind: "heartbeat", turnStatus: "failed", jobStatus: "failed" });

    const runner = new TurnRunner(db);

    await expect(
      runner.claim({
        tenantId: TENANT_ID,
        turnId: TURN_ID,
        owner: "worker-1",
        nowMs: 1_000,
        nowIso: "2026-03-31T14:00:01.000Z",
        leaseTtlMs: 60_000,
      }),
    ).resolves.toEqual({
      kind: "terminal",
      status: "failed",
    });
  });

  it("only claims conversation-backed turns", async () => {
    db = openTestSqliteDb();
    await seedTurn(db, { triggerKind: "heartbeat", turnStatus: "queued", jobStatus: "queued" });

    const runner = new TurnRunner(db);

    await expect(
      runner.claim({
        tenantId: TENANT_ID,
        turnId: TURN_ID,
        owner: "worker-1",
        nowMs: 1_000,
        nowIso: "2026-03-31T14:00:01.000Z",
        leaseTtlMs: 60_000,
      }),
    ).resolves.toEqual({
      kind: "unsupported",
      triggerKind: "heartbeat",
    });
  });

  it("completes running turns and releases the lease", async () => {
    db = openTestSqliteDb();
    await seedTurn(db, {
      turnStatus: "running",
      jobStatus: "running",
      leaseOwner: "worker-1",
      leaseExpiresAtMs: 10_000,
      startedAt: "2026-03-31T14:00:01.000Z",
    });
    await db.run(
      `INSERT INTO conversation_leases (tenant_id, conversation_key, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)`,
      [TENANT_ID, CONVERSATION_KEY, "worker-1", 10_000],
    );

    const runner = new TurnRunner(db);
    await expect(
      runner.complete({
        tenantId: TENANT_ID,
        turnId: TURN_ID,
        owner: "worker-1",
        nowIso: "2026-03-31T14:00:10.000Z",
      }),
    ).resolves.toBe(true);

    const turn = await db.get<{
      status: string;
      finished_at: string | null;
      lease_owner: string | null;
      lease_expires_at_ms: number | null;
    }>(
      `SELECT status, finished_at, lease_owner, lease_expires_at_ms
       FROM turns
       WHERE tenant_id = ? AND turn_id = ?`,
      [TENANT_ID, TURN_ID],
    );
    expect(turn).toEqual({
      status: "succeeded",
      finished_at: "2026-03-31T14:00:10.000Z",
      lease_owner: null,
      lease_expires_at_ms: null,
    });

    const job = await db.get<{ status: string }>(
      "SELECT status FROM turn_jobs WHERE tenant_id = ? AND job_id = ?",
      [TENANT_ID, JOB_ID],
    );
    expect(job?.status).toBe("completed");

    const lease = await db.get<{ conversation_key: string }>(
      `SELECT conversation_key
       FROM conversation_leases
       WHERE tenant_id = ? AND conversation_key = ?`,
      [TENANT_ID, CONVERSATION_KEY],
    );
    expect(lease).toBeUndefined();
  });

  it("fails running turns and releases the lease", async () => {
    db = openTestSqliteDb();
    await seedTurn(db, {
      turnStatus: "running",
      jobStatus: "running",
      leaseOwner: "worker-1",
      leaseExpiresAtMs: 10_000,
      startedAt: "2026-03-31T14:00:01.000Z",
    });
    await db.run(
      `INSERT INTO conversation_leases (tenant_id, conversation_key, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)`,
      [TENANT_ID, CONVERSATION_KEY, "worker-1", 10_000],
    );

    const runner = new TurnRunner(db);
    await expect(
      runner.fail({
        tenantId: TENANT_ID,
        turnId: TURN_ID,
        owner: "worker-1",
        nowIso: "2026-03-31T14:00:11.000Z",
        error: "model call failed",
      }),
    ).resolves.toBe(true);

    const turn = await db.get<{
      status: string;
      finished_at: string | null;
      lease_owner: string | null;
      lease_expires_at_ms: number | null;
      last_progress_json: string | null;
    }>(
      `SELECT status, finished_at, lease_owner, lease_expires_at_ms, last_progress_json
       FROM turns
       WHERE tenant_id = ? AND turn_id = ?`,
      [TENANT_ID, TURN_ID],
    );
    expect(turn).toEqual({
      status: "failed",
      finished_at: "2026-03-31T14:00:11.000Z",
      lease_owner: null,
      lease_expires_at_ms: null,
      last_progress_json: JSON.stringify({ kind: "turn.failed", error: "model call failed" }),
    });

    const job = await db.get<{ status: string }>(
      "SELECT status FROM turn_jobs WHERE tenant_id = ? AND job_id = ?",
      [TENANT_ID, JOB_ID],
    );
    expect(job?.status).toBe("failed");
  });
});
