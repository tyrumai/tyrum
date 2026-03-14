import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Hono } from "hono";
import { createTestApp } from "./helpers.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createApprovalRoutes } from "../../src/routes/approval.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import type { ApprovalRow } from "../../src/modules/approval/dal.js";

const approvalScope = {
  tenantId: DEFAULT_TENANT_ID,
  agentId: DEFAULT_AGENT_ID,
  workspaceId: DEFAULT_WORKSPACE_ID,
} as const;

interface MockWebSocket {
  bufferedAmount: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  readyState: number;
  terminate: ReturnType<typeof vi.fn>;
}

function createMockWs(options?: { bufferedAmount?: number; readyState?: number }): MockWebSocket {
  return {
    bufferedAmount: options?.bufferedAmount ?? 0,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(() => undefined as never),
    readyState: options?.readyState ?? 1,
    terminate: vi.fn(),
  };
}

function createDeviceClaims(input: {
  tokenId: string;
  scopes: string[];
  role?: "client" | "node";
  deviceId?: string;
}) {
  return {
    token_kind: "device" as const,
    token_id: input.tokenId,
    tenant_id: DEFAULT_TENANT_ID,
    role: input.role ?? "client",
    scopes: input.scopes,
    ...(input.deviceId ? { device_id: input.deviceId } : {}),
  };
}

describe("Approval routes", () => {
  let app: Hono;

  beforeEach(async () => {
    const result = await createTestApp();
    app = result.app;
  });

  it("returns empty list when no approvals exist", async () => {
    const res = await app.request("/approvals");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { approvals: unknown[] };
    expect(body.approvals).toEqual([]);
  });

  it("returns 404 for non-existent approval", async () => {
    const res = await app.request("/approvals/00000000-0000-4000-8000-000000009999");
    expect(res.status).toBe(404);
  });

  it("returns 400 for non-numeric approval id", async () => {
    const res = await app.request("/approvals/abc");
    expect(res.status).toBe(400);
  });
});

