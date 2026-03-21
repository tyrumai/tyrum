import { expect, it } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { makeDeps, makeClient, markWorkItemDispatchReady } from "./ws-workboard.test-support.js";

function registerCreateAndOverlapTests(): void {
  it("handles work.create and broadcasts work.item.created", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const res = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-1",
          type: "work.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            item: { kind: "action", title: "Hello" },
          },
        }),
        deps,
      );

      expect(res).toBeDefined();
      expect((res as unknown as { ok: boolean }).ok).toBe(true);
      expect((res as unknown as { type: string }).type).toBe("work.create");

      const item = (res as unknown as { result: { item: { work_item_id: string; title: string } } })
        .result.item;
      expect(item.title).toBe("Hello");

      expect(ws.send).toHaveBeenCalledTimes(1);
      const evt = JSON.parse(ws.send.mock.calls[0]?.[0] ?? "{}") as {
        type?: string;
        payload?: any;
      };
      expect(evt.type).toBe("work.item.created");
      expect(evt.payload?.item?.work_item_id).toBe(item.work_item_id);
    } finally {
      await db.close();
    }
  });

  it("emits an overlap warning artifact when a new work item overlaps with active work", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const create1Res = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-create-1",
          type: "work.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            item: {
              kind: "action",
              title: "Item 1",
              fingerprint: { resources: ["path:packages/gateway"] },
            },
          },
        }),
        deps,
      );
      expect((create1Res as unknown as { ok: boolean }).ok).toBe(true);
      const item1Id = (create1Res as unknown as { result: { item: { work_item_id: string } } })
        .result.item.work_item_id;
      await markWorkItemDispatchReady(db, item1Id);
      ws.send.mockClear();

      const triageRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-triage-1",
          type: "work.transition",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: item1Id,
            status: "ready",
          },
        }),
        deps,
      );
      expect((triageRes as unknown as { ok: boolean }).ok).toBe(true);
      ws.send.mockClear();

      const transitionRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-transition-1",
          type: "work.transition",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: item1Id,
            status: "doing",
          },
        }),
        deps,
      );
      expect((transitionRes as unknown as { ok: boolean }).ok).toBe(true);
      ws.send.mockClear();

      const create2Res = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-create-2",
          type: "work.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            item: {
              kind: "action",
              title: "Item 2",
              fingerprint: { resources: ["path:packages/gateway"] },
            },
          },
        }),
        deps,
      );

      expect((create2Res as unknown as { ok: boolean }).ok).toBe(true);
      const item2Id = (create2Res as unknown as { result: { item: { work_item_id: string } } })
        .result.item.work_item_id;

      const eventTypes = ws.send.mock.calls.map((c) => JSON.parse(c[0] ?? "{}")?.type);
      expect(eventTypes).toContain("work.item.created");
      expect(eventTypes).toContain("work.artifact.created");

      const overlapEvt = ws.send.mock.calls
        .map((c) => JSON.parse(c[0] ?? "{}") as { type?: string; payload?: any })
        .find((e) => e.type === "work.artifact.created");
      expect(overlapEvt?.payload?.artifact?.kind).toBe("risk");
      expect(overlapEvt?.payload?.artifact?.work_item_id).toBe(item2Id);
      expect(String(overlapEvt?.payload?.artifact?.body_md ?? "")).toContain(item1Id);
    } finally {
      await db.close();
    }
  });

  it("emits an overlap warning artifact when a fingerprint is added during triage", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const create1Res = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-create-1",
          type: "work.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            item: {
              kind: "action",
              title: "Item 1",
              fingerprint: { resources: ["path:packages/gateway"] },
            },
          },
        }),
        deps,
      );
      expect((create1Res as unknown as { ok: boolean }).ok).toBe(true);
      const item1Id = (create1Res as unknown as { result: { item: { work_item_id: string } } })
        .result.item.work_item_id;
      await markWorkItemDispatchReady(db, item1Id);
      ws.send.mockClear();

      const triageRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-triage-1",
          type: "work.transition",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: item1Id,
            status: "ready",
          },
        }),
        deps,
      );
      expect((triageRes as unknown as { ok: boolean }).ok).toBe(true);
      ws.send.mockClear();

      const doingRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-doing-1",
          type: "work.transition",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: item1Id,
            status: "doing",
          },
        }),
        deps,
      );
      expect((doingRes as unknown as { ok: boolean }).ok).toBe(true);
      ws.send.mockClear();

      const create2Res = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-create-2",
          type: "work.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            item: { kind: "action", title: "Item 2" },
          },
        }),
        deps,
      );
      expect((create2Res as unknown as { ok: boolean }).ok).toBe(true);
      const item2Id = (create2Res as unknown as { result: { item: { work_item_id: string } } })
        .result.item.work_item_id;
      ws.send.mockClear();

      const updateRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-update-2",
          type: "work.update",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: item2Id,
            patch: { fingerprint: { resources: ["path:packages/gateway"] } },
          },
        }),
        deps,
      );
      expect((updateRes as unknown as { ok: boolean }).ok).toBe(true);

      const eventTypes = ws.send.mock.calls.map((c) => JSON.parse(c[0] ?? "{}")?.type);
      expect(eventTypes).toContain("work.item.updated");
      expect(eventTypes).toContain("work.artifact.created");

      const overlapEvt = ws.send.mock.calls
        .map((c) => JSON.parse(c[0] ?? "{}") as { type?: string; payload?: any })
        .find((e) => e.type === "work.artifact.created");
      expect(overlapEvt?.payload?.artifact?.kind).toBe("risk");
      expect(overlapEvt?.payload?.artifact?.work_item_id).toBe(item2Id);
      expect(String(overlapEvt?.payload?.artifact?.body_md ?? "")).toContain(item1Id);
    } finally {
      await db.close();
    }
  });
}

