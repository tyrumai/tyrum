/**
 * specs.ts — tests for error branches in spec routes.
 *
 * The happy-path is covered by specs-routes.test.ts (integration).
 * This test covers the catch blocks when spec files are missing/corrupt.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const mockReadFile = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

// Import after mock is set up
const { createSpecRoutes } = await import("../../src/routes/specs.js");

describe("spec routes error branches", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
  });

  it("returns 500 with spec_unavailable when openapi.json cannot be read", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT: file not found"));

    const app = new Hono();
    app.route("/", createSpecRoutes());

    const res = await app.request("/specs/openapi.json");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("spec_unavailable");
    expect(body.message).toBe("ENOENT: file not found");
  });

  it("returns 500 with spec_unavailable when asyncapi.json cannot be read", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT: file not found"));

    const app = new Hono();
    app.route("/", createSpecRoutes());

    const res = await app.request("/specs/asyncapi.json");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("spec_unavailable");
    expect(body.message).toBe("ENOENT: file not found");
  });

  it("returns 'unknown error' when the thrown value is not an Error", async () => {
    mockReadFile.mockRejectedValue("a string error");

    const app = new Hono();
    app.route("/", createSpecRoutes());

    const res = await app.request("/specs/openapi.json");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("spec_unavailable");
    expect(body.message).toBe("unknown error");
  });

  it("returns 'unknown error' for asyncapi when error is not an Error instance", async () => {
    mockReadFile.mockRejectedValue(42);

    const app = new Hono();
    app.route("/", createSpecRoutes());

    const res = await app.request("/specs/asyncapi.json");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("spec_unavailable");
    expect(body.message).toBe("unknown error");
  });
});
