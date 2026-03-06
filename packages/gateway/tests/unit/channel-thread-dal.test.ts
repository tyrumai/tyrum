import { afterEach, describe, expect, it } from "vitest";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
  IdentityScopeDal,
} from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("ChannelThreadDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  async function createScope(): Promise<{ tenantId: string; workspaceId: string }> {
    if (!db) {
      throw new Error("db not initialized");
    }
    const identity = new IdentityScopeDal(db);
    const ids = await identity.resolveScopeIds({
      tenantKey: DEFAULT_TENANT_ID,
      agentKey: DEFAULT_AGENT_ID,
      workspaceKey: DEFAULT_WORKSPACE_ID,
    });
    return { tenantId: ids.tenantId, workspaceId: ids.workspaceId };
  }

  it("tracks updated_at when channel account status changes", async () => {
    db = openTestSqliteDb();
    const dal = new ChannelThreadDal(db);
    const scope = await createScope();

    const channelAccountId = await dal.ensureChannelAccountId({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      connectorKey: "telegram",
      accountKey: "ops",
    });

    const created = await db.get<{ status: string; created_at: string; updated_at: string }>(
      `SELECT status, created_at, updated_at
       FROM channel_accounts
       WHERE tenant_id = ?
         AND workspace_id = ?
         AND channel_account_id = ?`,
      [scope.tenantId, scope.workspaceId, channelAccountId],
    );
    expect(created).toMatchObject({
      status: "active",
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });

    const changed = await dal.setChannelAccountStatus({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      channelAccountId,
      status: "disabled",
      updatedAtIso: "2026-03-06T10:00:00.000Z",
    });
    expect(changed).toBe(true);

    const updated = await db.get<{ status: string; created_at: string; updated_at: string }>(
      `SELECT status, created_at, updated_at
       FROM channel_accounts
       WHERE tenant_id = ?
         AND workspace_id = ?
         AND channel_account_id = ?`,
      [scope.tenantId, scope.workspaceId, channelAccountId],
    );
    expect(updated).toEqual({
      status: "disabled",
      created_at: created!.created_at,
      updated_at: "2026-03-06T10:00:00.000Z",
    });
  });
});
