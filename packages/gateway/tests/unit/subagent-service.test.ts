import { afterEach, describe, expect, it } from "vitest";
import { SubagentService } from "../../src/modules/workboard/subagent-service.js";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("gateway workboard SubagentService", () => {
  let db: SqliteDb | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("builds a conversation key without agent runtime when createSubagent is called without one", async () => {
    db = openTestSqliteDb();
    const identityScopeDal = new IdentityScopeDal(db);
    const tenantId = await identityScopeDal.ensureTenantId("subagent-service-runtime-optional");
    const agentId = await identityScopeDal.ensureAgentId(tenantId, "reviewer");
    const workspaceId = await identityScopeDal.ensureWorkspaceId(tenantId, "default");
    await identityScopeDal.ensureMembership(tenantId, agentId, workspaceId);

    const service = new SubagentService({ db });
    const subagentId = "123e4567-e89b-12d3-a456-426614174111";
    const subagent = await service.createSubagent({
      scope: {
        tenant_id: tenantId,
        agent_id: agentId,
        workspace_id: workspaceId,
      },
      subagentId,
      subagent: {
        execution_profile: "reviewer_ro",
        lane: "subagent",
        status: "running",
      },
    });

    expect(subagent.conversation_key).toBe(`agent:reviewer:subagent:${subagentId}`);
  });
});
