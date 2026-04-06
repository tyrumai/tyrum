import { afterEach, describe, expect, it } from "vitest";
import {
  createTurnController,
  type TurnController,
} from "../../src/modules/agent/runtime/turn-controller.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

const TURN_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_KEY = "agent:agent-1:main";
const RESUME_TOKEN = "resume-token-1";
const CANCELLED_PROGRESS = {
  kind: "turn.cancelled",
  reason: "already cancelled",
};

describe("createTurnController", () => {
  let db: SqliteDb | undefined;
  let turnController: TurnController | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
    turnController = undefined;
  });

  async function seedCancelledTurn(): Promise<void> {
    await db?.run(`INSERT OR IGNORE INTO tenants (tenant_id, tenant_key) VALUES (?, ?)`, [
      DEFAULT_TENANT_ID,
      "tenant-1",
    ]);
    await db?.run(
      `INSERT OR IGNORE INTO agents (tenant_id, agent_id, agent_key) VALUES (?, ?, ?)`,
      [DEFAULT_TENANT_ID, DEFAULT_AGENT_ID, "agent-1"],
    );
    await db?.run(
      `INSERT OR IGNORE INTO workspaces (tenant_id, workspace_id, workspace_key) VALUES (?, ?, ?)`,
      [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, "workspace-1"],
    );
    await db?.run(
      `INSERT OR IGNORE INTO agent_workspaces (tenant_id, agent_id, workspace_id) VALUES (?, ?, ?)`,
      [DEFAULT_TENANT_ID, DEFAULT_AGENT_ID, DEFAULT_WORKSPACE_ID],
    );
    await db?.run(
      `INSERT INTO turn_jobs (
         tenant_id,
         job_id,
         agent_id,
         workspace_id,
         conversation_key,
         status,
         trigger_json,
         input_json,
         created_at
       ) VALUES (?, ?, ?, ?, ?, 'cancelled', ?, NULL, ?)`,
      [
        DEFAULT_TENANT_ID,
        JOB_ID,
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        CONVERSATION_KEY,
        JSON.stringify({ kind: "conversation" }),
        "2026-04-06T10:00:00.000Z",
      ],
    );
    await db?.run(
      `INSERT INTO turns (
         tenant_id,
         turn_id,
         job_id,
         conversation_key,
         status,
         attempt,
         blocked_reason,
         blocked_detail,
         created_at,
         started_at,
         finished_at,
         last_progress_at,
         last_progress_json
       ) VALUES (?, ?, ?, ?, 'cancelled', 1, 'cancelled', ?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        TURN_ID,
        JOB_ID,
        CONVERSATION_KEY,
        "already cancelled",
        "2026-04-06T10:00:00.000Z",
        "2026-04-06T10:00:01.000Z",
        "2026-04-06T10:00:02.000Z",
        "2026-04-06T10:00:02.000Z",
        JSON.stringify(CANCELLED_PROGRESS),
      ],
    );
    await db?.run(
      `INSERT INTO conversation_leases (tenant_id, conversation_key, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, CONVERSATION_KEY, "worker-1", 1_234_567_890],
    );
    await db?.run(
      `INSERT INTO resume_tokens (tenant_id, token, turn_id, created_at, revoked_at)
       VALUES (?, ?, ?, ?, NULL)`,
      [DEFAULT_TENANT_ID, RESUME_TOKEN, TURN_ID, "2026-04-06T10:00:00.000Z"],
    );
  }

  it("treats cancelled turns as already terminal without mutating cancellation state", async () => {
    db = openTestSqliteDb();
    turnController = createTurnController({ db });
    await seedCancelledTurn();

    await expect(turnController.cancelTurn(TURN_ID, "ignored reason")).resolves.toBe(
      "already_terminal",
    );

    await expect(
      db.get<{
        status: string;
        blocked_detail: string | null;
        last_progress_json: string | null;
      }>(
        `SELECT status, blocked_detail, last_progress_json
           FROM turns
          WHERE tenant_id = ?
            AND turn_id = ?`,
        [DEFAULT_TENANT_ID, TURN_ID],
      ),
    ).resolves.toEqual({
      status: "cancelled",
      blocked_detail: "already cancelled",
      last_progress_json: JSON.stringify(CANCELLED_PROGRESS),
    });

    await expect(
      db.get<{ revoked_at: string | null }>(
        `SELECT revoked_at
           FROM resume_tokens
          WHERE tenant_id = ?
            AND token = ?`,
        [DEFAULT_TENANT_ID, RESUME_TOKEN],
      ),
    ).resolves.toEqual({ revoked_at: null });

    await expect(
      db.get<{ conversation_key: string }>(
        `SELECT conversation_key
           FROM conversation_leases
          WHERE tenant_id = ?
            AND conversation_key = ?`,
        [DEFAULT_TENANT_ID, CONVERSATION_KEY],
      ),
    ).resolves.toEqual({ conversation_key: CONVERSATION_KEY });
  });
});
