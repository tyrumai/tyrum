import { describe, expect, it } from "vitest";
import { policy } from "../../src/routes/policy.js";

describe("policy route", () => {
  it("returns 400 for invalid request bodies", async () => {
    const res = await policy.request("/policy/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request_id: 1 }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_request" });
  });
});
