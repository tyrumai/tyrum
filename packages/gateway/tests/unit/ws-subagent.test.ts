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

describe("handleClientMessage (subagent.*)", () => {
  it("handles subagent.spawn and broadcasts subagent.spawned", async () => {
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
          type: "subagent.spawn",
          payload: {
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
            execution_profile: "executor",
          },
        }),
        deps,
      );

      expect(res).toBeDefined();
      expect((res as any).ok).toBe(true);
      expect((res as any).type).toBe("subagent.spawn");

      const subagent = (res as any).result.subagent as { subagent_id: string; session_key: string };
      expect(subagent.subagent_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(subagent.session_key).toBe(`agent:default:subagent:${subagent.subagent_id}`);

      expect(ws.send).toHaveBeenCalledTimes(1);
      const evt = JSON.parse(ws.send.mock.calls[0]?.[0] ?? "{}") as {
        type?: string;
        payload?: any;
      };
      expect(evt.type).toBe("subagent.spawned");
      expect(evt.payload?.subagent?.subagent_id).toBe(subagent.subagent_id);
    } finally {
      await db.close();
    }
  });

  it("handles subagent.list and subagent.get", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const spawnRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-1",
          type: "subagent.spawn",
          payload: {
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
            execution_profile: "executor",
          },
        }),
        deps,
      );
      expect((spawnRes as any).ok).toBe(true);
      const subagentId = (spawnRes as any).result.subagent.subagent_id as string;

      const listRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-2",
          type: "subagent.list",
          payload: {
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
            statuses: ["running"],
            limit: 50,
          },
        }),
        deps,
      );
      expect((listRes as any).ok).toBe(true);
      expect((listRes as any).type).toBe("subagent.list");
      const ids = ((listRes as any).result.subagents as Array<{ subagent_id: string }>).map(
        (s) => s.subagent_id,
      );
      expect(ids).toContain(subagentId);

      const getRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-3",
          type: "subagent.get",
          payload: {
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
            subagent_id: subagentId,
          },
        }),
        deps,
      );
      expect((getRes as any).ok).toBe(true);
      expect((getRes as any).type).toBe("subagent.get");
      expect((getRes as any).result.subagent.subagent_id).toBe(subagentId);
    } finally {
      await db.close();
    }
  });

  it("handles subagent.send and emits subagent.output", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const runtimeTurn = vi.fn(async (input: any) => {
      return { session_id: "s-1", reply: `echo:${input.message}` };
    });
    const agents = {
      getRuntime: vi.fn(async () => ({ turn: runtimeTurn })),
    };

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db, agents: agents as any });

      const spawnRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-1",
          type: "subagent.spawn",
          payload: {
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
            execution_profile: "executor",
          },
        }),
        deps,
      );
      const subagentId = (spawnRes as any).result.subagent.subagent_id as string;

      ws.send.mockClear();

      const sendRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-2",
          type: "subagent.send",
          payload: {
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
            subagent_id: subagentId,
            content: "hello",
          },
        }),
        deps,
      );

      expect((sendRes as any).ok).toBe(true);
      expect((sendRes as any).type).toBe("subagent.send");
      expect((sendRes as any).result.accepted).toBe(true);

      await Promise.resolve();

      expect(runtimeTurn).toHaveBeenCalledTimes(1);
      const turnInput = runtimeTurn.mock.calls[0]?.[0] ?? {};
      expect(turnInput.metadata).toMatchObject({
        tyrum_key: `agent:default:subagent:${subagentId}`,
        lane: "subagent",
      });

      expect(ws.send).toHaveBeenCalled();
      const payloads = ws.send.mock.calls.map((call) => JSON.parse(call[0] ?? "{}"));
      const output = payloads.find((p) => p.type === "subagent.output");
      expect(output).toBeDefined();
      expect(output.payload?.subagent_id).toBe(subagentId);
      expect(output.payload?.kind).toBe("final");
      expect(output.payload?.content).toBe("echo:hello");
    } finally {
      await db.close();
    }
  });

  it("marks subagent failed and emits subagent.updated when runtime.turn throws", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const runtimeTurn = vi.fn(async () => {
      throw new Error("boom");
    });
    const agents = {
      getRuntime: vi.fn(async () => ({ turn: runtimeTurn })),
    };

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db, agents: agents as any });

      const spawnRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-1",
          type: "subagent.spawn",
          payload: {
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
            execution_profile: "executor",
          },
        }),
        deps,
      );
      const subagentId = (spawnRes as any).result.subagent.subagent_id as string;

      ws.send.mockClear();

      const sendRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-2",
          type: "subagent.send",
          payload: {
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
            subagent_id: subagentId,
            content: "hello",
          },
        }),
        deps,
      );

      expect((sendRes as any).ok).toBe(true);
      expect((sendRes as any).type).toBe("subagent.send");
      expect((sendRes as any).result.accepted).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runtimeTurn).toHaveBeenCalledTimes(1);

      expect(ws.send).toHaveBeenCalled();
      const payloads = ws.send.mock.calls.map((call) => JSON.parse(call[0] ?? "{}"));
      const updated = payloads.find((p) => p.type === "subagent.updated");
      expect(updated).toBeDefined();
      expect(updated.payload?.subagent?.subagent_id).toBe(subagentId);
      expect(updated.payload?.subagent?.status).toBe("failed");

      const getRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-3",
          type: "subagent.get",
          payload: {
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
            subagent_id: subagentId,
          },
        }),
        deps,
      );
      expect((getRes as any).ok).toBe(true);
      expect((getRes as any).result.subagent.status).toBe("failed");
    } finally {
      await db.close();
    }
  });

  it("does not emit subagent.closed when closing a failed subagent", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const runtimeTurn = vi.fn(async () => {
      throw new Error("boom");
    });
    const agents = {
      getRuntime: vi.fn(async () => ({ turn: runtimeTurn })),
    };

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db, agents: agents as any });

      const spawnRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-1",
          type: "subagent.spawn",
          payload: {
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
            execution_profile: "executor",
          },
        }),
        deps,
      );
      const subagentId = (spawnRes as any).result.subagent.subagent_id as string;

      await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-2",
          type: "subagent.send",
          payload: {
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
            subagent_id: subagentId,
            content: "hello",
          },
        }),
        deps,
      );

      await new Promise((resolve) => setTimeout(resolve, 0));

      const getRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-3",
          type: "subagent.get",
          payload: {
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
            subagent_id: subagentId,
          },
        }),
        deps,
      );
      expect((getRes as any).ok).toBe(true);
      expect((getRes as any).result.subagent.status).toBe("failed");

      ws.send.mockClear();

      const closeRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-4",
          type: "subagent.close",
          payload: {
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
            subagent_id: subagentId,
            reason: "done",
          },
        }),
        deps,
      );

      expect((closeRes as any).ok).toBe(true);
      expect((closeRes as any).type).toBe("subagent.close");
      expect((closeRes as any).result.subagent.status).toBe("failed");

      const payloads = ws.send.mock.calls.map((call) => JSON.parse(call[0] ?? "{}"));
      const closed = payloads.find((p) => p.type === "subagent.closed");
      expect(closed).toBeUndefined();
    } finally {
      await db.close();
    }
  });

  it("handles subagent.close and broadcasts subagent.closed", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const spawnRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-1",
          type: "subagent.spawn",
          payload: {
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
            execution_profile: "executor",
          },
        }),
        deps,
      );
      const subagentId = (spawnRes as any).result.subagent.subagent_id as string;

      ws.send.mockClear();

      const closeRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-2",
          type: "subagent.close",
          payload: {
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
            subagent_id: subagentId,
            reason: "done",
          },
        }),
        deps,
      );

      expect((closeRes as any).ok).toBe(true);
      expect((closeRes as any).type).toBe("subagent.close");
      expect((closeRes as any).result.subagent.status).toBe("closed");

      expect(ws.send).toHaveBeenCalled();
      const payloads = ws.send.mock.calls.map((call) => JSON.parse(call[0] ?? "{}"));
      const updated = payloads.find((p) => p.type === "subagent.updated");
      expect(updated).toBeDefined();
      expect(updated.payload?.subagent?.subagent_id).toBe(subagentId);
      expect(updated.payload?.subagent?.status).toBe("closing");
      const closed = payloads.find((p) => p.type === "subagent.closed");
      expect(closed).toBeDefined();
      expect(closed.payload?.subagent?.subagent_id).toBe(subagentId);
      expect(closed.payload?.subagent?.status).toBe("closed");
    } finally {
      await db.close();
    }
  });
});
