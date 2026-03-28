import { afterEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";

describe("ChannelInboxDal work_scope_activity updates", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("upserts last_active_conversation_key for inbound interactive activity", async () => {
    db = openTestSqliteDb();
    const inbox = new ChannelInboxDal(db);
    const workboard = new WorkboardDal(db);

    const key = "agent:default:telegram:default:dm:peer-1";

    await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-1",
      key,
      received_at_ms: 1_709_000_000_000,
      payload: { kind: "test" },
    });

    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const activity = await workboard.getScopeActivity({ scope });
    expect(activity).toMatchObject({
      last_active_conversation_key: key,
      updated_at_ms: 1_709_000_000_000,
    });
  });

  it("does not overwrite newer scope activity when inbound message timestamp is stale", async () => {
    db = openTestSqliteDb();
    const inbox = new ChannelInboxDal(db);
    const workboard = new WorkboardDal(db);

    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const newerKey = "agent:default:ui:default:channel:newer";

    await workboard.upsertScopeActivity({
      scope,
      last_active_conversation_key: newerKey,
      updated_at_ms: 2_000,
    });

    const staleKey = "agent:default:telegram:default:dm:stale";
    await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-1",
      key: staleKey,
      received_at_ms: 1_000,
      payload: { kind: "test" },
    });

    const activity = await workboard.getScopeActivity({ scope });
    expect(activity).toMatchObject({
      last_active_conversation_key: newerKey,
      updated_at_ms: 2_000,
    });
  });
});
