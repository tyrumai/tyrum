import { expect, it } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { makeDeps, makeClient } from "./ws-workboard.test-support.js";

function registerGetAndTransitionTests(): void {
  it("handles work.get against the DB", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const createRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-create",
          type: "work.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            item: { kind: "action", title: "Item 1" },
          },
        }),
        deps,
      );
      expect((createRes as unknown as { ok: boolean }).ok).toBe(true);
      const createdId = (createRes as unknown as { result: { item: { work_item_id: string } } })
        .result.item.work_item_id;
      ws.send.mockClear();

      const getRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-get",
          type: "work.get",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: createdId,
          },
        }),
        deps,
      );

      expect(getRes).toBeDefined();
      expect((getRes as unknown as { ok: boolean }).ok).toBe(true);
      const got = (getRes as unknown as { result: { item: { work_item_id: string } } }).result.item;
      expect(got.work_item_id).toBe(createdId);
      expect(ws.send).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });

  it("handles work.update and broadcasts work.item.updated", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const createRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-create",
          type: "work.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            item: { kind: "action", title: "Item 1" },
          },
        }),
        deps,
      );
      expect((createRes as unknown as { ok: boolean }).ok).toBe(true);
      const createdId = (createRes as unknown as { result: { item: { work_item_id: string } } })
        .result.item.work_item_id;
      ws.send.mockClear();

      const updateRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-update",
          type: "work.update",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: createdId,
            patch: { title: "Updated" },
          },
        }),
        deps,
      );

      expect(updateRes).toBeDefined();
      expect((updateRes as unknown as { ok: boolean }).ok).toBe(true);
      const updated = (updateRes as unknown as { result: { item: { title: string } } }).result.item;
      expect(updated.title).toBe("Updated");

      expect(ws.send).toHaveBeenCalledTimes(1);
      const evt = JSON.parse(ws.send.mock.calls[0]?.[0] ?? "{}") as {
        type?: string;
        payload?: any;
      };
      expect(evt.type).toBe("work.item.updated");
      expect(evt.payload?.item?.work_item_id).toBe(createdId);
    } finally {
      await db.close();
    }
  });

  it("handles work.transition and broadcasts work.item.blocked", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const createRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-create",
          type: "work.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            item: { kind: "action", title: "Item 1" },
          },
        }),
        deps,
      );
      expect((createRes as unknown as { ok: boolean }).ok).toBe(true);
      const createdId = (createRes as unknown as { result: { item: { work_item_id: string } } })
        .result.item.work_item_id;
      ws.send.mockClear();

      const readyRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-ready",
          type: "work.transition",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: createdId,
            status: "ready",
            reason: "triage",
          },
        }),
        deps,
      );

      expect(readyRes).toBeDefined();
      expect((readyRes as unknown as { ok: boolean }).ok).toBe(true);

      const transitionRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-transition",
          type: "work.transition",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: createdId,
            status: "doing",
            reason: "start",
          },
        }),
        deps,
      );

      expect(transitionRes).toBeDefined();
      expect((transitionRes as unknown as { ok: boolean }).ok).toBe(true);
      const doingStatus = (transitionRes as unknown as { result: { item: { status: string } } })
        .result.item.status;
      expect(doingStatus).toBe("doing");

      const blockRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-block",
          type: "work.transition",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: createdId,
            status: "blocked",
            reason: "waiting",
          },
        }),
        deps,
      );

      expect(blockRes).toBeDefined();
      expect((blockRes as unknown as { ok: boolean }).ok).toBe(true);
      const status = (blockRes as unknown as { result: { item: { status: string } } }).result.item
        .status;
      expect(status).toBe("blocked");

      expect(ws.send).toHaveBeenCalledTimes(3);
      const blockedEvt = JSON.parse(
        ws.send.mock.calls[ws.send.mock.calls.length - 1]?.[0] ?? "{}",
      ) as {
        type?: string;
        payload?: any;
      };
      expect(blockedEvt.type).toBe("work.item.blocked");
      expect(blockedEvt.payload?.item?.work_item_id).toBe(createdId);
    } finally {
      await db.close();
    }
  });
}

