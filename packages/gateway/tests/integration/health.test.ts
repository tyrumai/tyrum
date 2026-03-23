import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createHealthRoute } from "../../src/routes/health.js";

describe("GET /healthz", () => {
  const app = new Hono();
  app.route("/", createHealthRoute());

  it("returns 200 with status ok", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("reports is_exposed=false when isLocalOnly defaults to true", async () => {
    const res = await app.request("/healthz");
    const body = (await res.json()) as { is_exposed: boolean };
    expect(body.is_exposed).toBe(false);
  });

  it("reports is_exposed=true when isLocalOnly is false", async () => {
    const exposedApp = new Hono();
    exposedApp.route("/", createHealthRoute({ isLocalOnly: false }));
    const res = await exposedApp.request("/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { is_exposed: boolean };
    expect(body.is_exposed).toBe(true);
  });

  it("reports is_exposed=false when isLocalOnly is explicitly true", async () => {
    const localApp = new Hono();
    localApp.route("/", createHealthRoute({ isLocalOnly: true }));
    const res = await localApp.request("/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { is_exposed: boolean };
    expect(body.is_exposed).toBe(false);
  });
});
