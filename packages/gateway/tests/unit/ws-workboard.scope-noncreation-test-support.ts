import { expect, it } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { makeClient, makeDeps } from "./ws-workboard.test-support.js";

export function registerWorkboardScopeNonCreationTests(): void {
  it("returns not_found for work.list when the explicit scope is missing without creating it", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const beforeAgents = await db.get<{ count: number }>(
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

      const res = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-1",
          type: "work.list",
          payload: {
            tenant_key: "default",
            agent_key: "missing-agent",
            workspace_key: "missing-workspace",
          },
        }),
        makeDeps(cm, { db }),
      );

      expect((res as { ok: boolean }).ok).toBe(false);
      expect((res as { error: { code: string; message: string } }).error).toMatchObject({
        code: "not_found",
        message: "scope not found",
      });

      const afterAgents = await db.get<{ count: number }>(
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
      expect(afterAgents?.count ?? 0).toBe(beforeAgents?.count ?? 0);
      expect(afterWorkspaces?.count ?? 0).toBe(beforeWorkspaces?.count ?? 0);
      expect(afterMemberships?.count ?? 0).toBe(beforeMemberships?.count ?? 0);
    } finally {
      await db.close();
    }
  });
}
