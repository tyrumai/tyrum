import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

describe("Gateway JSON Schema publishing", () => {
  it("serves a JSON Schema catalog for contracts", async () => {
    const { app } = await createTestApp();

    const res = await app.request("/contracts/jsonschema/catalog.json");
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      format: string;
      schemas: Array<{ name: string; file: string; $id: string }>;
      errors?: unknown;
    };

    expect(json.format).toBe("tyrum.contracts.jsonschema.catalog.v1");
    expect(Array.isArray(json.schemas)).toBe(true);
    expect(json.schemas.length).toBeGreaterThan(50);
    expect(json.errors).toBeUndefined();

    const names = new Set(json.schemas.map((s) => s.name));
    expect(names.has("WsConnectInitRequest")).toBe(true);
    expect(names.has("PluginManifest")).toBe(true);
    expect(names.has("PolicyBundle")).toBe(true);
  });

  it("serves individual contract JSON Schemas by file name", async () => {
    const { app } = await createTestApp();

    const res = await app.request(
      "/contracts/jsonschema/WsConnectInitRequest.json",
    );
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      $schema?: string;
      $id?: string;
      title?: string;
    };

    expect(json.$schema).toBeTypeOf("string");
    expect(json.$id).toMatch(/WsConnectInitRequest\.json$/);
    expect(json.title).toBe("WsConnectInitRequest");
  });
});

