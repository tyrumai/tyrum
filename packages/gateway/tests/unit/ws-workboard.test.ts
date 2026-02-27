import { describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import type { ProtocolDeps } from "../../src/ws/protocol.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

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
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
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
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
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
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
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
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
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
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
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
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
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
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
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
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
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
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
            item: { kind: "action", title: "Item 1" },
          },
        }),
        deps,
      );
      expect((createRes as unknown as { ok: boolean }).ok).toBe(true);
      const createdId = (createRes as unknown as { result: { item: { work_item_id: string } } })
        .result.item.work_item_id;
      ws.send.mockClear();

      const transitionRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-transition",
          type: "work.transition",
          payload: {
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
            work_item_id: createdId,
            status: "blocked",
            reason: "waiting",
          },
        }),
        deps,
      );

      expect(transitionRes).toBeDefined();
      expect((transitionRes as unknown as { ok: boolean }).ok).toBe(true);
      const status = (transitionRes as unknown as { result: { item: { status: string } } }).result
        .item.status;
      expect(status).toBe("blocked");

      expect(ws.send).toHaveBeenCalledTimes(1);
      const evt = JSON.parse(ws.send.mock.calls[0]?.[0] ?? "{}") as {
        type?: string;
        payload?: any;
      };
      expect(evt.type).toBe("work.item.blocked");
      expect(evt.payload?.item?.work_item_id).toBe(createdId);
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
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
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
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
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
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
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
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
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
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
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
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
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

  it("handles work.signal.create/list/get/update and broadcasts work.signal.created", async () => {
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
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
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
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
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
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
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
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
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
        tenant_id: "default",
        agent_id: "default",
        workspace_id: "default",
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
          payload: { tenant_id: "default", agent_id: "default", workspace_id: "default" },
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
          payload: { tenant_id: "default", agent_id: "default", workspace_id: "default" },
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
});
