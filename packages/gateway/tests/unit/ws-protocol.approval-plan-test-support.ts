import { describe, expect, it } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { requestApproval, sendPlanUpdate } from "../../src/ws/protocol.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { createMockWs, makeDeps, makeClient } from "./ws-protocol.test-support.js";

export function registerApprovalPlanTests(): void {
  describe("requestApproval", () => {
    it("sends approval.request to the first client", () => {
      const cm = new ConnectionManager();
      const { ws } = makeClient(cm, ["playwright"]);
      const deps = makeDeps(cm);

      requestApproval(
        DEFAULT_TENANT_ID,
        {
          approval_id: "7",
          approval_key: "approval-7",
          kind: "bash",
          prompt: "Approve payment?",
          context: { amount: 100 },
          expires_at: null,
        },
        deps,
      );

      expect(ws.send).toHaveBeenCalledOnce();
      const sent = JSON.parse(ws.send.mock.calls[0]![0] as string) as Record<string, unknown>;
      expect(sent).toMatchObject({
        request_id: "approval-7",
        type: "approval.request",
        payload: {
          approval_id: "7",
          approval_key: "approval-7",
          kind: "bash",
          prompt: "Approve payment?",
          context: { amount: 100 },
          expires_at: null,
        },
      });
    });

    it("skips node peers when selecting an approval recipient", () => {
      const cm = new ConnectionManager();
      const nodeWs = createMockWs();
      cm.addClient(
        nodeWs as never,
        ["playwright"] as never,
        {
          id: "node-1",
          role: "node",
          protocolRev: 2,
          authClaims: { token_kind: "admin", role: "admin", scopes: ["*"] },
        } as never,
      );

      const { ws: operatorWs } = makeClient(cm, ["playwright"]);
      const deps = makeDeps(cm);

      requestApproval(
        DEFAULT_TENANT_ID,
        {
          approval_id: "7",
          approval_key: "approval-7",
          kind: "bash",
          prompt: "Approve payment?",
          context: { amount: 100 },
          expires_at: null,
        },
        deps,
      );

      expect(nodeWs.send).not.toHaveBeenCalled();
      expect(operatorWs.send).toHaveBeenCalledOnce();
    });

    it("skips scoped clients without operator.approvals when selecting an approval recipient", () => {
      const cm = new ConnectionManager();
      const { ws: unscopedWs } = makeClient(cm, ["playwright"], {
        role: "client",
        deviceId: "dev_client_1",
        protocolRev: 2,
        authClaims: {
          token_kind: "device",
          token_id: "token-device-1",
          tenant_id: DEFAULT_TENANT_ID,
          role: "client",
          device_id: "dev_client_1",
          scopes: ["operator.read"],
        },
      });
      const { ws: operatorWs } = makeClient(cm, ["playwright"]);
      const deps = makeDeps(cm);

      requestApproval(
        DEFAULT_TENANT_ID,
        {
          approval_id: "7",
          approval_key: "approval-7",
          kind: "bash",
          prompt: "Approve payment?",
          context: { amount: 100 },
          expires_at: null,
        },
        deps,
      );

      expect(unscopedWs.send).not.toHaveBeenCalled();
      expect(operatorWs.send).toHaveBeenCalledOnce();
    });

    it("does nothing when no clients are connected", () => {
      const cm = new ConnectionManager();
      const deps = makeDeps(cm);

      // Should not throw.
      requestApproval(
        DEFAULT_TENANT_ID,
        {
          approval_id: "1",
          approval_key: "approval-1",
          kind: "bash",
          prompt: "Approve?",
          context: null,
          expires_at: null,
        },
        deps,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // sendPlanUpdate
  // ---------------------------------------------------------------------------

  describe("sendPlanUpdate", () => {
    it("broadcasts plan.update events to all connected clients", () => {
      const cm = new ConnectionManager();
      const { ws: ws1 } = makeClient(cm, ["playwright"]);
      const { ws: ws2 } = makeClient(cm, ["cli"]);
      const deps = makeDeps(cm);

      sendPlanUpdate(DEFAULT_TENANT_ID, "plan-1", "executing", deps, "step 2 of 5");

      expect(ws1.send).toHaveBeenCalledOnce();
      expect(ws2.send).toHaveBeenCalledOnce();

      const sent = JSON.parse(ws1.send.mock.calls[0]![0] as string) as Record<string, unknown>;
      expect(sent["type"]).toBe("plan.update");
      expect(typeof sent["event_id"]).toBe("string");
      expect(typeof sent["occurred_at"]).toBe("string");
      expect(sent["payload"]).toEqual({
        plan_id: "plan-1",
        status: "executing",
        detail: "step 2 of 5",
      });
    });

    it("sends plan.update without detail", () => {
      const cm = new ConnectionManager();
      const { ws } = makeClient(cm, ["playwright"]);
      const deps = makeDeps(cm);

      sendPlanUpdate(DEFAULT_TENANT_ID, "plan-1", "completed", deps);

      const sent = JSON.parse(ws.send.mock.calls[0]![0] as string) as Record<string, unknown>;
      expect(sent["type"]).toBe("plan.update");
      expect((sent["payload"] as Record<string, unknown>)["plan_id"]).toBe("plan-1");
      expect((sent["payload"] as Record<string, unknown>)["status"]).toBe("completed");
    });
  });
}