function registerLinkAndListTests(): void {
  it("handles work.link.create/list and broadcasts work.link.created", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const createARes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-create-a",
          type: "work.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            item: { kind: "action", title: "Item A" },
          },
        }),
        deps,
      );
      expect((createARes as unknown as { ok: boolean }).ok).toBe(true);
      const itemAId = (createARes as unknown as { result: { item: { work_item_id: string } } })
        .result.item.work_item_id;

      const createBRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-create-b",
          type: "work.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            item: { kind: "action", title: "Item B" },
          },
        }),
        deps,
      );
      expect((createBRes as unknown as { ok: boolean }).ok).toBe(true);
      const itemBId = (createBRes as unknown as { result: { item: { work_item_id: string } } })
        .result.item.work_item_id;

      ws.send.mockClear();

      const createLinkRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-link-create",
          type: "work.link.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: itemBId,
            linked_work_item_id: itemAId,
            kind: "depends_on",
          },
        }),
        deps,
      );
      expect((createLinkRes as unknown as { ok: boolean }).ok).toBe(true);
      expect((createLinkRes as unknown as { type: string }).type).toBe("work.link.create");
      expect(
        (createLinkRes as unknown as { result: { link: { work_item_id: string } } }).result.link
          .work_item_id,
      ).toBe(itemBId);

      expect(ws.send).toHaveBeenCalledTimes(1);
      const createdEvt = JSON.parse(ws.send.mock.calls[0]?.[0] ?? "{}") as {
        type?: string;
        payload?: any;
      };
      expect(createdEvt.type).toBe("work.link.created");
      expect(createdEvt.payload?.link?.work_item_id).toBe(itemBId);
      expect(createdEvt.payload?.link?.linked_work_item_id).toBe(itemAId);
      expect(createdEvt.payload?.link?.kind).toBe("depends_on");

      ws.send.mockClear();

      const listRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-link-list",
          type: "work.link.list",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: itemBId,
          },
        }),
        deps,
      );
      expect((listRes as unknown as { ok: boolean }).ok).toBe(true);
      expect((listRes as unknown as { type: string }).type).toBe("work.link.list");
      const links = (listRes as unknown as { result: { links: any[] } }).result.links;
      expect(links).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            work_item_id: itemBId,
            linked_work_item_id: itemAId,
            kind: "depends_on",
          }),
        ]),
      );
      expect(ws.send).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });

  it("does not broadcast work.* events to non-client WS roles", async () => {
    const cm = new ConnectionManager();
    const { id: operatorId, ws: operatorWs } = makeClient(cm);
    const { ws: nodeWs } = makeClient(cm, { role: "node" });
    const client = cm.getClient(operatorId)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });
      const res = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-1",
          type: "work.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            item: { kind: "action", title: "Hello" },
          },
        }),
        deps,
      );

      expect((res as unknown as { ok: boolean }).ok).toBe(true);
      expect(operatorWs.send).toHaveBeenCalledTimes(1);
      expect(nodeWs.send).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });

  it("handles work.list against the DB", async () => {
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
      ws.send.mockClear();

      const listRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-list",
          type: "work.list",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
          },
        }),
        deps,
      );

      expect(listRes).toBeDefined();
      expect((listRes as unknown as { ok: boolean }).ok).toBe(true);
      const parsed = listRes as unknown as {
        result: {
          scope: { workspace_id: string };
          items: Array<{ title: string }>;
        };
      };
      expect(parsed.result.scope.workspace_id).toEqual(expect.any(String));
      const items = parsed.result.items;
      expect(items.map((i) => i.title)).toContain("Item 1");
      expect(ws.send).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });
}

export function registerWorkboardCrudTests(): void {
  registerCreateAndOverlapTests();
  registerLinkAndListTests();
}
