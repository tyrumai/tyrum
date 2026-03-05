import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { SqlDb } from "../../src/statestore/types.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

describe("ApprovalDal", () => {
  let db: SqliteDb | undefined;
  const tenantId = DEFAULT_TENANT_ID;
  const agentId = DEFAULT_AGENT_ID;
  const workspaceId = DEFAULT_WORKSPACE_ID;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  function createDal(): ApprovalDal {
    db = openTestSqliteDb();
    return new ApprovalDal(db);
  }

  it("creates a pending approval", async () => {
    const dal = createDal();
    const approvalKey = `approval:${randomUUID()}`;
    const approval = await dal.create({
      tenantId,
      agentId,
      workspaceId,
      approvalKey,
      prompt: "Allow web scrape of example.com?",
      context: { url: "https://example.com" },
      kind: "policy",
    });

    expect(approval.tenant_id).toBe(tenantId);
    expect(approval.approval_key).toBe(approvalKey);
    expect(approval.approval_id).toMatch(/[0-9a-fA-F-]{36}/);
    expect(approval.prompt).toBe("Allow web scrape of example.com?");
    expect(approval.context).toEqual({ url: "https://example.com" });
    expect(approval.status).toBe("pending");
    expect(approval.resolved_at).toBeNull();
    expect(approval.resolution).toBeNull();

    const second = await dal.create({
      tenantId,
      agentId,
      workspaceId,
      approvalKey,
      prompt: "ignored",
    });
    expect(second.approval_id).toBe(approval.approval_id);
    expect(second.prompt).toBe(approval.prompt);
  });

  it("retrieves approval by id", async () => {
    const dal = createDal();
    const approvalKey = `approval:${randomUUID()}`;
    const created = await dal.create({
      tenantId,
      agentId,
      workspaceId,
      approvalKey,
      prompt: "Approve?",
    });

    const fetched = await dal.getById({ tenantId, approvalId: created.approval_id });
    expect(fetched).toBeDefined();
    expect(fetched!.approval_id).toBe(created.approval_id);
    expect(fetched!.prompt).toBe("Approve?");
  });

  it("returns undefined for non-existent id", async () => {
    const dal = createDal();
    expect(await dal.getById({ tenantId, approvalId: randomUUID() })).toBeUndefined();
  });

  it("approves a pending approval", async () => {
    const dal = createDal();
    const created = await dal.create({
      tenantId,
      agentId,
      workspaceId,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Approve?",
    });

    const updated = await dal.respond({
      tenantId,
      approvalId: created.approval_id,
      decision: "approved",
      reason: "looks safe",
    });
    expect(updated).toBeDefined();
    expect(updated!.status).toBe("approved");
    expect(updated!.resolved_at).toBeTruthy();
    expect((updated!.resolution as Record<string, unknown>)["decision"]).toBe("approved");
    expect((updated!.resolution as Record<string, unknown>)["reason"]).toBe("looks safe");
  });

  it("denies a pending approval", async () => {
    const dal = createDal();
    const created = await dal.create({
      tenantId,
      agentId,
      workspaceId,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Approve?",
    });

    const updated = await dal.respond({
      tenantId,
      approvalId: created.approval_id,
      decision: "denied",
      reason: "too risky",
    });
    expect(updated).toBeDefined();
    expect(updated!.status).toBe("denied");
    expect((updated!.resolution as Record<string, unknown>)["decision"]).toBe("denied");
    expect((updated!.resolution as Record<string, unknown>)["reason"]).toBe("too risky");
  });

  it("is idempotent when responding to already-responded approval", async () => {
    const dal = createDal();
    const created = await dal.create({
      tenantId,
      agentId,
      workspaceId,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Approve?",
    });

    await dal.respond({ tenantId, approvalId: created.approval_id, decision: "approved" });
    const second = await dal.respond({
      tenantId,
      approvalId: created.approval_id,
      decision: "denied",
    });
    expect(second).toBeDefined();
    expect(second!.status).toBe("approved");

    const fetched = await dal.getById({ tenantId, approvalId: created.approval_id });
    expect(fetched!.status).toBe("approved");
  });

  it("lists pending approvals in creation order", async () => {
    const dal = createDal();
    const first = await dal.create({
      tenantId,
      agentId,
      workspaceId,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "First?",
    });
    const second = await dal.create({
      tenantId,
      agentId,
      workspaceId,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Second?",
    });
    const third = await dal.create({
      tenantId,
      agentId,
      workspaceId,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Third?",
    });

    await db!.run("UPDATE approvals SET created_at = ? WHERE tenant_id = ? AND approval_id = ?", [
      "2020-01-01T00:00:00.000Z",
      tenantId,
      first.approval_id,
    ]);
    await db!.run("UPDATE approvals SET created_at = ? WHERE tenant_id = ? AND approval_id = ?", [
      "2020-01-01T00:00:01.000Z",
      tenantId,
      second.approval_id,
    ]);
    await db!.run("UPDATE approvals SET created_at = ? WHERE tenant_id = ? AND approval_id = ?", [
      "2020-01-01T00:00:02.000Z",
      tenantId,
      third.approval_id,
    ]);

    await dal.respond({ tenantId, approvalId: third.approval_id, decision: "approved" });

    const pending = await dal.getPending({ tenantId });
    expect(pending).toHaveLength(2);
    expect(pending[0]!.approval_id).toBe(first.approval_id);
    expect(pending[1]!.approval_id).toBe(second.approval_id);
  });

  it("expires stale approvals", async () => {
    const dal = createDal();
    const created = await dal.create({
      tenantId,
      agentId,
      workspaceId,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Approve?",
      expiresAt: "2020-01-01T00:00:00.000Z",
    });

    await dal.create({
      tenantId,
      agentId,
      workspaceId,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Also approve?",
      expiresAt: "2099-12-31T23:59:59.000Z",
    });

    await dal.create({
      tenantId,
      agentId,
      workspaceId,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "No expiry?",
    });

    const expired = await dal.expireStale({ tenantId, nowIso: "2026-01-01T00:00:00.000Z" });
    expect(expired).toBe(1);

    const row = await dal.getById({ tenantId, approvalId: created.approval_id });
    expect(row!.status).toBe("expired");
    expect(row!.resolved_at).toBeTruthy();
  });

  it("creates approval with default empty context when none provided", async () => {
    const dal = createDal();
    const approval = await dal.create({
      tenantId,
      agentId,
      workspaceId,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Approve?",
    });

    expect(approval.context).toEqual({});
  });

  it("normalizes created_at when Postgres returns Date", async () => {
    const createdAt = new Date("2020-01-01T00:00:00.000Z");
    const approvalId = randomUUID();
    const row = {
      tenant_id: tenantId,
      approval_id: approvalId,
      approval_key: `approval:${randomUUID()}`,
      agent_id: agentId,
      workspace_id: workspaceId,
      kind: "other",
      status: "pending",
      prompt: "Approve?",
      context_json: "{}",
      created_at: createdAt,
      expires_at: null,
      resolved_at: null,
      resolution_json: null,
      session_id: null,
      plan_id: null,
      run_id: null,
      step_id: null,
      attempt_id: null,
      work_item_id: null,
      work_item_task_id: null,
      resume_token: null,
    };

    const stubDb: SqlDb = {
      kind: "postgres",
      get: async () => row,
      all: async () => [],
      run: async () => ({ changes: 0 }),
      exec: async () => {},
      transaction: async (fn) => await fn(stubDb),
      close: async () => {},
    };

    const dal = new ApprovalDal(stubDb);
    const fetched = await dal.getById({ tenantId, approvalId });
    expect(fetched).toBeDefined();
    expect(fetched!.created_at).toBe(createdAt.toISOString());
  });

  it("uses createTxDal for respondWithTransition transactions", async () => {
    db = openTestSqliteDb();

    const txDals: SqlDb[] = [];

    class TrackingApprovalDal extends ApprovalDal {
      constructor(
        db: SqlDb,
        private readonly seenTxDals: SqlDb[],
      ) {
        super(db);
      }

      protected override createTxDal(tx: SqlDb): ApprovalDal {
        this.seenTxDals.push(tx);
        return new TrackingApprovalDal(tx, this.seenTxDals);
      }
    }

    const txDb: SqlDb = {
      kind: db.kind,
      get: async <T>(sql: string, params?: readonly unknown[]) => await db!.get<T>(sql, params),
      all: async <T>(sql: string, params?: readonly unknown[]) => await db!.all<T>(sql, params),
      run: async (sql: string, params?: readonly unknown[]) => await db!.run(sql, params),
      exec: async (sql: string) => await db!.exec(sql),
      transaction: async <T>(fn: (tx: SqlDb) => Promise<T>) => await fn(txDb),
      close: async () => await db!.close(),
    };

    const rootDb: SqlDb = {
      kind: db.kind,
      get: async <T>(sql: string, params?: readonly unknown[]) => await db!.get<T>(sql, params),
      all: async <T>(sql: string, params?: readonly unknown[]) => await db!.all<T>(sql, params),
      run: async (sql: string, params?: readonly unknown[]) => await db!.run(sql, params),
      exec: async (sql: string) => await db!.exec(sql),
      transaction: async <T>(fn: (tx: SqlDb) => Promise<T>) =>
        await db!.transaction(async () => await fn(txDb)),
      close: async () => await db!.close(),
    };

    const dal = new TrackingApprovalDal(rootDb, txDals);
    const created = await dal.create({
      tenantId,
      agentId,
      workspaceId,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Approve?",
    });

    const updated = await dal.respondWithTransition({
      tenantId,
      approvalId: created.approval_id,
      decision: "approved",
    });

    expect(updated?.row.status).toBe("approved");
    expect(updated?.transitioned).toBe(true);
    expect(txDals).toHaveLength(1);
    expect(txDals[0]).toBe(txDb);
  });
});
