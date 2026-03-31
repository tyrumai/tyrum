import { afterEach, describe, expect, it } from "vitest";
import {
  recordTurnProgressTx,
  readTurnRuntimeState,
  setTurnCheckpointStateTx,
  setTurnLeaseStateTx,
} from "@tyrum/runtime-execution";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

const TENANT_ID = DEFAULT_TENANT_ID;
const JOB_ID = "10000000-0000-4000-8000-000000000000";
const TURN_ID = "20000000-0000-4000-8000-000000000000";

describe("turn runtime state helpers", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  async function insertTurn(sqliteDb: SqliteDb): Promise<void> {
    await sqliteDb.run(
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
       ) VALUES (?, ?, ?, ?, ?, 'queued', ?, NULL, ?)`,
      [
        TENANT_ID,
        JOB_ID,
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        "agent:default:main",
        JSON.stringify({ kind: "manual" }),
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
         created_at
       ) VALUES (?, ?, ?, ?, 'queued', 1, ?)`,
      [TENANT_ID, TURN_ID, JOB_ID, "agent:default:main", "2026-03-31T14:00:00.000Z"],
    );
  }

  it("reads and writes lease, checkpoint, and progress metadata", async () => {
    db = openTestSqliteDb();
    await insertTurn(db);

    await db.transaction(async (tx) => {
      await setTurnLeaseStateTx(tx, {
        tenantId: TENANT_ID,
        turnId: TURN_ID,
        owner: "worker-1",
        expiresAtMs: 123_456,
      });
      await setTurnCheckpointStateTx(tx, {
        tenantId: TENANT_ID,
        turnId: TURN_ID,
        checkpoint: {
          cursor: "message-2",
          partial_response: "Still working",
        },
      });
      await recordTurnProgressTx(tx, {
        tenantId: TENANT_ID,
        turnId: TURN_ID,
        at: "2026-03-31T14:00:05.000Z",
        progress: {
          kind: "stream",
          item_key: "message:assistant-1",
          note: "first token emitted",
        },
      });
    });

    await db.run(
      `UPDATE turns
       SET last_progress_json = NULL
       WHERE tenant_id = ? AND turn_id = ?`,
      [TENANT_ID, TURN_ID],
    );

    await db.transaction(async (tx) => {
      await recordTurnProgressTx(tx, {
        tenantId: TENANT_ID,
        turnId: TURN_ID,
        at: "2026-03-31T14:00:06.000Z",
        progress: {
          kind: "checkpoint_saved",
          checkpoint_version: 1,
        },
      });
    });

    const state = await readTurnRuntimeState(db, {
      tenantId: TENANT_ID,
      turnId: TURN_ID,
    });

    expect(state).toEqual({
      leaseOwner: "worker-1",
      leaseExpiresAtMs: 123_456,
      checkpoint: {
        cursor: "message-2",
        partial_response: "Still working",
      },
      lastProgressAt: "2026-03-31T14:00:06.000Z",
      lastProgress: {
        kind: "checkpoint_saved",
        checkpoint_version: 1,
      },
    });
  });

  it("treats malformed stored json as empty runtime state", async () => {
    db = openTestSqliteDb();
    await insertTurn(db);

    await db.run(
      `UPDATE turns
       SET checkpoint_json = ?,
           last_progress_at = ?,
           last_progress_json = ?
       WHERE tenant_id = ? AND turn_id = ?`,
      ["{", "2026-03-31T14:01:00.000Z", '"not-an-object"', TENANT_ID, TURN_ID],
    );

    const state = await readTurnRuntimeState(db, {
      tenantId: TENANT_ID,
      turnId: TURN_ID,
    });

    expect(state).toEqual({
      leaseOwner: null,
      leaseExpiresAtMs: null,
      checkpoint: null,
      lastProgressAt: "2026-03-31T14:01:00.000Z",
      lastProgress: null,
    });
  });
});
