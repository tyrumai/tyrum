import { afterEach, describe, expect, it, vi } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { ChannelOutboxDal } from "../../src/modules/channels/outbox-dal.js";
import { enqueueWorkItemStateChangeNotification } from "../../src/modules/workboard/notifications.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

describe("Workboard completion notifications", () => {
  let db: SqliteDb | undefined;
  const DEFAULT_SCOPE = {
    tenant_id: DEFAULT_TENANT_ID,
    agent_id: DEFAULT_AGENT_ID,
    workspace_id: DEFAULT_WORKSPACE_ID,
  } as const;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("enqueues a channel notification routed via last_active_session_key", async () => {
    db = openTestSqliteDb();
    const workboard = new WorkboardDal(db);
    const inbox = new ChannelInboxDal(db);

    const scope = DEFAULT_SCOPE;
    const sessionKey = "agent:default:telegram:default:dm:chat-1";

    await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-1",
      key: sessionKey,
      lane: "main",
      received_at_ms: 1_000,
      payload: { kind: "test" },
    });

    await workboard.upsertScopeActivity({
      scope,
      last_active_session_key: sessionKey,
      updated_at_ms: 1_000,
    });

    const item = await workboard.createItem({
      scope,
      item: {
        kind: "action",
        title: "Ship notifications",
        created_from_session_key: "agent:default:main",
      },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    await workboard.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "ready",
      occurredAtIso: "2026-02-27T00:00:00.500Z",
      reason: "triaged",
    });

    await workboard.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "doing",
      occurredAtIso: "2026-02-27T00:00:00.750Z",
      reason: "started",
    });

    const transitioned = await workboard.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "done",
      occurredAtIso: "2026-02-27T00:00:01.000Z",
      reason: "completed",
    });
    expect(transitioned).toBeDefined();

    await enqueueWorkItemStateChangeNotification({
      db,
      scope,
      item: transitioned!,
    });

    const outboxCount = await db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM channel_outbox",
    );
    expect(outboxCount?.count).toBe(1);

    await enqueueWorkItemStateChangeNotification({
      db,
      scope,
      item: transitioned!,
    });

    const outboxCount2 = await db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM channel_outbox",
    );
    expect(outboxCount2?.count).toBe(1);

    const outbox = await db.get<{ source: string; thread_id: string }>(
      "SELECT source, thread_id FROM channel_outbox LIMIT 1",
    );
    expect(outbox).toMatchObject({ source: "telegram:default", thread_id: "chat-1" });
  });

  it("skips channel notifications when send_policy override is off", async () => {
    db = openTestSqliteDb();
    const workboard = new WorkboardDal(db);
    const inbox = new ChannelInboxDal(db);

    const scope = DEFAULT_SCOPE;
    const sessionKey = "agent:default:telegram:default:dm:chat-1";

    await db.run(
      `INSERT INTO session_send_policy_overrides (tenant_id, key, send_policy, updated_at_ms)
       VALUES (?, ?, ?, ?)`,
      [scope.tenant_id, sessionKey, "off", 1_000],
    );

    await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-1",
      key: sessionKey,
      lane: "main",
      received_at_ms: 1_000,
      payload: { kind: "test" },
    });

    await workboard.upsertScopeActivity({
      scope,
      last_active_session_key: sessionKey,
      updated_at_ms: 1_000,
    });

    const item = await workboard.createItem({
      scope,
      item: {
        kind: "action",
        title: "Ship notifications",
        created_from_session_key: "agent:default:main",
      },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    await workboard.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "ready",
      occurredAtIso: "2026-02-27T00:00:00.500Z",
      reason: "triaged",
    });

    await workboard.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "doing",
      occurredAtIso: "2026-02-27T00:00:00.750Z",
      reason: "started",
    });

    const transitioned = await workboard.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "done",
      occurredAtIso: "2026-02-27T00:00:01.000Z",
      reason: "completed",
    });
    expect(transitioned).toBeDefined();

    const res = await enqueueWorkItemStateChangeNotification({
      db,
      scope,
      item: transitioned!,
    });
    expect(res).toMatchObject({ enqueued: false });

    const outboxCount = await db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM channel_outbox",
    );
    expect(outboxCount?.count).toBe(0);
  });

  it("approval-gates notifications when policy requires approval", async () => {
    db = openTestSqliteDb();
    const workboard = new WorkboardDal(db);
    const inbox = new ChannelInboxDal(db);
    const approvals = new ApprovalDal(db);

    const scope = DEFAULT_SCOPE;
    const sessionKey = "agent:default:telegram:default:dm:chat-1";

    await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-1",
      key: sessionKey,
      lane: "main",
      received_at_ms: 1_000,
      payload: { kind: "test" },
    });

    await workboard.upsertScopeActivity({
      scope,
      last_active_session_key: sessionKey,
      updated_at_ms: 1_000,
    });

    const item = await workboard.createItem({
      scope,
      item: {
        kind: "action",
        title: "Ship notifications",
        created_from_session_key: "agent:default:main",
      },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    await workboard.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "ready",
      occurredAtIso: "2026-02-27T00:00:00.500Z",
      reason: "triaged",
    });

    await workboard.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "doing",
      occurredAtIso: "2026-02-27T00:00:00.750Z",
      reason: "started",
    });

    const transitioned = await workboard.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "done",
      occurredAtIso: "2026-02-27T00:00:01.000Z",
      reason: "completed",
    });
    expect(transitioned).toBeDefined();

    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => false,
      evaluateConnectorAction: vi.fn(async () => ({
        decision: "require_approval",
        policy_snapshot: { policy_snapshot_id: "snap-1" },
        applied_override_ids: undefined,
      })),
    } as unknown as PolicyService;

    const res = await enqueueWorkItemStateChangeNotification({
      db,
      scope,
      item: transitioned!,
      approvalDal: approvals,
      policyService,
    });
    expect(res.enqueued).toBe(true);

    const outboxRow = await db.get<{ approval_id: string | null }>(
      "SELECT approval_id FROM channel_outbox LIMIT 1",
    );
    expect(outboxRow?.approval_id).not.toBeNull();

    const approvalRow = await db.get<{ kind: string }>("SELECT kind FROM approvals LIMIT 1");
    expect(approvalRow?.kind).toBe("connector.send");
  });

  it("does not allow outbox claiming between enqueue and approval assignment", async () => {
    db = openTestSqliteDb();
    const workboard = new WorkboardDal(db);
    const inbox = new ChannelInboxDal(db);
    const approvals = new ApprovalDal(db);

    const scope = DEFAULT_SCOPE;
    const sessionKey = "agent:default:telegram:default:dm:chat-1";

    await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-1",
      key: sessionKey,
      lane: "main",
      received_at_ms: 1_000,
      payload: { kind: "test" },
    });

    await workboard.upsertScopeActivity({
      scope,
      last_active_session_key: sessionKey,
      updated_at_ms: 1_000,
    });

    const item = await workboard.createItem({
      scope,
      item: {
        kind: "action",
        title: "Ship notifications",
        created_from_session_key: "agent:default:main",
      },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    await workboard.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "ready",
      occurredAtIso: "2026-02-27T00:00:00.500Z",
      reason: "triaged",
    });

    await workboard.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "doing",
      occurredAtIso: "2026-02-27T00:00:00.750Z",
      reason: "started",
    });

    const transitioned = await workboard.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "done",
      occurredAtIso: "2026-02-27T00:00:01.000Z",
      reason: "completed",
    });
    expect(transitioned).toBeDefined();

    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => false,
      evaluateConnectorAction: vi.fn(async () => ({
        decision: "require_approval",
        policy_snapshot: { policy_snapshot_id: "snap-1" },
        applied_override_ids: undefined,
      })),
    } as unknown as PolicyService;

    const originalEnqueue = ChannelOutboxDal.prototype.enqueue;
    let claimedBetween: unknown;

    vi.spyOn(ChannelOutboxDal.prototype, "enqueue").mockImplementationOnce(async function (input) {
      const res = await originalEnqueue.call(this, input);
      claimedBetween = await new ChannelOutboxDal((this as any)["db"]).claimNextGlobal({
        owner: "race",
        now_ms: Date.now(),
        lease_ttl_ms: 60_000,
      });
      return res;
    });

    const res = await enqueueWorkItemStateChangeNotification({
      db,
      scope,
      item: transitioned!,
      approvalDal: approvals,
      policyService,
    });
    expect(res.enqueued).toBe(true);
    expect(claimedBetween).toBeUndefined();
  });

  it("skips notifications when policy denies outbound send", async () => {
    db = openTestSqliteDb();
    const workboard = new WorkboardDal(db);
    const inbox = new ChannelInboxDal(db);

    const scope = DEFAULT_SCOPE;
    const sessionKey = "agent:default:telegram:default:dm:chat-1";

    await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-1",
      key: sessionKey,
      lane: "main",
      received_at_ms: 1_000,
      payload: { kind: "test" },
    });

    await workboard.upsertScopeActivity({
      scope,
      last_active_session_key: sessionKey,
      updated_at_ms: 1_000,
    });

    const item = await workboard.createItem({
      scope,
      item: {
        kind: "action",
        title: "Ship notifications",
        created_from_session_key: "agent:default:main",
      },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    await workboard.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "ready",
      occurredAtIso: "2026-02-27T00:00:00.500Z",
      reason: "triaged",
    });

    await workboard.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "doing",
      occurredAtIso: "2026-02-27T00:00:00.750Z",
      reason: "started",
    });

    const transitioned = await workboard.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "done",
      occurredAtIso: "2026-02-27T00:00:01.000Z",
      reason: "completed",
    });
    expect(transitioned).toBeDefined();

    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => false,
      evaluateConnectorAction: vi.fn(async () => ({
        decision: "deny",
        policy_snapshot: { policy_snapshot_id: "snap-1" },
        applied_override_ids: undefined,
      })),
    } as unknown as PolicyService;

    const res = await enqueueWorkItemStateChangeNotification({
      db,
      scope,
      item: transitioned!,
      policyService,
    });
    expect(res.enqueued).toBe(false);

    const outboxCount = await db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM channel_outbox",
    );
    expect(outboxCount?.count).toBe(0);
  });

  it("falls back to created_from_session_key when last_active_session_key is unknown", async () => {
    db = openTestSqliteDb();
    const workboard = new WorkboardDal(db);
    const inbox = new ChannelInboxDal(db);

    const scope = DEFAULT_SCOPE;
    const sessionKey = "agent:default:telegram:default:dm:chat-1";

    await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-1",
      key: sessionKey,
      lane: "main",
      received_at_ms: 1_000,
      payload: { kind: "test" },
    });

    const item = await workboard.createItem({
      scope,
      item: {
        kind: "action",
        title: "Ship notifications",
        created_from_session_key: sessionKey,
      },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    await workboard.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "ready",
      occurredAtIso: "2026-02-27T00:00:00.500Z",
      reason: "triaged",
    });

    await workboard.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "doing",
      occurredAtIso: "2026-02-27T00:00:00.750Z",
      reason: "started",
    });

    const transitioned = await workboard.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "done",
      occurredAtIso: "2026-02-27T00:00:01.000Z",
      reason: "completed",
    });

    const res = await enqueueWorkItemStateChangeNotification({
      db,
      scope,
      item: transitioned!,
    });
    expect(res.enqueued).toBe(true);

    const outboxCount = await db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM channel_outbox",
    );
    expect(outboxCount?.count).toBe(1);
  });
});
