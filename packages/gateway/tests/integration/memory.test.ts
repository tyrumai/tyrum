import { describe, expect, it, beforeEach } from "vitest";
import type { Hono } from "hono";
import { createTestApp } from "./helpers.js";

describe("Legacy /memory HTTP CRUD routes removed", () => {
  let app: Hono;

  beforeEach(async () => {
    const result = await createTestApp();
    app = result.app;
  });

  it("returns 404 for retired /memory CRUD endpoints", async () => {
    expect((await app.request("/memory/facts")).status).toBe(404);
    expect(
      (
        await app.request("/memory/facts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(404);

    expect((await app.request("/memory/events")).status).toBe(404);
    expect(
      (
        await app.request("/memory/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(404);

    expect((await app.request("/memory/capabilities")).status).toBe(404);
    expect(
      (
        await app.request("/memory/capabilities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(404);

    expect(
      (
        await app.request("/memory/forget", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: "FORGET" }),
        })
      ).status,
    ).toBe(404);
  });
});
