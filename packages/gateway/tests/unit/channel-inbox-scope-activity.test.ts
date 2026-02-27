import { afterEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";

describe("ChannelInboxDal work_scope_activity updates", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("upserts last_active_session_key for inbound interactive activity", async () => {
    db = openTestSqliteDb();
    const inbox = new ChannelInboxDal(db);
    const workboard = new WorkboardDal(db);

    const key = "agent:default:telegram:default:dm:peer-1";

    await inbox.enqueue({
      source: "telegram",
      thread_id: "chat-1",
      message_id: "msg-1",
      key,
      lane: "main",
      received_at_ms: 1_709_000_000_000,
      payload: { kind: "test" },
    });

    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;
    const activity = await workboard.getScopeActivity({ scope });
    expect(activity).toMatchObject({
      last_active_session_key: key,
      updated_at_ms: 1_709_000_000_000,
    });
  });
});
