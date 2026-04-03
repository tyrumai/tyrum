import { afterEach, describe, expect, it } from "vitest";
import { TurnItemDal } from "../../src/modules/agent/turn-item-dal.js";
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

describe("TurnItemDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  async function insertCompletedTurn(input: {
    jobId: string;
    turnId: string;
    conversationKey: string;
  }): Promise<void> {
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
       ) VALUES (?, ?, ?, ?, ?, 'completed', ?, NULL, ?)`,
      [
        TENANT_ID,
        input.jobId,
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        input.conversationKey,
        JSON.stringify({ kind: "manual" }),
        "2026-02-19T12:00:00.000Z",
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
        TENANT_ID,
        input.turnId,
        input.jobId,
        input.conversationKey,
        "2026-02-19T12:00:00.000Z",
        "2026-02-19T12:00:01.000Z",
        "2026-02-19T12:00:02.000Z",
      ],
    );
  }

  it("stores ordered message-backed turn items and deduplicates by item_key", async () => {
    db = openTestSqliteDb();
    const dal = new TurnItemDal(db);

    await insertCompletedTurn({
      jobId: JOB_ID,
      turnId: TURN_ID,
      conversationKey: "agent:default:main",
    });

    const inserted = await dal.ensureItem({
      tenantId: TENANT_ID,
      turnItemId: "30000000-0000-4000-8000-000000000000",
      turnId: TURN_ID,
      itemIndex: 0,
      itemKey: "message:user-1",
      kind: "message",
      createdAt: "2026-02-19T12:00:03.000Z",
      payload: {
        message: {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
          metadata: { turn_id: TURN_ID },
        },
      },
    });

    const duplicate = await dal.ensureItem({
      tenantId: TENANT_ID,
      turnItemId: "40000000-0000-4000-8000-000000000000",
      turnId: TURN_ID,
      itemIndex: 0,
      itemKey: "message:user-1",
      kind: "message",
      createdAt: "2026-02-19T12:00:04.000Z",
      payload: {
        message: {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Hello again" }],
          metadata: { turn_id: TURN_ID },
        },
      },
    });

    await dal.ensureItem({
      tenantId: TENANT_ID,
      turnItemId: "50000000-0000-4000-8000-000000000000",
      turnId: TURN_ID,
      itemIndex: 1,
      itemKey: "message:assistant-1",
      kind: "message",
      createdAt: "2026-02-19T12:00:05.000Z",
      payload: {
        message: {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "Hi there" }],
          metadata: { turn_id: TURN_ID },
        },
      },
    });

    expect(duplicate).toEqual(inserted);

    const items = await dal.listByTurnId({ tenantId: TENANT_ID, turnId: TURN_ID });
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.item_key)).toEqual(["message:user-1", "message:assistant-1"]);
    expect(items[0]?.payload.message.role).toBe("user");
    expect(items[1]?.payload.message.role).toBe("assistant");
  });

  it("groups items by turn id for transcript follow-up reads", async () => {
    db = openTestSqliteDb();
    const dal = new TurnItemDal(db);

    const secondJobId = "60000000-0000-4000-8000-000000000000";
    const secondTurnId = "70000000-0000-4000-8000-000000000000";
    for (const [jobId, turnId, conversationKey] of [
      [JOB_ID, TURN_ID, "agent:default:main"],
      [secondJobId, secondTurnId, "agent:default:secondary"],
    ] as const) {
      await insertCompletedTurn({ jobId, turnId, conversationKey });
    }

    await dal.ensureItem({
      tenantId: TENANT_ID,
      turnItemId: "80000000-0000-4000-8000-000000000000",
      turnId: TURN_ID,
      itemIndex: 0,
      itemKey: "message:user-1",
      kind: "message",
      createdAt: "2026-02-19T12:00:03.000Z",
      payload: {
        message: {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "One" }],
          metadata: { turn_id: TURN_ID },
        },
      },
    });
    await dal.ensureItem({
      tenantId: TENANT_ID,
      turnItemId: "90000000-0000-4000-8000-000000000000",
      turnId: secondTurnId,
      itemIndex: 0,
      itemKey: "message:user-2",
      kind: "message",
      createdAt: "2026-02-19T12:00:03.000Z",
      payload: {
        message: {
          id: "user-2",
          role: "user",
          parts: [{ type: "text", text: "Two" }],
          metadata: { turn_id: secondTurnId },
        },
      },
    });

    const itemsByTurn = await dal.listByTurnIds({
      tenantId: TENANT_ID,
      turnIds: [TURN_ID, secondTurnId],
    });

    expect(itemsByTurn.get(TURN_ID)?.map((item) => item.payload.message.id)).toEqual(["user-1"]);
    expect(itemsByTurn.get(secondTurnId)?.map((item) => item.payload.message.id)).toEqual([
      "user-2",
    ]);
  });

  it("shifts existing item indices without colliding on the unique turn order key", async () => {
    db = openTestSqliteDb();
    const dal = new TurnItemDal(db);

    await insertCompletedTurn({
      jobId: JOB_ID,
      turnId: TURN_ID,
      conversationKey: "agent:default:main",
    });
    for (const [turnItemId, itemIndex, itemKey, text] of [
      ["30000000-0000-4000-8000-000000000001", 0, "message:assistant-1", "one"],
      ["30000000-0000-4000-8000-000000000002", 1, "message:assistant-2", "two"],
      ["30000000-0000-4000-8000-000000000003", 2, "message:assistant-3", "three"],
    ] as const) {
      await dal.ensureItem({
        tenantId: TENANT_ID,
        turnItemId,
        turnId: TURN_ID,
        itemIndex,
        itemKey,
        kind: "message",
        createdAt: "2026-02-19T12:00:03.000Z",
        payload: {
          message: {
            id: itemKey,
            role: "assistant",
            parts: [{ type: "text", text }],
            metadata: { turn_id: TURN_ID },
          },
        },
      });
    }

    await expect(
      dal.shiftItemIndices({
        tenantId: TENANT_ID,
        turnId: TURN_ID,
        fromIndex: 1,
        delta: 1,
      }),
    ).resolves.toBeUndefined();

    const items = await dal.listByTurnId({ tenantId: TENANT_ID, turnId: TURN_ID });
    expect(items.map((item) => item.item_index)).toEqual([0, 2, 3]);
    expect(items.map((item) => item.item_key)).toEqual([
      "message:assistant-1",
      "message:assistant-2",
      "message:assistant-3",
    ]);
  });
});
