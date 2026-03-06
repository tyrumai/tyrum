import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol/handler.js";
import { serializeWsRequest } from "../helpers/ws-protocol-test-helpers.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { seedApprovalLinkedExecutionRun } from "../helpers/execution-fixtures.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

class FakeWebSocket {
  readonly sent: string[] = [];
  readyState = 1;
  on(_event: string, _handler: (...args: unknown[]) => void): void {
    // No-op; tests don't use heartbeat/pong behavior.
  }
  send(payload: string): void {
    this.sent.push(payload);
  }
  ping(): void {
    // No-op.
  }
  terminate(): void {
    this.readyState = 3;
  }
}

function countApprovalResolvedEvents(ws: FakeWebSocket): number {
  return ws.sent.filter((raw) => {
    try {
      const msg = JSON.parse(raw) as { type?: unknown };
      return msg.type === "approval.resolved";
    } catch {
      return false;
    }
  }).length;
}

describe("WS approval.resolve idempotency", () => {
  it("does not re-run side effects on duplicate resolves", async () => {
    const db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);
    const runId = randomUUID();
    await seedApprovalLinkedExecutionRun({ db, runId });

    const resumeToken = `resume-${randomUUID()}`;
    const approval = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval-test-${randomUUID()}`,
      kind: "workflow_step",
      prompt: "Approve?",
      context: {},
      resumeToken,
      runId,
    });

    const cm = new ConnectionManager();
    const ws = new FakeWebSocket();
    const connectionId = cm.addClient(ws as unknown as never, [], {
      id: "test-client",
      role: "client",
      authClaims: {
        token_kind: "admin",
        role: "admin",
        scopes: ["*"],
        tenant_id: DEFAULT_TENANT_ID,
      },
      protocolRev: 1,
    });
    const client = cm.getClient(connectionId);
    if (!client) {
      throw new Error("failed to register client");
    }

    let resumeCalls = 0;
    const deps = {
      connectionManager: cm,
      db,
      approvalDal,
      engine: {
        resumeRun: async (_token: string) => {
          resumeCalls += 1;
          return "run-id";
        },
        cancelRun: async (_runId: string) => "cancelled",
      },
    } as const;

    const raw = serializeWsRequest({
      requestId: "req-1",
      type: "approval.resolve",
      payload: { approval_id: approval.approval_id, decision: "approved" },
    });

    const res1 = await handleClientMessage(client, raw, deps);
    expect(res1 && "ok" in res1 && res1.ok).toBe(true);
    const res2 = await handleClientMessage(client, raw, deps);
    expect(res2 && "ok" in res2 && res2.ok).toBe(true);

    expect(resumeCalls).toBeLessThanOrEqual(1);
    expect(countApprovalResolvedEvents(ws)).toBeLessThanOrEqual(1);
  });

  it("does not call the engine inline (durable action processing)", async () => {
    const db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);
    const runId = randomUUID();
    await seedApprovalLinkedExecutionRun({ db, runId });

    const resumeToken = `resume-${randomUUID()}`;
    const approval = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval-test-${randomUUID()}`,
      kind: "workflow_step",
      prompt: "Approve?",
      context: {},
      resumeToken,
      runId,
    });

    const cm = new ConnectionManager();
    const ws = new FakeWebSocket();
    const connectionId = cm.addClient(ws as unknown as never, [], {
      id: "test-client",
      role: "client",
      authClaims: {
        token_kind: "admin",
        role: "admin",
        scopes: ["*"],
        tenant_id: DEFAULT_TENANT_ID,
      },
      protocolRev: 1,
    });
    const client = cm.getClient(connectionId);
    if (!client) {
      throw new Error("failed to register client");
    }

    let resumeCalls = 0;
    const deps = {
      connectionManager: cm,
      db,
      approvalDal,
      engine: {
        resumeRun: async (_token: string) => {
          resumeCalls += 1;
          return "run-id";
        },
        cancelRun: async (_runId: string) => "cancelled",
      },
    } as const;

    const raw = serializeWsRequest({
      requestId: "req-1",
      type: "approval.resolve",
      payload: { approval_id: approval.approval_id, decision: "approved" },
    });

    const res = await handleClientMessage(client, raw, deps);
    expect(res && "ok" in res && res.ok).toBe(true);

    expect(resumeCalls).toBe(0);
  });
});
