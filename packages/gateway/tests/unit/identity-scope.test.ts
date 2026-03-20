import { afterEach, describe, expect, it, vi } from "vitest";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("IdentityScopeDal resolve-only scope lookup", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  function createDal() {
    db = openTestSqliteDb();
    return new IdentityScopeDal(db, { cacheTtlMs: 60_000 });
  }

  it("does not create an agent when resolveAgentId misses", async () => {
    const dal = createDal();
    const tenantId = await dal.ensureTenantId("scope-test");
    const before = await db!.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
      [tenantId],
    );

    await expect(dal.resolveAgentId(tenantId, "missing-agent")).resolves.toBeNull();

    const after = await db!.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
      [tenantId],
    );
    expect(after?.count ?? 0).toBe(before?.count ?? 0);
  });

  it("resolves an agent key from agent id and caches hits", async () => {
    const dal = createDal();
    const tenantId = await dal.ensureTenantId("scope-agent-key-test");
    const agentId = await dal.ensureAgentId(tenantId, "agent-a");

    const resolveDal = new IdentityScopeDal(db!, { cacheTtlMs: 60_000 });
    const getSpy = vi.spyOn(db!, "get");
    const first = await resolveDal.resolveAgentKey(tenantId, agentId);
    const second = await resolveDal.resolveAgentKey(tenantId, agentId);

    expect(first).toBe("agent-a");
    expect(second).toBe("agent-a");
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it("does not create a workspace when resolveWorkspaceId misses and caches hits", async () => {
    const dal = createDal();
    const tenantId = await dal.ensureTenantId("scope-workspace-test");
    const before = await db!.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM workspaces WHERE tenant_id = ?",
      [tenantId],
    );

    await expect(dal.resolveWorkspaceId(tenantId, "missing-workspace")).resolves.toBeNull();

    const existingWorkspaceId = await dal.ensureWorkspaceId(tenantId, "workspace-a");
    const resolveDal = new IdentityScopeDal(db!, { cacheTtlMs: 60_000 });
    const getSpy = vi.spyOn(db!, "get");
    const first = await resolveDal.resolveWorkspaceId(tenantId, "workspace-a");
    const second = await resolveDal.resolveWorkspaceId(tenantId, "workspace-a");

    expect(first).toBe(existingWorkspaceId);
    expect(second).toBe(existingWorkspaceId);
    expect(getSpy).toHaveBeenCalledTimes(1);

    const after = await db!.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM workspaces WHERE tenant_id = ?",
      [tenantId],
    );
    expect(after?.count ?? 0).toBe((before?.count ?? 0) + 1);
  });

  it("returns null for missing membership without inserting one", async () => {
    const dal = createDal();
    const tenantId = await dal.ensureTenantId("scope-membership-test");
    const agentId = await dal.ensureAgentId(tenantId, "agent-a");
    const workspaceId = await dal.ensureWorkspaceId(tenantId, "workspace-a");

    await expect(
      dal.resolveExistingScopeIdsForTenant({
        tenantId,
        agentKey: "agent-a",
        workspaceKey: "workspace-a",
      }),
    ).resolves.toBeNull();

    const beforeMembershipCount = await db!.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agent_workspaces WHERE tenant_id = ? AND agent_id = ? AND workspace_id = ?",
      [tenantId, agentId, workspaceId],
    );
    expect(beforeMembershipCount?.count ?? 0).toBe(0);

    await dal.ensureMembership(tenantId, agentId, workspaceId);

    await expect(
      dal.resolveExistingScopeIdsForTenant({
        tenantId,
        agentKey: "agent-a",
        workspaceKey: "workspace-a",
      }),
    ).resolves.toEqual({ agentId, workspaceId });
  });

  it("returns null from resolveExistingScopeIds without creating scope rows", async () => {
    const dal = createDal();
    const tenantId = await dal.ensureTenantId("scope-ids-test");
    const beforeAgents = await db!.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
      [tenantId],
    );
    const beforeWorkspaces = await db!.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM workspaces WHERE tenant_id = ?",
      [tenantId],
    );
    const beforeMemberships = await db!.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agent_workspaces WHERE tenant_id = ?",
      [tenantId],
    );

    await expect(
      dal.resolveExistingScopeIds({
        tenantKey: "scope-ids-test",
        agentKey: "missing-agent",
        workspaceKey: "missing-workspace",
      }),
    ).resolves.toBeNull();

    const afterAgents = await db!.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
      [tenantId],
    );
    const afterWorkspaces = await db!.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM workspaces WHERE tenant_id = ?",
      [tenantId],
    );
    const afterMemberships = await db!.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agent_workspaces WHERE tenant_id = ?",
      [tenantId],
    );

    expect(afterAgents?.count ?? 0).toBe(beforeAgents?.count ?? 0);
    expect(afterWorkspaces?.count ?? 0).toBe(beforeWorkspaces?.count ?? 0);
    expect(afterMemberships?.count ?? 0).toBe(beforeMemberships?.count ?? 0);
  });
});
