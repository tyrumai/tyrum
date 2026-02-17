import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";
import { resetLocalStoreForTesting } from "../../../local-store";

const PLAN_ID = "3a1c9f77-2f6b-4f2f-a1a3-bc9471d8e852";

describe("audit plan route", () => {
  beforeEach(() => {
    resetLocalStoreForTesting();
  });

  it("returns a local timeline for known plans", async () => {
    const request = new Request(
      `https://portal.local/api/audit/plan/${PLAN_ID}?event=abc123`,
    );

    const response = await GET(request, {
      params: Promise.resolve({ planId: PLAN_ID }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      plan_id: string;
      events: unknown[];
    };
    expect(body.plan_id).toBe(PLAN_ID);
    expect(body.events.length).toBeGreaterThan(0);
  });

  it("returns 404 for unknown plans", async () => {
    const request = new Request("https://portal.local/api/audit/plan/unknown");

    const response = await GET(request, {
      params: Promise.resolve({ planId: "unknown" }),
    });

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("plan_not_found");
  });
});
