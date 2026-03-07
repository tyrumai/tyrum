import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";

export type WorkboardDalFixture = {
  name: string;
  db: () => SqliteDb | undefined;
  setDb: (value: SqliteDb | undefined) => void;
  createDal: () => WorkboardDal;
  resolveScope: (input?: {
    tenantKey?: string;
    agentKey?: string;
    workspaceKey?: string;
  }) => Promise<{ tenant_id: string; agent_id: string; workspace_id: string }>;
};

export function createWorkboardDalFixture(): WorkboardDalFixture {
  let db: SqliteDb | undefined;

  function createDal(): WorkboardDal {
    db = openTestSqliteDb();
    return new WorkboardDal(db);
  }

  async function resolveScope(input?: {
    tenantKey?: string;
    agentKey?: string;
    workspaceKey?: string;
  }): Promise<{ tenant_id: string; agent_id: string; workspace_id: string }> {
    if (!db) {
      throw new Error("db not initialized");
    }
    const identity = new IdentityScopeDal(db);
    const ids = await identity.resolveScopeIds(input);
    return { tenant_id: ids.tenantId, agent_id: ids.agentId, workspace_id: ids.workspaceId };
  }

  return {
    name: "sqlite",
    db: () => db,
    setDb: (value) => {
      db = value;
    },
    createDal,
    resolveScope,
  };
}
