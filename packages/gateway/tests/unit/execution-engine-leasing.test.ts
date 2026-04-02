import { describe, expect, it } from "vitest";
import { listRunnableTurnCandidates } from "../../src/modules/execution/engine/leasing.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

interface SeededTurnOptions {
  turnId: string;
  jobId: string;
  conversationKey: string;
  createdAt: string;
  triggerJson: string;
}

async function seedExecutionScope(db: {
  run(sql: string, params?: readonly unknown[]): Promise<unknown>;
}) {
  await db.run(`INSERT INTO tenants (tenant_id, tenant_key) VALUES (?, ?)`, [
    "tenant-1",
    "tenant-1",
  ]);
  await db.run(`INSERT INTO agents (tenant_id, agent_id, agent_key) VALUES (?, ?, ?)`, [
    "tenant-1",
    "agent-1",
    "agent-1",
  ]);
  await db.run(`INSERT INTO workspaces (tenant_id, workspace_id, workspace_key) VALUES (?, ?, ?)`, [
    "tenant-1",
    "workspace-1",
    "workspace-1",
  ]);
  await db.run(
    `INSERT INTO agent_workspaces (tenant_id, agent_id, workspace_id) VALUES (?, ?, ?)`,
    ["tenant-1", "agent-1", "workspace-1"],
  );
}

async function insertTurnCandidate(
  db: { run(sql: string, params?: readonly unknown[]): Promise<unknown> },
  opts: SeededTurnOptions,
) {
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
      "tenant-1",
      opts.jobId,
      "agent-1",
      "workspace-1",
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
    ["tenant-1", opts.turnId, opts.jobId, opts.conversationKey, opts.createdAt],
  );
}

describe("listRunnableTurnCandidates", () => {
  it("skips zero-step conversation turns before applying the lease batch limit", async () => {
    const db = openTestSqliteDb();
    try {
      await seedExecutionScope(db);

      for (let index = 0; index < 10; index += 1) {
        await insertTurnCandidate(db, {
          turnId: `turn-${index}`,
          jobId: `job-${index}`,
          conversationKey: `conversation:${index}`,
          createdAt: `2026-04-02T00:00:${String(index).padStart(2, "0")}.000Z`,
          triggerJson: JSON.stringify({ kind: "conversation" }),
        });
      }

      await insertTurnCandidate(db, {
        turnId: "turn-eligible",
        jobId: "job-eligible",
        conversationKey: "conversation:eligible",
        createdAt: "2026-04-02T00:00:10.000Z",
        triggerJson: JSON.stringify({ kind: "schedule" }),
      });

      await expect(listRunnableTurnCandidates(db)).resolves.toEqual([
        expect.objectContaining({
          tenant_id: "tenant-1",
          turn_id: "turn-eligible",
          job_id: "job-eligible",
          agent_id: "agent-1",
          key: "conversation:eligible",
          status: "queued",
          trigger_json: JSON.stringify({ kind: "schedule" }),
          workspace_id: "workspace-1",
        }),
      ]);
    } finally {
      await db.close();
    }
  });
});
