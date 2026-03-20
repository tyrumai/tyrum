import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { createAdminWsClient } from "../helpers/ws-protocol-test-helpers.js";

const { createGatewayWorkboardServiceMock } = vi.hoisted(() => ({
  createGatewayWorkboardServiceMock: vi.fn(() => ({ mocked: true })),
}));

vi.mock("../../src/modules/workboard/service.js", () => {
  return { createGatewayWorkboardService: createGatewayWorkboardServiceMock };
});

describe("workboard WS service extraction", () => {
  afterEach(() => {
    createGatewayWorkboardServiceMock.mockClear();
    vi.resetModules();
  });

  it("builds workboard access from the extracted gateway service adapter", async () => {
    const { requireClientWorkboardAccess } =
      await import("../../src/ws/protocol/workboard-handlers-shared.js");

    const db = { kind: "sqlite" } as never;
    const access = requireClientWorkboardAccess(
      {
        client: createAdminWsClient({ role: "client" }),
        msg: { request_id: "req-1", type: "work.list", payload: {} } as never,
        deps: { db, redactionEngine: { redactText: vi.fn() } as never },
        tenantId: "default",
      },
      "list work items",
    );

    expect(createGatewayWorkboardServiceMock).toHaveBeenCalledWith({
      db,
      redactionEngine: expect.anything(),
    });
    expect(access).toMatchObject({ workboardService: { mocked: true }, db });
  });

  it("resolves the primary agent when creating work scope without an explicit agent key", async () => {
    const { ensureWorkScope } = await import("../../src/ws/protocol/workboard-handlers-shared.js");
    const db = openTestSqliteDb();

    try {
      const resolved = await ensureWorkScope({
        deps: { db },
        tenantId: DEFAULT_TENANT_ID,
        payload: {},
      });

      expect(resolved.keys).toMatchObject({
        agentKey: "default",
        workspaceKey: "default",
      });
    } finally {
      await db.close();
    }
  });

  it("rejects explicit missing work scopes without creating agents or workspaces", async () => {
    const { ensureWorkScope } = await import("../../src/ws/protocol/workboard-handlers-shared.js");
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

      await expect(
        ensureWorkScope({
          deps: { db },
          tenantId: DEFAULT_TENANT_ID,
          payload: { agent_key: "missing-agent", workspace_key: "missing-workspace" },
        }),
      ).rejects.toMatchObject({
        name: "ScopeNotFoundError",
        message: "agent 'missing-agent' not found",
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
});
