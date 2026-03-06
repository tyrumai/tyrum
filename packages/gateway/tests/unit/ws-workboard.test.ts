import { describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import type { ProtocolDeps } from "../../src/ws/protocol.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

interface MockWebSocket {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  readyState: number;
}

function createMockWs(): MockWebSocket {
  return {
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(() => undefined as never),
    readyState: 1,
  };
}

function makeDeps(cm: ConnectionManager, overrides?: Partial<ProtocolDeps>): ProtocolDeps {
  return { connectionManager: cm, ...overrides };
}

function makeClient(
  cm: ConnectionManager,
  opts?: { authClaims?: unknown; role?: "client" | "node" },
): { id: string; ws: MockWebSocket } {
  const ws = createMockWs();
  const authClaims =
    opts?.authClaims ??
    ({
      token_kind: "admin",
      token_id: "token-1",
      tenant_id: DEFAULT_TENANT_ID,
      role: "admin",
      scopes: ["*"],
    } as const);
  const id = cm.addClient(
    ws as never,
    [] as never,
    {
      authClaims,
      role: opts?.role,
    } as never,
  );
  return { id, ws };
}

describe("handleClientMessage (work.*)", () => {
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
      const items = (listRes as unknown as { result: { items: Array<{ title: string }> } }).result
        .items;
      expect(items.map((i) => i.title)).toContain("Item 1");
      expect(ws.send).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });

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

  it("enqueues a channel completion notification when last_active_session_key is a channel session", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });
      const inbox = new ChannelInboxDal(db);
      const channelKey = "agent:default:telegram:default:dm:chat-1";

      await inbox.enqueue({
        source: "telegram:default",
        thread_id: "chat-1",
        message_id: "msg-1",
        key: channelKey,
        lane: "main",
        received_at_ms: 1_000,
        payload: { kind: "test" },
      });

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

      const doneRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-done",
          type: "work.transition",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: createdId,
            status: "done",
            reason: "complete",
          },
        }),
        deps,
      );
      expect((doneRes as unknown as { ok: boolean }).ok).toBe(true);

      const outboxCount = await db.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM channel_outbox",
      );
      expect(outboxCount?.count).toBe(1);
    } finally {
      await db.close();
    }
  });

  it("enforces WIP limit across transition requests", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const created = await Promise.all(
        ["Item 1", "Item 2", "Item 3"].map(async (title, idx) => {
          const res = await handleClientMessage(
            client,
            JSON.stringify({
              request_id: `r-create-${idx}`,
              type: "work.create",
              payload: {
                tenant_key: "default",
                agent_key: "default",
                workspace_key: "default",
                item: { kind: "action", title },
              },
            }),
            deps,
          );
          expect((res as unknown as { ok: boolean }).ok).toBe(true);
          return (res as unknown as { result: { item: { work_item_id: string } } }).result.item
            .work_item_id;
        }),
      );

      for (const [idx, idItem] of created.entries()) {
        const readyRes = await handleClientMessage(
          client,
          JSON.stringify({
            request_id: `r-ready-${idx}`,
            type: "work.transition",
            payload: {
              tenant_key: "default",
              agent_key: "default",
              workspace_key: "default",
              work_item_id: idItem,
              status: "ready",
            },
          }),
          deps,
        );
        expect((readyRes as unknown as { ok: boolean }).ok).toBe(true);
      }

      ws.send.mockClear();
      const transitions = [
        await handleClientMessage(
          client,
          JSON.stringify({
            request_id: "r-transition-0",
            type: "work.transition",
            payload: {
              tenant_key: "default",
              agent_key: "default",
              workspace_key: "default",
              work_item_id: created[0]!,
              status: "doing",
              reason: "claim",
            },
          }),
          deps,
        ),
        await handleClientMessage(
          client,
          JSON.stringify({
            request_id: "r-transition-1",
            type: "work.transition",
            payload: {
              tenant_key: "default",
              agent_key: "default",
              workspace_key: "default",
              work_item_id: created[1]!,
              status: "doing",
              reason: "claim",
            },
          }),
          deps,
        ),
        await handleClientMessage(
          client,
          JSON.stringify({
            request_id: "r-transition-2",
            type: "work.transition",
            payload: {
              tenant_key: "default",
              agent_key: "default",
              workspace_key: "default",
              work_item_id: created[2]!,
              status: "doing",
              reason: "claim",
            },
          }),
          deps,
        ),
      ];

      const ok = transitions.filter((res) => (res as { ok: boolean }).ok);
      const errCount = transitions.filter((res) => !(res as { ok: boolean }).ok).length;
      expect(ok.length).toBe(2);
      expect(errCount).toBe(1);
      const err = transitions
        .map((res) => (res as { error?: { code: string } }).error)
        .find((error) => error);
      expect(err?.code).toBe("wip_limit_exceeded");
      expect((err as { details?: { limit?: number } } | undefined)?.details?.limit).toBe(2);
      expect(ws.send).toHaveBeenCalledTimes(2);
    } finally {
      await db.close();
    }
  });

  it("handles work.artifact.create/list/get and broadcasts work.artifact.created", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const createRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-artifact-create",
          type: "work.artifact.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            artifact: { kind: "hypothesis", title: "A1", body_md: "Hello" },
          },
        }),
        deps,
      );

      expect(createRes).toBeDefined();
      expect((createRes as unknown as { ok: boolean }).ok).toBe(true);
      const artifact = (
        createRes as unknown as { result: { artifact: { artifact_id: string; title: string } } }
      ).result.artifact;
      expect(artifact.title).toBe("A1");

      expect(ws.send).toHaveBeenCalledTimes(1);
      const createdEvt = JSON.parse(ws.send.mock.calls[0]?.[0] ?? "{}") as {
        type?: string;
        payload?: any;
      };
      expect(createdEvt.type).toBe("work.artifact.created");
      expect(createdEvt.payload?.artifact?.artifact_id).toBe(artifact.artifact_id);
      ws.send.mockClear();

      const listRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-artifact-list",
          type: "work.artifact.list",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
          },
        }),
        deps,
      );
      expect((listRes as unknown as { ok: boolean }).ok).toBe(true);
      const titles = (
        listRes as unknown as { result: { artifacts: Array<{ title: string }> } }
      ).result.artifacts.map((a) => a.title);
      expect(titles).toContain("A1");
      expect(ws.send).not.toHaveBeenCalled();

      const getRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-artifact-get",
          type: "work.artifact.get",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            artifact_id: artifact.artifact_id,
          },
        }),
        deps,
      );
      expect((getRes as unknown as { ok: boolean }).ok).toBe(true);
      const got = (getRes as unknown as { result: { artifact: { artifact_id: string } } }).result
        .artifact;
      expect(got.artifact_id).toBe(artifact.artifact_id);
      expect(ws.send).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });

  it("handles work.decision.create/list/get and broadcasts work.decision.created", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const createRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-decision-create",
          type: "work.decision.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            decision: {
              question: "Q1",
              chosen: "A1",
              rationale_md: "Because.",
            },
          },
        }),
        deps,
      );

      expect((createRes as unknown as { ok: boolean }).ok).toBe(true);
      const decision = (
        createRes as unknown as { result: { decision: { decision_id: string; question: string } } }
      ).result.decision;
      expect(decision.question).toBe("Q1");

      expect(ws.send).toHaveBeenCalledTimes(1);
      const createdEvt = JSON.parse(ws.send.mock.calls[0]?.[0] ?? "{}") as {
        type?: string;
        payload?: any;
      };
      expect(createdEvt.type).toBe("work.decision.created");
      expect(createdEvt.payload?.decision?.decision_id).toBe(decision.decision_id);
      ws.send.mockClear();

      const listRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-decision-list",
          type: "work.decision.list",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
          },
        }),
        deps,
      );
      expect((listRes as unknown as { ok: boolean }).ok).toBe(true);
      const questions = (
        listRes as unknown as { result: { decisions: Array<{ question: string }> } }
      ).result.decisions.map((d) => d.question);
      expect(questions).toContain("Q1");
      expect(ws.send).not.toHaveBeenCalled();

      const getRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-decision-get",
          type: "work.decision.get",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            decision_id: decision.decision_id,
          },
        }),
        deps,
      );
      expect((getRes as unknown as { ok: boolean }).ok).toBe(true);
      const got = (getRes as unknown as { result: { decision: { decision_id: string } } }).result
        .decision;
      expect(got.decision_id).toBe(decision.decision_id);
      expect(ws.send).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });

  it("handles work.signal.create/list/get/update and broadcasts work.signal.* events", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const createRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-signal-create",
          type: "work.signal.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            signal: {
              trigger_kind: "event",
              trigger_spec_json: { topic: "t1" },
              payload_json: { hello: true },
            },
          },
        }),
        deps,
      );

      expect((createRes as unknown as { ok: boolean }).ok).toBe(true);
      const signal = (
        createRes as unknown as { result: { signal: { signal_id: string; status: string } } }
      ).result.signal;
      expect(signal.status).toBe("active");

      expect(ws.send).toHaveBeenCalledTimes(1);
      const createdEvt = JSON.parse(ws.send.mock.calls[0]?.[0] ?? "{}") as {
        type?: string;
        payload?: any;
      };
      expect(createdEvt.type).toBe("work.signal.created");
      expect(createdEvt.payload?.signal?.signal_id).toBe(signal.signal_id);
      ws.send.mockClear();

      const listRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-signal-list",
          type: "work.signal.list",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
          },
        }),
        deps,
      );
      expect((listRes as unknown as { ok: boolean }).ok).toBe(true);
      const ids = (
        listRes as unknown as { result: { signals: Array<{ signal_id: string }> } }
      ).result.signals.map((s) => s.signal_id);
      expect(ids).toContain(signal.signal_id);
      expect(ws.send).not.toHaveBeenCalled();

      const getRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-signal-get",
          type: "work.signal.get",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            signal_id: signal.signal_id,
          },
        }),
        deps,
      );
      expect((getRes as unknown as { ok: boolean }).ok).toBe(true);
      const got = (getRes as unknown as { result: { signal: { signal_id: string } } }).result
        .signal;
      expect(got.signal_id).toBe(signal.signal_id);
      expect(ws.send).not.toHaveBeenCalled();

      const updateRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-signal-update",
          type: "work.signal.update",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            signal_id: signal.signal_id,
            patch: { status: "paused" },
          },
        }),
        deps,
      );
      expect((updateRes as unknown as { ok: boolean }).ok).toBe(true);
      const updatedStatus = (updateRes as unknown as { result: { signal: { status: string } } })
        .result.signal.status;
      expect(updatedStatus).toBe("paused");

      expect(ws.send).toHaveBeenCalledTimes(1);
      const updatedEvt = JSON.parse(ws.send.mock.calls[0]?.[0] ?? "{}") as {
        type?: string;
        payload?: any;
      };
      expect(updatedEvt.type).toBe("work.signal.updated");
      expect(updatedEvt.payload?.signal?.signal_id).toBe(signal.signal_id);
      expect(updatedEvt.payload?.signal?.status).toBe("paused");

      ws.send.mockClear();
      const noOpRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-signal-update-noop",
          type: "work.signal.update",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            signal_id: signal.signal_id,
            patch: { status: "paused" },
          },
        }),
        deps,
      );
      expect((noOpRes as unknown as { ok: boolean }).ok).toBe(true);
      expect(ws.send).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });

  it("handles work.state_kv.set/get/list and broadcasts work.state_kv.updated", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const scope = {
        kind: "agent",
        tenant_key: "default",
        agent_key: "default",
        workspace_key: "default",
      };

      const setRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-kv-set",
          type: "work.state_kv.set",
          payload: { scope, key: "k1", value_json: { a: 1 } },
        }),
        deps,
      );
      expect((setRes as unknown as { ok: boolean }).ok).toBe(true);

      expect(ws.send).toHaveBeenCalledTimes(1);
      const updatedEvt = JSON.parse(ws.send.mock.calls[0]?.[0] ?? "{}") as {
        type?: string;
        payload?: any;
      };
      expect(updatedEvt.type).toBe("work.state_kv.updated");
      expect(updatedEvt.payload?.key).toBe("k1");
      expect(updatedEvt.payload?.scope).toMatchObject(scope);
      expect(typeof updatedEvt.payload?.updated_at).toBe("string");
      ws.send.mockClear();

      const getRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-kv-get",
          type: "work.state_kv.get",
          payload: { scope, key: "k1" },
        }),
        deps,
      );
      expect((getRes as unknown as { ok: boolean }).ok).toBe(true);
      const entry = (getRes as unknown as { result: { entry: { key: string; value_json: any } } })
        .result.entry;
      expect(entry.key).toBe("k1");
      expect(entry.value_json).toEqual({ a: 1 });
      expect(ws.send).not.toHaveBeenCalled();

      const listRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-kv-list",
          type: "work.state_kv.list",
          payload: { scope, prefix: "k" },
        }),
        deps,
      );
      expect((listRes as unknown as { ok: boolean }).ok).toBe(true);
      const entries = (listRes as unknown as { result: { entries: Array<{ key: string }> } }).result
        .entries;
      expect(entries.map((e) => e.key)).toContain("k1");
      expect(ws.send).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });

  it("denies work.* requests for scoped tokens without scopes (deny-by-default)", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, {
      authClaims: {
        token_kind: "device",
        role: "client",
        device_id: "device-1",
        token_id: "token-1",
        tenant_id: DEFAULT_TENANT_ID,
        scopes: [],
      },
    });
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });
      const res = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-1",
          type: "work.list",
          payload: { tenant_key: "default", agent_key: "default", workspace_key: "default" },
        }),
        deps,
      );

      expect(res).toBeDefined();
      expect((res as unknown as { ok: boolean }).ok).toBe(false);
      const err = (res as unknown as { error: { code: string; message: string } }).error;
      expect(err.code).toBe("forbidden");
      expect(err.message).toBe("insufficient scope");
    } finally {
      await db.close();
    }
  });

  it("allows work.list for scoped tokens with operator.read", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm, {
      authClaims: {
        token_kind: "device",
        role: "client",
        device_id: "device-1",
        token_id: "token-1",
        tenant_id: DEFAULT_TENANT_ID,
        scopes: ["operator.read"],
      },
    });
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });
      const res = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-1",
          type: "work.list",
          payload: { tenant_key: "default", agent_key: "default", workspace_key: "default" },
        }),
        deps,
      );

      expect(res).toBeDefined();
      expect((res as unknown as { ok: boolean }).ok).toBe(true);
      const items = (res as unknown as { result: { items: unknown[] } }).result.items;
      expect(Array.isArray(items)).toBe(true);
      expect(ws.send).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });

  it("denies work.create for scoped tokens without operator.write", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, {
      authClaims: {
        token_kind: "device",
        role: "client",
        device_id: "device-1",
        token_id: "token-1",
        tenant_id: DEFAULT_TENANT_ID,
        scopes: ["operator.read"],
      },
    });
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
      expect((res as unknown as { ok: boolean }).ok).toBe(false);
      const err = (res as unknown as { error: { code: string; message: string } }).error;
      expect(err.code).toBe("forbidden");
      expect(err.message).toBe("insufficient scope");
    } finally {
      await db.close();
    }
  });

  it("sanitizes SQL-level failures for work.* requests", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const client = cm.getClient(id)!;

    const sqlErr = Object.assign(
      new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed: work_items.work_item_id"),
      { code: "SQLITE_CONSTRAINT" as const },
    );

    const deps = makeDeps(cm, {
      db: {
        get: async () => {
          throw sqlErr;
        },
      } as never,
    });

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
    expect((res as unknown as { ok: boolean }).ok).toBe(false);
    const err = (res as unknown as { error: { code: string; message: string } }).error;
    expect(err.code).toBe("internal_error");
    expect(err.message).toBe("internal error");
  });

  it("denies work.create for non-client WS roles", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, { role: "node" });
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

      expect((res as unknown as { ok: boolean }).ok).toBe(false);
      const err = (res as unknown as { error: { code: string; message: string } }).error;
      expect(err.code).toBe("unauthorized");
      expect(err.message).toBe("only operator clients may create work items");
    } finally {
      await db.close();
    }
  });

  it("returns unsupported_request for work.create when DB is not configured", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const client = cm.getClient(id)!;

    const deps = makeDeps(cm);
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

    expect((res as unknown as { ok: boolean }).ok).toBe(false);
    const err = (res as unknown as { error: { code: string; message: string } }).error;
    expect(err.code).toBe("unsupported_request");
    expect(err.message).toBe("work.create not supported");
  });

  it("returns invalid_request for malformed work.create payloads", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
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
            item: { kind: "action" },
          },
        }),
        deps,
      );

      expect((res as unknown as { ok: boolean }).ok).toBe(false);
      const err = (res as unknown as { error: { code: string; message: string; details?: any } })
        .error;
      expect(err.code).toBe("invalid_request");
      expect(typeof err.message).toBe("string");
      expect(err.details?.issues).toBeDefined();
    } finally {
      await db.close();
    }
  });

  it("returns unsupported_request for work.list when DB is not configured", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const client = cm.getClient(id)!;

    const deps = makeDeps(cm);
    const res = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-1",
        type: "work.list",
        payload: { tenant_key: "default", agent_key: "default", workspace_key: "default" },
      }),
      deps,
    );

    expect((res as unknown as { ok: boolean }).ok).toBe(false);
    const err = (res as unknown as { error: { code: string; message: string } }).error;
    expect(err.code).toBe("unsupported_request");
    expect(err.message).toBe("work.list not supported");
  });

  it("returns not_found for work.get when the work item does not exist", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });
      const res = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-1",
          type: "work.get",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: "550e8400-e29b-41d4-a716-446655440000",
          },
        }),
        deps,
      );

      expect((res as unknown as { ok: boolean }).ok).toBe(false);
      const err = (res as unknown as { error: { code: string; message: string } }).error;
      expect(err.code).toBe("not_found");
      expect(err.message).toBe("work item not found");
    } finally {
      await db.close();
    }
  });

  it("returns unsupported_request for work.update when DB is not configured", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const client = cm.getClient(id)!;

    const deps = makeDeps(cm);
    const res = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-1",
        type: "work.update",
        payload: {
          tenant_key: "default",
          agent_key: "default",
          workspace_key: "default",
          work_item_id: "550e8400-e29b-41d4-a716-446655440000",
          patch: { title: "Updated" },
        },
      }),
      deps,
    );

    expect((res as unknown as { ok: boolean }).ok).toBe(false);
    const err = (res as unknown as { error: { code: string; message: string } }).error;
    expect(err.code).toBe("unsupported_request");
    expect(err.message).toBe("work.update not supported");
  });

  it("returns invalid_request for malformed work.update payloads", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });
      const res = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-1",
          type: "work.update",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: "550e8400-e29b-41d4-a716-446655440000",
          },
        }),
        deps,
      );

      expect((res as unknown as { ok: boolean }).ok).toBe(false);
      const err = (res as unknown as { error: { code: string; details?: any } }).error;
      expect(err.code).toBe("invalid_request");
      expect(err.details?.issues).toBeDefined();
    } finally {
      await db.close();
    }
  });

  it("returns invalid_request for malformed work.transition payloads", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });
      const res = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-1",
          type: "work.transition",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: "550e8400-e29b-41d4-a716-446655440000",
          },
        }),
        deps,
      );

      expect((res as unknown as { ok: boolean }).ok).toBe(false);
      const err = (res as unknown as { error: { code: string; details?: any } }).error;
      expect(err.code).toBe("invalid_request");
      expect(err.details?.issues).toBeDefined();
    } finally {
      await db.close();
    }
  });

  it("returns not_found for work.artifact.get when the artifact does not exist", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });
      const res = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-1",
          type: "work.artifact.get",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            artifact_id: "550e8400-e29b-41d4-a716-446655440000",
          },
        }),
        deps,
      );

      expect((res as unknown as { ok: boolean }).ok).toBe(false);
      const err = (res as unknown as { error: { code: string; message: string } }).error;
      expect(err.code).toBe("not_found");
      expect(err.message).toBe("artifact not found");
    } finally {
      await db.close();
    }
  });

  it("returns not_found for work.decision.get when the decision does not exist", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });
      const res = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-1",
          type: "work.decision.get",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            decision_id: "550e8400-e29b-41d4-a716-446655440000",
          },
        }),
        deps,
      );

      expect((res as unknown as { ok: boolean }).ok).toBe(false);
      const err = (res as unknown as { error: { code: string; message: string } }).error;
      expect(err.code).toBe("not_found");
      expect(err.message).toBe("decision not found");
    } finally {
      await db.close();
    }
  });

  it("returns not_found for work.signal.update when the signal does not exist", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });
      const res = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-1",
          type: "work.signal.update",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            signal_id: "550e8400-e29b-41d4-a716-446655440000",
            patch: { status: "paused" },
          },
        }),
        deps,
      );

      expect((res as unknown as { ok: boolean }).ok).toBe(false);
      const err = (res as unknown as { error: { code: string; message: string } }).error;
      expect(err.code).toBe("not_found");
      expect(err.message).toBe("signal not found");
    } finally {
      await db.close();
    }
  });
});
