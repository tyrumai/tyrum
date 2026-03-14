import { describe, expect, it } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { sendPlanUpdate } from "../../src/ws/protocol.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { makeDeps, makeClient } from "./ws-protocol.test-support.js";

export function registerApprovalPlanTests(): void {
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