function registerTransitionErrorTests(): void {
  it("rejects invalid work transitions with structured errors", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });
      const createRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-create",
          type: "work.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            item: { kind: "action", title: "Item 1" },
          },
        }),
        deps,
      );
      expect((createRes as unknown as { ok: boolean }).ok).toBe(true);
      const createdId = (createRes as unknown as { result: { item: { work_item_id: string } } })
        .result.item.work_item_id;

      const transitionRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-transition",
          type: "work.transition",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: createdId,
            status: "doing",
          },
        }),
        deps,
      );

      expect((transitionRes as unknown as { ok: boolean }).ok).toBe(false);
      const err = (transitionRes as unknown as { error: { code: string; details?: unknown } })
        .error;
      expect(err.code).toBe("invalid_transition");
      expect((err.details as { from?: string; to?: string } | undefined)?.from).toBe("backlog");
      expect((err.details as { from?: string; to?: string } | undefined)?.to).toBe("doing");
    } finally {
      await db.close();
    }
  });

  it("rejects work.transition to doing when the readiness gate no longer passes", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });
      const workboard = new WorkboardDal(db);
      const scope = {
        tenant_id: DEFAULT_TENANT_ID,
        agent_id: DEFAULT_AGENT_ID,
        workspace_id: DEFAULT_WORKSPACE_ID,
      } as const;
      const item = await workboard.createItem({
        scope,
        createdFromSessionKey: "agent:default:test:default:channel:thread-ws-doing-gate",
        item: { kind: "action", title: "WS doing gate", acceptance: { done: true } },
      });
      await workboard.setStateKv({
        scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
        key: "work.refinement.phase",
        value_json: "done",
        provenance_json: { source: "test" },
      });
      await workboard.setStateKv({
        scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
        key: "work.size.class",
        value_json: "small",
        provenance_json: { source: "test" },
      });
      await workboard.transitionItem({ scope, work_item_id: item.work_item_id, status: "ready" });
      await workboard.transitionItem({ scope, work_item_id: item.work_item_id, status: "doing" });
      await workboard.transitionItem({
        scope,
        work_item_id: item.work_item_id,
        status: "blocked",
        reason: "waiting on triage",
      });
      await workboard.deleteStateKv({
        scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
        key: "work.size.class",
      });
      ws.send.mockClear();

      const transitionRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-doing-gate",
          type: "work.transition",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: item.work_item_id,
            status: "doing",
          },
        }),
        deps,
      );

      expect((transitionRes as unknown as { ok: boolean }).ok).toBe(false);
      const err = (transitionRes as unknown as { error: { code: string; details?: unknown } })
        .error;
      expect(err.code).toBe("readiness_gate_failed");
      expect(
        err.details as { from?: string; to?: string; reasons?: string[] } | undefined,
      ).toMatchObject({
        from: "blocked",
        to: "doing",
        reasons: ["size_missing"],
      });
      expect(ws.send).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });

  it("broadcasts work.item.failed on failed transitions", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const createRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-create",
          type: "work.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            item: { kind: "action", title: "Item 1" },
          },
        }),
        deps,
      );
      expect((createRes as unknown as { ok: boolean }).ok).toBe(true);
      const createdId = (createRes as unknown as { result: { item: { work_item_id: string } } })
        .result.item.work_item_id;
      ws.send.mockClear();

      await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-ready",
          type: "work.transition",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: createdId,
            status: "ready",
            reason: "triage",
          },
        }),
        deps,
      );

      await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-doing",
          type: "work.transition",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: createdId,
            status: "doing",
            reason: "start",
          },
        }),
        deps,
      );

      const failRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-failed",
          type: "work.transition",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: createdId,
            status: "failed",
            reason: "boom",
          },
        }),
        deps,
      );

      expect((failRes as unknown as { ok: boolean }).ok).toBe(true);
      expect(ws.send).toHaveBeenCalledTimes(3);

      const failedEvt = JSON.parse(
        ws.send.mock.calls[ws.send.mock.calls.length - 1]?.[0] ?? "{}",
      ) as {
        type?: string;
        payload?: any;
      };
      expect(failedEvt.type).toBe("work.item.failed");
      expect(failedEvt.payload?.item?.work_item_id).toBe(createdId);
    } finally {
      await db.close();
    }
  });

  it("broadcasts work.item.cancelled when cancelling a ready work item", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const createRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-create",
          type: "work.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            item: { kind: "action", title: "Item 1" },
          },
        }),
        deps,
      );
      expect((createRes as unknown as { ok: boolean }).ok).toBe(true);
      const createdId = (createRes as unknown as { result: { item: { work_item_id: string } } })
        .result.item.work_item_id;
      ws.send.mockClear();

      await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-ready",
          type: "work.transition",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: createdId,
            status: "ready",
          },
        }),
        deps,
      );

      const cancelRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-cancel",
          type: "work.transition",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: createdId,
            status: "cancelled",
            reason: "operator cancelled",
          },
        }),
        deps,
      );

      expect((cancelRes as unknown as { ok: boolean }).ok).toBe(true);
      expect(ws.send).toHaveBeenCalledTimes(2);

      const cancelledEvt = JSON.parse(
        ws.send.mock.calls[ws.send.mock.calls.length - 1]?.[0] ?? "{}",
      ) as {
        type?: string;
        payload?: any;
      };
      expect(cancelledEvt.type).toBe("work.item.cancelled");
      expect(cancelledEvt.payload?.item?.work_item_id).toBe(createdId);
    } finally {
      await db.close();
    }
  });
}

export function registerWorkboardTransitionTests(): void {
  registerGetAndTransitionTests();
  registerTransitionErrorTests();
}
