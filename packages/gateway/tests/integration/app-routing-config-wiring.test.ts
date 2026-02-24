import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestApp } from "./helpers.js";
import { TokenStore } from "../../src/modules/auth/token-store.js";

describe("gateway app routing config wiring", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tyrum-routing-config-wiring-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("does not serve routing config endpoints when tokenStore is omitted", async () => {
    const { app, container } = await createTestApp();
    try {
      const res = await app.request("/routing/config", { method: "GET" });
      expect(res.status).toBe(404);
    } finally {
      await container.db.close();
    }
  });

  it("serves routing config endpoints when tokenStore is configured", async () => {
    const tokenStore = new TokenStore(tempDir);
    const adminToken = await tokenStore.initialize();

    const { app, container } = await createTestApp({ tokenStore });
    try {
      const res = await app.request("/routing/config", {
        method: "GET",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { revision: number };
      expect(body.revision).toBe(0);
    } finally {
      await container.db.close();
    }
  });
});
