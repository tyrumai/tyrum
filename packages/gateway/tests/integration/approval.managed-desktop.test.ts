import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createTestApp } from "./helpers.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createApprovalRoutes } from "../../src/routes/approval.js";
import {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "../../src/modules/desktop-environments/dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

function createMockWs() {
  return {
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(() => undefined as never),
    readyState: 1,
    terminate: vi.fn(),
  };
}

function createDeviceClaims(input: { tokenId: string; scopes: string[]; deviceId?: string }) {
  return {
    token_kind: "device" as const,
    token_id: input.tokenId,
    tenant_id: DEFAULT_TENANT_ID,
    role: "client" as const,
    scopes: input.scopes,
    ...(input.deviceId ? { device_id: input.deviceId } : {}),
  };
}

describe("Approval managed desktop events", () => {
  let container: Awaited<ReturnType<typeof createTestApp>>["container"];

  beforeEach(async () => {
    const result = await createTestApp();
    container = result.container;
  });

  it("includes managed_desktop in approval.updated websocket payloads", async () => {
    const hostDal = new DesktopEnvironmentHostDal(container.db);
    const desktopEnvironmentDal = new DesktopEnvironmentDal(container.db);
    await hostDal.upsert({
      hostId: "host-1",
      label: "Primary runtime",
      version: "0.1.0",
      dockerAvailable: true,
      healthy: true,
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      lastError: null,
    });
    const environment = await desktopEnvironmentDal.create({
      tenantId: DEFAULT_TENANT_ID,
      hostId: "host-1",
      label: "Managed desktop",
      imageRef: "registry.example.test/desktop:latest",
      desiredRunning: true,
    });
    await desktopEnvironmentDal.updateRuntime({
      tenantId: DEFAULT_TENANT_ID,
      environmentId: environment.environment_id,
      status: "running",
      nodeId: "node-managed-1",
      takeoverUrl: "http://127.0.0.1:6080/vnc.html?autoconnect=true",
      logs: ["desktop runtime ready"],
      lastError: null,
    });

    const approval = await container.approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: "approval-test-managed-desktop-event",
      prompt: "Approve?",
      motivation: "Human review is required before this action may continue.",
      kind: "policy",
      status: "awaiting_human",
      context: { args: { node_id: "node-managed-1" } },
    });

    const connectionManager = new ConnectionManager();
    const operatorWs = createMockWs();
    connectionManager.addClient(operatorWs as never, ["cli"] as never, {
      id: "operator-client",
      role: "client",
      authClaims: createDeviceClaims({
        tokenId: "token-operator",
        scopes: ["operator.approvals"],
        deviceId: "dev-operator-1",
      }),
    });

    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set(
        "authClaims",
        createDeviceClaims({
          tokenId: "token-requester",
          scopes: ["operator.approvals"],
          deviceId: "dev-requester-1",
        }),
      );
      return await next();
    });
    app.route(
      "/",
      createApprovalRoutes({
        approvalDal: container.approvalDal,
        desktopEnvironmentDal,
        logger: container.logger,
        ws: { connectionManager },
      }),
    );

    const res = await app.request(`/approvals/${String(approval.approval_id)}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved", reason: "looks safe" }),
    });

    expect(res.status).toBe(200);
    expect(operatorWs.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(operatorWs.send.mock.calls[0]?.[0] ?? "{}"))).toMatchObject({
      type: "approval.updated",
      payload: {
        approval: {
          approval_id: approval.approval_id,
          managed_desktop: {
            environment_id: environment.environment_id,
          },
        },
      },
    });
  });
});
