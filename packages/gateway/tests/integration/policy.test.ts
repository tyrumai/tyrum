import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { policy } from "../../src/routes/policy.js";

describe("POST /policy/check", () => {
  const app = new Hono();
  app.route("/", policy);

  it("returns approve when all contexts are within limits", async () => {
    const res = await app.request("/policy/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spend: { amount_minor_units: 5000, currency: "USD" },
        pii: { categories: [] },
        legal: { flags: [] },
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { decision: string };
    expect(json.decision).toBe("approve");
  });

  it("returns deny for spend above hard limit", async () => {
    const res = await app.request("/policy/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spend: { amount_minor_units: 60000, currency: "USD" },
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { decision: string };
    expect(json.decision).toBe("deny");
  });

  it("returns escalate for spend above user limit", async () => {
    const res = await app.request("/policy/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spend: { amount_minor_units: 15000, currency: "USD" },
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { decision: string };
    expect(json.decision).toBe("escalate");
  });

  it("returns deny for biometric PII", async () => {
    const res = await app.request("/policy/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pii: { categories: ["biometric"] },
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { decision: string };
    expect(json.decision).toBe("deny");
  });
});
