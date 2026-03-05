import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

describe("legacy gateway-hosted web UI routes", () => {
  it("does not serve the retired /app SSR UI (404)", async () => {
    const { app, container } = await createTestApp();

    const res = await app.request("/app");
    expect(res.status).toBe(404);

    await container.db.close();
  });

  it("does not serve /consent or legacy /api compatibility routes (404)", async () => {
    const { app, container } = await createTestApp();

    expect((await app.request("/consent")).status).toBe(404);
    expect((await app.request("/api/profiles")).status).toBe(404);

    await container.db.close();
  });
});
