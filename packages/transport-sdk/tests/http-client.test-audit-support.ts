import { expect, it } from "vitest";
import { createTestClient, jsonResponse, makeFetchMock } from "./http-client.test-support.js";

export function registerHttpClientAuditTests(): void {
  it("audit.listPlans sends the limit query and parses recent plans", async () => {
    const fetch = makeFetchMock(async (input, init) => {
      expect(init?.method).toBe("GET");
      expect(String(input)).toBe("https://gateway.example/audit/plans?limit=25");
      return jsonResponse({
        status: "ok",
        plans: [
          {
            plan_key: "plan-123",
            plan_id: "00000000-0000-4000-8000-000000000123",
            kind: "planner",
            status: "success",
            event_count: 3,
            last_event_at: "2026-03-01T00:00:00.000Z",
          },
        ],
      });
    });
    const client = createTestClient({ fetch });

    const admin = client as unknown as Record<string, any>;
    expect(typeof admin.audit?.listPlans).toBe("function");

    const result = await admin.audit.listPlans({ limit: 25 });
    expect(result).toEqual({
      status: "ok",
      plans: [
        {
          plan_key: "plan-123",
          plan_id: "00000000-0000-4000-8000-000000000123",
          kind: "planner",
          status: "success",
          event_count: 3,
          last_event_at: "2026-03-01T00:00:00.000Z",
        },
      ],
    });
  });
}
