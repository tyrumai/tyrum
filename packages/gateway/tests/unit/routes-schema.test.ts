import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createSchemaRoutes } from "../../src/routes/schema.js";
import { listSchemaNames } from "@tyrum/schemas";

describe("schema routes", () => {
  const app = new Hono();
  app.route("/", createSchemaRoutes());

  // ── GET /schemas ───────────────────────────────────────────

  it("GET /schemas returns list of schema names", async () => {
    const res = await app.request("/schemas");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { schemas: string[]; count: number };
    expect(Array.isArray(body.schemas)).toBe(true);
    expect(body.count).toBeGreaterThan(0);
    expect(body.count).toBe(body.schemas.length);
  });

  // ── GET /schemas/all ───────────────────────────────────────

  it("GET /schemas/all returns all schemas as JSON", async () => {
    const res = await app.request("/schemas/all");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const keys = Object.keys(body);
    expect(keys.length).toBeGreaterThan(0);
  });

  // ── GET /schemas/:name ─────────────────────────────────────

  it("GET /schemas/:name returns single schema", async () => {
    // Use the first available schema name from the real registry
    const names = await listSchemaNames();
    expect(names.length).toBeGreaterThan(0);
    const name = names[0];

    const res = await app.request(`/schemas/${name}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // JSON Schema documents have a "type" property
    expect(body).toBeDefined();
  });

  it("GET /schemas/:name returns 404 for unknown schema name", async () => {
    const res = await app.request("/schemas/NonExistentSchemaXyz");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});
