import { expect, it } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { makeDeps, makeClient } from "./ws-workboard.test-support.js";

export function registerWorkboardScopeErrorTests(): void {
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
}
