import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

describe("Gateway generated spec publishing", () => {
  it("serves the committed OpenAPI artifact", async () => {
    const { app } = await createTestApp();

    const res = await app.request("/specs/openapi.json");
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      openapi?: string;
      paths?: Record<string, unknown>;
    };

    expect(json.openapi).toBe("3.1.0");
    expect(json.paths).toBeDefined();
    expect(Object.keys(json.paths ?? {})).toContain("/status");
  });

  it("serves the committed AsyncAPI artifact", async () => {
    const { app } = await createTestApp();

    const res = await app.request("/specs/asyncapi.json");
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      asyncapi?: string;
      channels?: Record<string, unknown>;
    };

    expect(json.asyncapi).toBe("2.6.0");
    expect(json.channels).toBeDefined();
    expect(Object.keys(json.channels ?? {})).toContain("/ws");
  });
});
