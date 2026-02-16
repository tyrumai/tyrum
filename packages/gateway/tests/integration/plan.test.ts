import { describe, expect, it } from "vitest";
import { createTestApp, minimalPlanRequest } from "./helpers.js";

describe("POST /plan", () => {
  it("escalates when no spend context is provided (spend rule defaults to escalate)", async () => {
    const { app } = createTestApp();
    const body = minimalPlanRequest();

    const res = await app.request("/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      plan_id: string;
      request_id: string;
      status: string;
      escalation?: { step_index: number };
    };
    expect(json.plan_id).toMatch(/^plan-/);
    expect(json.request_id).toBe("test-req-1");
    // Without spend context the spend rule escalates by default
    expect(json.status).toBe("escalate");
    expect(json.escalation).toBeDefined();
  });

  it("returns success for request with explicit zero spend", async () => {
    const { app } = createTestApp();
    // Provide a spend tag of 0 to satisfy the spend rule
    const body = minimalPlanRequest({ tags: ["spend:0:USD"] });

    const res = await app.request("/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      plan_id: string;
      request_id: string;
      status: string;
      steps?: unknown[];
      summary?: { synopsis?: string };
    };
    expect(json.plan_id).toMatch(/^plan-/);
    expect(json.request_id).toBe("test-req-1");
    expect(json.status).toBe("success");
    expect(json.steps).toBeDefined();
    expect(Array.isArray(json.steps)).toBe(true);
  });

  it("returns failure when spend exceeds hard limit", async () => {
    const { app } = createTestApp();
    // Spend of 60000 exceeds the hard deny limit (50000) in the policy engine
    const body = minimalPlanRequest({
      tags: ["spend:60000:EUR"],
    });

    const res = await app.request("/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      status: string;
      error?: { code: string };
    };
    // The spend exceeds hard deny (50000), so policy should deny
    expect(json.status).toBe("failure");
    expect(json.error?.code).toBe("policy_denied");
  });

  it("returns escalate when wallet escalates spend", async () => {
    const { app } = createTestApp();
    // Amount between auto-approve (10000) and hard-deny (50000)
    const body = minimalPlanRequest({ tags: ["spend:15000:EUR"] });

    const res = await app.request("/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      status: string;
      escalation?: { step_index: number; action: { type: string } };
    };
    expect(json.status).toBe("escalate");
    expect(json.escalation).toBeDefined();
    expect(json.escalation?.action.type).toBe("Confirm");
  });

  it("returns 400 for empty request_id", async () => {
    const { app } = createTestApp();
    const body = minimalPlanRequest({ request_id: "" });

    const res = await app.request("/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for empty subject_id", async () => {
    const { app } = createTestApp();
    const body = minimalPlanRequest({ subject_id: "" });

    const res = await app.request("/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(400);
  });

  it("returns success with small spend (within auto-approve)", async () => {
    const { app } = createTestApp();
    const body = minimalPlanRequest({ tags: ["spend:5000:USD"] });

    const res = await app.request("/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      status: string;
      steps?: unknown[];
    };
    expect(json.status).toBe("success");
    expect(json.steps).toBeDefined();
  });
});
