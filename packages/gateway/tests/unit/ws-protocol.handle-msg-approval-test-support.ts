import { expect, it, vi } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { makeDeps, makeClient } from "./ws-protocol.test-support.js";

/**
 * Approval decision and ping tests for handleClientMessage.
 * Must be called inside a `describe("handleClientMessage")` block.
 */
function registerApprovalDecisionTests(): void {
  it("dispatches approval.request decision to callback", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onApprovalDecision = vi.fn();
    const deps = makeDeps(cm, { onApprovalDecision });
    const approvalId = "550e8400-e29b-41d4-a716-446655440000";

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: `approval-${approvalId}`,
        type: "approval.request",
        ok: true,
        result: { approved: true },
      }),
      deps,
    );

    expect(result).toBeUndefined();
    expect(onApprovalDecision).toHaveBeenCalledWith(DEFAULT_TENANT_ID, approvalId, true, undefined);
  });

  it("dispatches approval.request rejection with reason", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onApprovalDecision = vi.fn();
    const deps = makeDeps(cm, { onApprovalDecision });
    const approvalId = "6f9619ff-8b86-4d11-b42d-00c04fc964ff";

    await handleClientMessage(
      client,
      JSON.stringify({
        request_id: `approval-${approvalId}`,
        type: "approval.request",
        ok: true,
        result: { approved: false, reason: "too risky" },
      }),
      deps,
    );

    expect(onApprovalDecision).toHaveBeenCalledWith(
      DEFAULT_TENANT_ID,
      approvalId,
      false,
      "too risky",
    );
  });

  it("forbids approval.request decisions when scoped device token lacks operator.approvals", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"], {
      role: "client",
      deviceId: "dev_client_1",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        role: "client",
        device_id: "dev_client_1",
        scopes: ["operator.read"],
      },
    });
    const client = cm.getClient(id)!;
    const onApprovalDecision = vi.fn();
    const deps = makeDeps(cm, { onApprovalDecision });
    const approvalId = "550e8400-e29b-41d4-a716-446655440000";

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: `approval-${approvalId}`,
        type: "approval.request",
        ok: true,
        result: { approved: true },
      }),
      deps,
    );

    expect(onApprovalDecision).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    const payload = (result as unknown as { payload: { code: string; message: string } }).payload;
    expect(payload.code).toBe("forbidden");
    expect(payload.message).toContain("insufficient scope");
  });

  it("forbids approval.request ok:false responses when scoped device token lacks operator.approvals", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"], {
      role: "client",
      deviceId: "dev_client_1",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        role: "client",
        device_id: "dev_client_1",
        scopes: ["operator.read"],
      },
    });
    const client = cm.getClient(id)!;
    const onApprovalDecision = vi.fn();
    const deps = makeDeps(cm, { onApprovalDecision });
    const approvalId = "550e8400-e29b-41d4-a716-446655440000";

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: `approval-${approvalId}`,
        type: "approval.request",
        ok: false,
        error: { code: "invalid_request", message: "payload validation failed" },
      }),
      deps,
    );

    expect(onApprovalDecision).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    const payload = (result as unknown as { payload: { code: string; message: string } }).payload;
    expect(payload.code).toBe("forbidden");
    expect(payload.message).toContain("insufficient scope");
  });

  it("rejects approval.request ok:false responses from non-client peers", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"], { role: "node" });
    const client = cm.getClient(id)!;
    const onApprovalDecision = vi.fn();
    const deps = makeDeps(cm, { onApprovalDecision });
    const approvalId = "550e8400-e29b-41d4-a716-446655440000";

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: `approval-${approvalId}`,
        type: "approval.request",
        ok: false,
        error: { code: "invalid_request", message: "payload validation failed" },
      }),
      deps,
    );

    expect(onApprovalDecision).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    const payload = (result as unknown as { payload: { code: string; message: string } }).payload;
    expect(payload.code).toBe("unauthorized");
    expect(payload.message).toContain("only operator clients");
  });

  it("does not auto-deny approval.request when client responds ok:false", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onApprovalDecision = vi.fn();
    const deps = makeDeps(cm, { onApprovalDecision });
    const approvalId = "550e8400-e29b-41d4-a716-446655440000";
    const requestId = `approval-${approvalId}`;

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: requestId,
        type: "approval.request",
        ok: false,
        error: { code: "invalid_request", message: "payload validation failed" },
      }),
      deps,
    );

    expect(onApprovalDecision).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    const payload = (result as unknown as { payload: { code: string; message: string } }).payload;
    expect(payload.code).toBe("approval_request_failed");
    expect(payload.message).toContain(requestId);
    expect(payload.message).toContain("payload validation failed");
  });

  it("returns error when approval.request ok payload is invalid", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onApprovalDecision = vi.fn();
    const deps = makeDeps(cm, { onApprovalDecision });
    const approvalId = "550e8400-e29b-41d4-a716-446655440000";

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: `approval-${approvalId}`,
        type: "approval.request",
        ok: true,
        result: { approved: "yes" },
      }),
      deps,
    );

    expect(onApprovalDecision).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    const payload = (result as unknown as { payload: { code: string } }).payload;
    expect(payload.code).toBe("invalid_approval_decision");
  });
}

function registerPingTests(): void {
  it("does not update lastWsPongAt on ping response", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    client.lastWsPongAt = 1000;

    const result = await handleClientMessage(
      client,
      JSON.stringify({ request_id: "ping-1", type: "ping", ok: true }),
      deps,
    );

    expect(result).toBeUndefined();
    expect(client.lastWsPongAt).toBe(1000);
  });

  it("responds to ping requests without updating lastWsPongAt", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    client.lastWsPongAt = 1000;
    const result = await handleClientMessage(
      client,
      JSON.stringify({ request_id: "ping-req-1", type: "ping", payload: {} }),
      deps,
    );

    expect(result).toEqual({
      request_id: "ping-req-1",
      type: "ping",
      ok: true,
    });
    expect(client.lastWsPongAt).toBe(1000);
  });
}

export function registerHandleMessageApprovalTests(): void {
  registerApprovalDecisionTests();
  registerPingTests();
}
