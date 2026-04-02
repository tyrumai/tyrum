import { describe, expect, it } from "vitest";
import { listRunnableTurnCandidates } from "../../src/modules/execution/engine/leasing.js";
import type { SqlDb } from "../../src/statestore/types.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

interface SeededTurnOptions {
  turnId: string;
  jobId: string;
  conversationKey: string;
  createdAt: string;
  triggerJson: string;
}

const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const AGENT_ID = "20000000-0000-4000-8000-000000000001";
const WORKSPACE_ID = "30000000-0000-4000-8000-000000000001";

function buildUuid(seed: number): string {
  return `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
}

async function seedExecutionScope(db: {
  run(sql: string, params?: readonly unknown[]): Promise<unknown>;
}) {
  await db.run(`INSERT INTO tenants (tenant_id, tenant_key) VALUES (?, ?)`, [
    TENANT_ID,
    "tenant-1",
  ]);
  await db.run(`INSERT INTO agents (tenant_id, agent_id, agent_key) VALUES (?, ?, ?)`, [
    TENANT_ID,
    AGENT_ID,
    "agent-1",
  ]);
  await db.run(`INSERT INTO workspaces (tenant_id, workspace_id, workspace_key) VALUES (?, ?, ?)`, [
    TENANT_ID,
    WORKSPACE_ID,
    "workspace-1",
  ]);
  await db.run(
    `INSERT INTO agent_workspaces (tenant_id, agent_id, workspace_id) VALUES (?, ?, ?)`,
    [TENANT_ID, AGENT_ID, WORKSPACE_ID],
  );
}

async function insertTurnCandidate(db: SqlDb, opts: SeededTurnOptions) {
  await db.run(
    `INSERT INTO turn_jobs (
       tenant_id,
       job_id,
       agent_id,
       workspace_id,
       conversation_key,
       status,
       trigger_json,
       created_at
     ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`,
    [
      TENANT_ID,
      opts.jobId,
      AGENT_ID,
      WORKSPACE_ID,
      opts.conversationKey,
      opts.triggerJson,
      opts.createdAt,
    ],
  );
  await db.run(
    `INSERT INTO turns (
       tenant_id,
       turn_id,
       job_id,
       conversation_key,
       status,
       attempt,
       created_at
     ) VALUES (?, ?, ?, ?, 'queued', 1, ?)`,
    [TENANT_ID, opts.turnId, opts.jobId, opts.conversationKey, opts.createdAt],
  );
}

async function expectSkipsZeroStepConversationTurns(db: SqlDb): Promise<void> {
  await seedExecutionScope(db);

  for (let index = 0; index < 10; index += 1) {
    await insertTurnCandidate(db, {
      turnId: buildUuid(index + 1),
      jobId: buildUuid(index + 101),
      conversationKey: `conversation:${index}`,
      createdAt: `2026-04-02T00:00:${String(index).padStart(2, "0")}.000Z`,
      triggerJson: JSON.stringify({ kind: "conversation" }),
    });
  }

  await insertTurnCandidate(db, {
    turnId: buildUuid(999),
    jobId: buildUuid(1999),
    conversationKey: "conversation:eligible",
    createdAt: "2026-04-02T00:00:10.000Z",
    triggerJson: JSON.stringify({ kind: "api" }),
  });

  await expect(listRunnableTurnCandidates(db)).resolves.toEqual([
    expect.objectContaining({
      tenant_id: TENANT_ID,
      turn_id: buildUuid(999),
      job_id: buildUuid(1999),
      agent_id: AGENT_ID,
      key: "conversation:eligible",
      status: "queued",
      trigger_json: JSON.stringify({ kind: "api" }),
      workspace_id: WORKSPACE_ID,
    }),
  ]);
}

describe("listRunnableTurnCandidates", () => {
  it("skips zero-step conversation turns before applying the lease batch limit", async () => {
    const db = openTestSqliteDb();
    try {
      await expectSkipsZeroStepConversationTurns(db);
    } finally {
      await db.close();
    }
  });

  it("applies the same zero-step conversation filter on postgres", async () => {
    let capturedSql = "";
    const db: SqlDb = {
      kind: "postgres",
      get: async () => undefined,
      all: async (sql) => {
        capturedSql = sql;
        return [];
      },
      run: async () => ({ changes: 0 }),
      exec: async () => {},
      transaction: async (fn) => await fn(db),
      close: async () => {},
    };

    await expect(listRunnableTurnCandidates(db)).resolves.toEqual([]);
    expect(capturedSql).toContain("jsonb_typeof(j.trigger_json::jsonb)");
    expect(capturedSql).toContain("j.trigger_json::jsonb ->> 'kind'");
    expect(capturedSql).not.toContain("json_valid(");
  });
});
