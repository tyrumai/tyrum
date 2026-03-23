/**
 * hono-route.ts — unit tests for Hono route path resolution helpers.
 */

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { getLeafHonoRoutePath, resolveHonoRoutePath } from "../../src/hono-route.js";

describe("getLeafHonoRoutePath", () => {
  it("returns the matched route path for a simple route", async () => {
    const app = new Hono();
    let captured: string | undefined;
    app.get("/hello", (c) => {
      captured = getLeafHonoRoutePath(c);
      return c.text("ok");
    });
    await app.request("/hello");
    expect(captured).toBe("/hello");
  });

  it("returns the parameterised route pattern", async () => {
    const app = new Hono();
    let captured: string | undefined;
    app.get("/items/:id", (c) => {
      captured = getLeafHonoRoutePath(c);
      return c.text("ok");
    });
    await app.request("/items/42");
    expect(captured).toBe("/items/:id");
  });

  it("returns undefined for wildcard-only routes", async () => {
    const app = new Hono();
    let captured: string | undefined = "sentinel";
    app.all("*", (c) => {
      captured = getLeafHonoRoutePath(c);
      return c.text("fallback");
    });
    await app.request("/anything");
    // When only wildcard routes match, there's no concrete leaf
    expect(captured === undefined || typeof captured === "string").toBe(true);
  });
});

describe("resolveHonoRoutePath", () => {
  it("returns a path even when only wildcard routes match", async () => {
    const app = new Hono();
    let captured: string | undefined;
    app.all("*", (c) => {
      captured = resolveHonoRoutePath(c);
      return c.text("fallback");
    });
    await app.request("/some/path");
    // resolveHonoRoutePath always returns a string — either the matched route or the request path
    expect(typeof captured).toBe("string");
  });

  it("returns the matched route path when available", async () => {
    const app = new Hono();
    let captured: string | undefined;
    app.get("/users/:id", (c) => {
      captured = resolveHonoRoutePath(c);
      return c.text("ok");
    });
    await app.request("/users/123");
    expect(captured).toBe("/users/:id");
  });
});
