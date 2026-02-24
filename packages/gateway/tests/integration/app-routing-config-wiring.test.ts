import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

describe("gateway app routing config wiring", () => {
  it("serves routing config endpoints", async () => {
    const { app, container } = await createTestApp();
    try {
      const res = await app.request("/routing/config", { method: "GET" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { revision: number };
      expect(body.revision).toBe(0);
    } finally {
      await container.db.close();
    }
  });
});

