import { afterEach, describe, expect, it } from "vitest";
import { TurnItemDal } from "../../src/modules/agent/turn-item-dal.js";
import { loadTurnResult } from "../../src/modules/agent/runtime/turn-engine-bridge-turn-state.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
const TURN_ID = "11111111-1111-4111-8111-111111111112";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const CHANNEL_ACCOUNT_ID = "channel-account-1";
const CHANNEL_THREAD_ID = "channel-thread-1";

describe("loadTurnResult", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  async function seedTurnRunnerTurn(): Promise<void> {
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
      `INSERT OR IGNORE INTO channel_accounts (
         tenant_id,
         workspace_id,
         channel_account_id,
         connector_key,
         account_key,
         status
       ) VALUES (?, ?, ?, ?, ?, 'active')`,
      [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, CHANNEL_ACCOUNT_ID, "test", "account-1"],
    );
    await db?.run(
      `INSERT OR IGNORE INTO channel_threads (
         tenant_id,
         workspace_id,
         channel_thread_id,
         channel_account_id,
         provider_thread_id,
         container_kind
       ) VALUES (?, ?, ?, ?, ?, 'channel')`,
      [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, CHANNEL_THREAD_ID, CHANNEL_ACCOUNT_ID, "thread-1"],
    );
    await db?.run(
      `INSERT INTO conversations (
         tenant_id,
         conversation_id,
         conversation_key,
         agent_id,
         workspace_id,
         channel_thread_id,
         title,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        CONVERSATION_ID,
        "agent:agent-1:main",
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        CHANNEL_THREAD_ID,
        "2026-04-02T00:00:00.000Z",
        "2026-04-02T00:00:00.000Z",
      ],
    );
    await db?.run(
      `INSERT INTO turn_jobs (
         tenant_id,
         job_id,
         agent_id,
         workspace_id,
         conversation_id,
         conversation_key,
         status,
         trigger_json,
         input_json,
         created_at
       ) VALUES (?, ?, ?, ?, NULL, ?, 'completed', ?, NULL, ?)`,
      [
        DEFAULT_TENANT_ID,
        JOB_ID,
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        "agent:agent-1:main",
        JSON.stringify({ kind: "conversation" }),
        "2026-04-02T00:00:00.000Z",
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
         created_at,
         started_at,
         finished_at
       ) VALUES (?, ?, ?, ?, 'succeeded', 1, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        TURN_ID,
        JOB_ID,
        "agent:agent-1:main",
        "2026-04-02T00:00:00.000Z",
        "2026-04-02T00:00:01.000Z",
        "2026-04-02T00:00:02.000Z",
      ],
    );
  }

  it("recovers a turn-runner result from persisted turn_items when no execution step exists", async () => {
    db = openTestSqliteDb();
    await seedTurnRunnerTurn();

    const dal = new TurnItemDal(db);
    await dal.ensureItem({
      tenantId: DEFAULT_TENANT_ID,
      turnItemId: "33333333-3333-4333-8333-333333333333",
      turnId: TURN_ID,
      itemIndex: 0,
      itemKey: "message:user-1",
      kind: "message",
      createdAt: "2026-04-02T00:00:00.000Z",
      payload: {
        message: {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
          metadata: { turn_id: TURN_ID, created_at: "2026-04-02T00:00:00.000Z" },
        },
      },
    });
    await dal.ensureItem({
      tenantId: DEFAULT_TENANT_ID,
      turnItemId: "44444444-4444-4444-8444-444444444444",
      turnId: TURN_ID,
      itemIndex: 1,
      itemKey: "message:assistant-1",
      kind: "message",
      createdAt: "2026-04-02T00:00:01.000Z",
      payload: {
        message: {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "persisted reply" }],
          metadata: { turn_id: TURN_ID, created_at: "2026-04-02T00:00:01.000Z" },
        },
      },
    });

    await expect(loadTurnResult({ db } as never, TURN_ID)).resolves.toEqual({
      reply: "persisted reply",
      turn_id: TURN_ID,
      conversation_id: CONVERSATION_ID,
      conversation_key: "agent:agent-1:main",
      attachments: [],
      used_tools: [],
      memory_written: false,
    });
  });
});
