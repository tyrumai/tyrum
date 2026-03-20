import { describe, expect, it } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { makeClient, makeDeps } from "./ws-subagent.test-support.js";

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
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
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
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
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
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
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
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
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

  it("returns not_found for subagent.list when the explicit scope is missing without creating it", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const before = await db.get<{ count: number }>(
        "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
        [DEFAULT_TENANT_ID],
      );
      const beforeWorkspaces = await db.get<{ count: number }>(
        "SELECT COUNT(1) AS count FROM workspaces WHERE tenant_id = ?",
        [DEFAULT_TENANT_ID],
      );
      const beforeMemberships = await db.get<{ count: number }>(
        "SELECT COUNT(1) AS count FROM agent_workspaces WHERE tenant_id = ?",
        [DEFAULT_TENANT_ID],
      );
      const deps = makeDeps(cm, { db });

      const res = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-missing-scope",
          type: "subagent.list",
          payload: {
            tenant_key: "default",
            agent_key: "missing-agent",
            workspace_key: "missing-workspace",
            limit: 50,
          },
        }),
        deps,
      );

      expect(res).toMatchObject({
        request_id: "r-missing-scope",
        ok: false,
        error: { code: "not_found", message: "scope not found" },
      });

      const after = await db.get<{ count: number }>(
        "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
        [DEFAULT_TENANT_ID],
      );
      const afterWorkspaces = await db.get<{ count: number }>(
        "SELECT COUNT(1) AS count FROM workspaces WHERE tenant_id = ?",
        [DEFAULT_TENANT_ID],
      );
      const afterMemberships = await db.get<{ count: number }>(
        "SELECT COUNT(1) AS count FROM agent_workspaces WHERE tenant_id = ?",
        [DEFAULT_TENANT_ID],
      );
      expect(after?.count ?? 0).toBe(before?.count ?? 0);
      expect(afterWorkspaces?.count ?? 0).toBe(beforeWorkspaces?.count ?? 0);
      expect(afterMemberships?.count ?? 0).toBe(beforeMemberships?.count ?? 0);
    } finally {
      await db.close();
    }
  });

  it("returns not_found for subagent.spawn when the explicit scope is missing without creating it", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const before = await db.get<{ count: number }>(
        "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
        [DEFAULT_TENANT_ID],
      );
      const beforeWorkspaces = await db.get<{ count: number }>(
        "SELECT COUNT(1) AS count FROM workspaces WHERE tenant_id = ?",
        [DEFAULT_TENANT_ID],
      );
      const beforeMemberships = await db.get<{ count: number }>(
        "SELECT COUNT(1) AS count FROM agent_workspaces WHERE tenant_id = ?",
        [DEFAULT_TENANT_ID],
      );
      const deps = makeDeps(cm, { db });

      const res = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-missing-spawn-scope",
          type: "subagent.spawn",
          payload: {
            tenant_key: "default",
            agent_key: "missing-agent",
            workspace_key: "missing-workspace",
            execution_profile: "executor",
          },
        }),
        deps,
      );

      expect(res).toMatchObject({
        request_id: "r-missing-spawn-scope",
        ok: false,
        error: { code: "not_found", message: "agent 'missing-agent' not found" },
      });

      const after = await db.get<{ count: number }>(
        "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
        [DEFAULT_TENANT_ID],
      );
      const afterWorkspaces = await db.get<{ count: number }>(
        "SELECT COUNT(1) AS count FROM workspaces WHERE tenant_id = ?",
        [DEFAULT_TENANT_ID],
      );
      const afterMemberships = await db.get<{ count: number }>(
        "SELECT COUNT(1) AS count FROM agent_workspaces WHERE tenant_id = ?",
        [DEFAULT_TENANT_ID],
      );
      expect(after?.count ?? 0).toBe(before?.count ?? 0);
      expect(afterWorkspaces?.count ?? 0).toBe(beforeWorkspaces?.count ?? 0);
      expect(afterMemberships?.count ?? 0).toBe(beforeMemberships?.count ?? 0);
    } finally {
      await db.close();
    }
  });
});
