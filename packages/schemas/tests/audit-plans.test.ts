import * as schemas from "../src/index.js";
import { describe, expect, it } from "vitest";

describe("Audit plan list contracts", () => {
  it("exports AuditPlanSummary and AuditPlansListResponse", () => {
    expect((schemas as any).AuditPlanSummary).toBeDefined();
    expect((schemas as any).AuditPlansListResponse).toBeDefined();
  });

  it("parses a valid audit plans list response", () => {
    const AuditPlansListResponse = (schemas as any).AuditPlansListResponse;
    expect(AuditPlansListResponse).toBeDefined();

    const parsed = AuditPlansListResponse.parse({
      status: "ok",
      plans: [
        {
          plan_key: "plan-1",
          plan_id: "00000000-0000-4000-8000-000000000001",
          kind: "planner",
          status: "success",
          event_count: 2,
          last_event_at: "2026-03-01T00:00:00.000Z",
        },
      ],
    });

    expect(parsed.plans[0]).toMatchObject({
      plan_key: "plan-1",
      plan_id: "00000000-0000-4000-8000-000000000001",
      event_count: 2,
    });
  });
});