describe("Approval routes (with DAL access)", () => {
  let app: Hono;
  let container: Awaited<ReturnType<typeof createTestApp>>["container"];

  beforeEach(async () => {
    const result = await createTestApp();
    app = result.app;
    container = result.container;
  });

  async function createHumanApproval(input?: {
    approvalKey: string;
    prompt?: string;
    motivation?: string;
    context?: unknown;
  }): Promise<ApprovalRow> {
    return await container.approvalDal.create({
      ...approvalScope,
      approvalKey: input?.approvalKey ?? "approval-test",
      prompt: input?.prompt ?? "Approve?",
      motivation: input?.motivation ?? "Human review is required before this action may continue.",
      kind: "policy",
      context: input?.context,
      status: "awaiting_human",
    });
  }

  it("creates an approval via DAL, lists it via route", async () => {
    await createHumanApproval({
      approvalKey: "approval-test-list",
      prompt: "Allow web scrape?",
      motivation: "This scrape needs a human approval before it runs.",
      context: { url: "https://example.com" },
    });

    const res = await app.request("/approvals");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      approvals: Array<{ prompt: string; motivation: string; status: string }>;
    };
    expect(body.approvals).toHaveLength(1);
    expect(body.approvals[0]!.prompt).toBe("Allow web scrape?");
    expect(body.approvals[0]!.motivation).toBe(
      "This scrape needs a human approval before it runs.",
    );
    expect(body.approvals[0]!.status).toBe("awaiting_human");
  });

  it("gets a single approval by id", async () => {
    const created = await createHumanApproval({
      approvalKey: "approval-test-get",
      prompt: "Approve this run?",
    });
    await container.approvalDal.transitionWithReview({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: created.approval_id,
      status: "awaiting_human",
      reviewerKind: "guardian",
      reviewState: "requested_human",
      reason: "A human should check the final side effects.",
      allowedCurrentStatuses: ["awaiting_human"],
      includeReviews: true,
    });

    const res = await app.request(`/approvals/${String(created.approval_id)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      approval: {
        approval_id: string;
        motivation: string;
        status: string;
        reviews?: Array<{ state?: string; reason?: string | null }>;
      };
    };
    expect(body.approval.approval_id).toBe(created.approval_id);
    expect(body.approval.motivation).toBe(
      "Human review is required before this action may continue.",
    );
    expect(body.approval.status).toBe("awaiting_human");
    expect(body.approval.reviews).toEqual([
      expect.objectContaining({
        state: "requested_human",
        reason: "A human should check the final side effects.",
      }),
    ]);
  });

  it("responds to an awaiting-human approval (approve)", async () => {
    const created = await createHumanApproval({
      approvalKey: "approval-test-approve",
    });

    const res = await app.request(`/approvals/${String(created.approval_id)}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved", reason: "looks safe" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      approval: { status: string; latest_review: { reason?: string | null } | null };
    };
    expect(body.approval.status).toBe("approved");
    expect(body.approval.latest_review?.reason).toBe("looks safe");
  });

  it("responds to an awaiting-human approval (deny)", async () => {
    const created = await createHumanApproval({
      approvalKey: "approval-test-deny",
    });

    const res = await app.request(`/approvals/${String(created.approval_id)}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "denied", reason: "too risky" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      approval: { status: string; latest_review: { reason?: string | null } | null };
    };
    expect(body.approval.status).toBe("denied");
    expect(body.approval.latest_review?.reason).toBe("too risky");
  });

  it("is idempotent when responding to already-responded approval", async () => {
    const created = await createHumanApproval({
      approvalKey: "approval-test-idempotent",
    });

    await app.request(`/approvals/${String(created.approval_id)}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });

    const res = await app.request(`/approvals/${String(created.approval_id)}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "denied" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { approval: { status: string } };
    expect(body.approval.status).toBe("approved");
  });

  it("returns 400 when approved field is missing", async () => {
    const created = await createHumanApproval({
      approvalKey: "approval-test-missing-decision",
    });

    const res = await app.request(`/approvals/${String(created.approval_id)}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "no approved field" }),
    });

    expect(res.status).toBe(400);
  });

  it("previews an approval context", async () => {
    const created = await createHumanApproval({
      approvalKey: "approval-test-preview",
      prompt: "Approve payment?",
      motivation: "Human review is required before sending this payment.",
      context: { amount: 100, currency: "USD" },
    });

    const res = await app.request(`/approvals/${String(created.approval_id)}/preview`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      approval_id: string;
      prompt: string;
      motivation: string;
      context: { amount: number; currency: string };
      status: string;
    };
    expect(body.approval_id).toBe(created.approval_id);
    expect(body.prompt).toBe("Approve payment?");
    expect(body.motivation).toBe("Human review is required before sending this payment.");
    expect(body.context).toEqual({ amount: 100, currency: "USD" });
    expect(body.status).toBe("awaiting_human");
  });

  it("approved approvals are excluded from the default blocked list", async () => {
    const a1 = await createHumanApproval({
      approvalKey: "approval-test-pending-a1",
      prompt: "First?",
    });
    await createHumanApproval({
      approvalKey: "approval-test-pending-a2",
      prompt: "Second?",
    });

    await container.approvalDal.resolveWithEngineAction({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: a1.approval_id,
      decision: "approved",
    });

    const res = await app.request("/approvals");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      approvals: Array<{ prompt: string }>;
    };
    expect(body.approvals).toHaveLength(1);
    expect(body.approvals[0]!.prompt).toBe("Second?");
  });

  it("evicts slow websocket consumers when broadcasting approval.updated", async () => {
    const approval = await createHumanApproval({
      approvalKey: "approval-test-ws-backpressure",
    });

    const connectionManager = new ConnectionManager();
    const slowWs = createMockWs({ bufferedAmount: 11 });
    const healthyWs = createMockWs();
    connectionManager.addClient(slowWs as never, ["cli"] as never, {
      id: "slow-client",
      role: "client",
      authClaims: {
        token_kind: "admin",
        token_id: "token-slow",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      },
    });
    connectionManager.addClient(healthyWs as never, ["cli"] as never, {
      id: "healthy-client",
      role: "client",
      authClaims: {
        token_kind: "admin",
        token_id: "token-healthy",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      },
    });

    const approvalApp = new (await import("hono")).Hono();
    approvalApp.use("*", async (c, next) => {
      c.set("authClaims", {
        token_kind: "admin",
        token_id: "token-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      });
      return await next();
    });
    approvalApp.route(
      "/",
      createApprovalRoutes({
        approvalDal: container.approvalDal,
        logger: container.logger,
        ws: { connectionManager, maxBufferedBytes: 10 },
      }),
    );

    const res = await approvalApp.request(`/approvals/${String(approval.approval_id)}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved", reason: "looks safe" }),
    });

    expect(res.status).toBe(200);
    expect(slowWs.send).not.toHaveBeenCalled();
    expect(slowWs.close).toHaveBeenCalledWith(1013, "slow consumer");
    expect(connectionManager.getClient("slow-client")).toBeUndefined();
    expect(healthyWs.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(healthyWs.send.mock.calls[0]?.[0] ?? "{}"))).toMatchObject({
      type: "approval.updated",
    });
  });

  it("broadcasts approval.updated to read-capable operator clients but not nodes", async () => {
    const approval = await createHumanApproval({
      approvalKey: "approval-test-node-audience",
    });

    const connectionManager = new ConnectionManager();
    const operatorWs = createMockWs();
    const readOnlyWs = createMockWs();
    const nodeWs = createMockWs();
    connectionManager.addClient(operatorWs as never, ["cli"] as never, {
      id: "operator-client",
      role: "client",
      authClaims: createDeviceClaims({
        tokenId: "token-operator",
        scopes: ["operator.approvals"],
        deviceId: "dev-operator-1",
      }),
    });
    connectionManager.addClient(readOnlyWs as never, ["cli"] as never, {
      id: "readonly-client",
      role: "client",
      authClaims: createDeviceClaims({
        tokenId: "token-readonly",
        scopes: ["operator.read"],
        deviceId: "dev-readonly-1",
      }),
    });
    connectionManager.addClient(nodeWs as never, ["cli"] as never, {
      id: "node-client",
      role: "node",
      authClaims: createDeviceClaims({
        tokenId: "token-node",
        role: "node",
        scopes: ["operator.approvals"],
        deviceId: "dev-node-1",
      }),
    });

    const approvalApp = new (await import("hono")).Hono();
    approvalApp.use("*", async (c, next) => {
      c.set(
        "authClaims",
        createDeviceClaims({
          tokenId: "token-1",
          scopes: ["operator.approvals"],
          deviceId: "dev-requester-1",
        }),
      );
      return await next();
    });
    approvalApp.route(
      "/",
      createApprovalRoutes({
        approvalDal: container.approvalDal,
        logger: container.logger,
        ws: { connectionManager },
      }),
    );

    const res = await approvalApp.request(`/approvals/${String(approval.approval_id)}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved", reason: "looks safe" }),
    });

    expect(res.status).toBe(200);
    expect(operatorWs.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(operatorWs.send.mock.calls[0]?.[0] ?? "{}"))).toMatchObject({
      type: "approval.updated",
    });
    expect(readOnlyWs.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(readOnlyWs.send.mock.calls[0]?.[0] ?? "{}"))).toMatchObject({
      type: "approval.updated",
    });
    expect(nodeWs.send).not.toHaveBeenCalled();
  });

  it("broadcasts approval-created policy overrides to approval and admin operators only", async () => {
    const approval = await createHumanApproval({
      approvalKey: "approval-test-policy-override-audience",
      prompt: "Approve always?",
      motivation: "Human review is required before approving this override permanently.",
      context: {
        policy: {
          agent_id: DEFAULT_AGENT_ID,
          suggested_overrides: [
            {
              tool_id: "bash",
              pattern: "echo hi",
              workspace_id: DEFAULT_WORKSPACE_ID,
            },
          ],
        },
      },
    });

    const connectionManager = new ConnectionManager();
    const approvalOperatorWs = createMockWs();
    const policyAdminWs = createMockWs();
    const readOnlyWs = createMockWs();
    const nodeWs = createMockWs();
    connectionManager.addClient(approvalOperatorWs as never, ["cli"] as never, {
      id: "approval-operator-client",
      role: "client",
      authClaims: createDeviceClaims({
        tokenId: "token-approval-operator",
        scopes: ["operator.approvals"],
        deviceId: "dev-approval-operator",
      }),
    });
    connectionManager.addClient(policyAdminWs as never, ["cli"] as never, {
      id: "policy-admin-client",
      role: "client",
      authClaims: createDeviceClaims({
        tokenId: "token-policy-admin",
        scopes: ["operator.admin"],
        deviceId: "dev-policy-admin",
      }),
    });
    connectionManager.addClient(readOnlyWs as never, ["cli"] as never, {
      id: "readonly-client",
      role: "client",
      authClaims: createDeviceClaims({
        tokenId: "token-readonly",
        scopes: ["operator.read"],
        deviceId: "dev-readonly-2",
      }),
    });
    connectionManager.addClient(nodeWs as never, ["cli"] as never, {
      id: "node-client",
      role: "node",
      authClaims: createDeviceClaims({
        tokenId: "token-node-admin",
        role: "node",
        scopes: ["operator.admin"],
        deviceId: "dev-node-2",
      }),
    });

    const approvalApp = new (await import("hono")).Hono();
    approvalApp.use("*", async (c, next) => {
      c.set(
        "authClaims",
        createDeviceClaims({
          tokenId: "token-request-approval",
          scopes: ["operator.approvals"],
          deviceId: "dev-request-approval",
        }),
      );
      return await next();
    });
    approvalApp.route(
      "/",
      createApprovalRoutes({
        approvalDal: container.approvalDal,
        policyOverrideDal: container.policyOverrideDal,
        logger: container.logger,
        ws: { connectionManager },
      }),
    );

    const res = await approvalApp.request(`/approvals/${String(approval.approval_id)}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: "approved",
        mode: "always",
        overrides: [
          {
            tool_id: "bash",
            pattern: "echo hi",
            workspace_id: DEFAULT_WORKSPACE_ID,
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(
      approvalOperatorWs.send.mock.calls.map((call) => JSON.parse(String(call[0]))["type"]),
    ).toEqual(["policy_override.created", "approval.updated"]);
    expect(
      policyAdminWs.send.mock.calls.map((call) => JSON.parse(String(call[0]))["type"]),
    ).toEqual(["policy_override.created"]);
    expect(readOnlyWs.send.mock.calls.map((call) => JSON.parse(String(call[0]))["type"])).toEqual([
      "approval.updated",
    ]);
    expect(nodeWs.send).not.toHaveBeenCalled();
  });
});
