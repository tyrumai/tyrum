import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { health } from "../../src/routes/health.js";

describe("GET /healthz", () => {
  const app = new Hono();
  app.route("/", health);

  it("returns 200 with status ok", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });
});
