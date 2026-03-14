import { expect, it } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { makeClient, makeDeps } from "./ws-workboard.test-support.js";

export function registerWorkboardErrorHandlingTests(): void {
  it("sanitizes SQL-level failures for work.* requests", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const client = cm.getClient(id)!;
    const sqlErr = Object.assign(
      new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed: work_items.work_item_id"),
      { code: "SQLITE_CONSTRAINT" as const },
    );

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
      makeDeps(cm, {
        db: {
          get: async () => {
            throw sqlErr;
          },
        } as never,
      }),
    );

    expect((res as { ok: boolean }).ok).toBe(false);
    expect((res as { error: { code: string; message: string } }).error).toEqual({
      code: "internal_error",
      message: "internal error",
    });
  });

  it("denies work.create for non-client WS roles", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, { role: "node" });
    const client = cm.getClient(id)!;
    const db = openTestSqliteDb();
    try {
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
        makeDeps(cm, { db }),
      );

      expect((res as { ok: boolean }).ok).toBe(false);
      expect((res as { error: { code: string; message: string } }).error).toEqual({
        code: "unauthorized",
        message: "only operator clients may create work items",
      });
    } finally {
      await db.close();
    }
  });
}
