import { describe, it, expect } from "vitest";
import { WsApprovalPendingEvent, WsApprovalResolvedEvent, WsEvent } from "@tyrum/schemas";

describe("WS approval event schemas", () => {
  it("parses a valid approval.pending event", () => {
    const result = WsApprovalPendingEvent.safeParse({
      event_id: "abc-123",
      type: "approval.pending",
      occurred_at: new Date().toISOString(),
      payload: {
        approval_id: 1,
        plan_id: "plan-1",
        step_index: 0,
        prompt: "Approve this?",
      },
    });
    expect(result.success).toBe(true);
  });

  it("parses a valid approval.resolved event", () => {
    const result = WsApprovalResolvedEvent.safeParse({
      event_id: "def-456",
      type: "approval.resolved",
      occurred_at: new Date().toISOString(),
      payload: {
        approval_id: 1,
        approved: true,
        reason: "Looks good",
      },
    });
    expect(result.success).toBe(true);
  });

  it("WsEvent union includes approval events", () => {
    const pending = {
      event_id: "e-1",
      type: "approval.pending",
      occurred_at: new Date().toISOString(),
      payload: { approval_id: 1, plan_id: "p-1", step_index: 0, prompt: "Test" },
    };
    expect(WsEvent.safeParse(pending).success).toBe(true);
  });
});
