import { describe, expect, it } from "vitest";
import {
  ActionPrimitive,
  ActionPrimitiveKind,
  PlanResponse,
  requiresPostcondition,
} from "../src/index.js";

describe("ActionPrimitive", () => {
  it("round-trips through parse/serialize respecting schema", () => {
    const primitive = {
      type: "Research" as const,
      args: { query: "find coffees" },
      idempotency_key: "research-1",
    };

    const parsed = ActionPrimitive.parse(primitive);
    expect(parsed.type).toBe("Research");
    expect(parsed.args["query"]).toBe("find coffees");
    expect(parsed.postcondition).toBeUndefined();
    expect(parsed.idempotency_key).toBe("research-1");

    // Serialize and re-parse
    const json = JSON.parse(JSON.stringify(parsed));
    const restored = ActionPrimitive.parse(json);
    expect(restored).toEqual(parsed);
  });
});

describe("requiresPostcondition", () => {
  it("returns true for mutating primitive kinds", () => {
    const mutating: ActionPrimitiveKind[] = [
      "Web",
      "Android",
      "CLI",
      "Http",
      "Message",
      "Pay",
      "Store",
      "Watch",
    ];
    for (const kind of mutating) {
      expect(requiresPostcondition(kind)).toBe(true);
    }
  });

  it("returns false for non-mutating primitive kinds", () => {
    const nonMutating: ActionPrimitiveKind[] = ["Research", "Decide", "Confirm"];
    for (const kind of nonMutating) {
      expect(requiresPostcondition(kind)).toBe(false);
    }
  });
});

describe("PlanResponse", () => {
  it("round-trips success outcome", () => {
    const response = {
      plan_id: "plan-success",
      request_id: "req-123",
      created_at: "2025-10-05T16:31:09Z",
      trace_id: "trace-abc",
      status: "success" as const,
      steps: [
        {
          type: "Research" as const,
          args: { intent: "look_up", query: "best espresso" },
        },
      ],
      summary: { synopsis: "Research best espresso options" },
    };

    const parsed = PlanResponse.parse(response);
    expect(parsed.status).toBe("success");
    if (parsed.status === "success") {
      expect(parsed.steps).toHaveLength(1);
    }

    const json = JSON.parse(JSON.stringify(parsed));
    const restored = PlanResponse.parse(json);
    expect(restored).toEqual(parsed);
  });

  it("round-trips escalate outcome", () => {
    const response = {
      plan_id: "plan-escalate",
      request_id: "req-esc",
      created_at: "2025-10-06T08:00:00Z",
      status: "escalate" as const,
      escalation: {
        step_index: 2,
        action: {
          type: "Confirm" as const,
          args: { prompt: "Proceed with booking?", context: { slot: "15:00Z" } },
        },
        rationale: "Requires explicit approval",
        expires_at: "2025-10-06T12:00:00Z",
      },
    };

    const parsed = PlanResponse.parse(response);
    expect(parsed.status).toBe("escalate");

    const json = JSON.parse(JSON.stringify(parsed));
    const restored = PlanResponse.parse(json);
    expect(restored).toEqual(parsed);
  });

  it("round-trips failure outcome", () => {
    const response = {
      plan_id: "plan-failure",
      request_id: "req-fail",
      created_at: "2025-10-07T09:15:00Z",
      trace_id: "trace-failure",
      status: "failure" as const,
      error: {
        code: "policy_denied" as const,
        message: "Policy gate denied consent",
        detail: "Spend cap exceeded for wallet tyrum",
        retryable: false,
      },
    };

    const parsed = PlanResponse.parse(response);
    expect(parsed.status).toBe("failure");
    if (parsed.status === "failure") {
      expect(parsed.error.code).toBe("policy_denied");
      expect(parsed.error.retryable).toBe(false);
    }

    const json = JSON.parse(JSON.stringify(parsed));
    const restored = PlanResponse.parse(json);
    expect(restored).toEqual(parsed);
  });
});
