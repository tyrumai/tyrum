import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestApp } from "./helpers.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("gateway app routing config wiring", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tyrum-routing-config-wiring-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("rejects routing config endpoints without a token", async () => {
    const { container, requestUnauthenticated } = await createTestApp({ tyrumHome: tempDir });
    try {
      const res = await requestUnauthenticated("/routing/config", { method: "GET" });
      expect(res.status).toBe(401);
    } finally {
      await container.db.close();
    }
  });

  it("serves routing config endpoints for tenant admin tokens", async () => {
    const { app, container, auth } = await createTestApp({ tyrumHome: tempDir });
    try {
      const res = await app.request("/routing/config", {
        method: "GET",
        headers: { Authorization: `Bearer ${auth.tenantAdminToken}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { revision: number };
      expect(body.revision).toBe(0);
    } finally {
      await container.db.close();
    }
  });

  it("forbids routing config endpoints for scoped tokens without operator.admin", async () => {
    const { container, requestUnauthenticated, auth } = await createTestApp({ tyrumHome: tempDir });
    try {
      const issued = await auth.authTokens.issueToken({
        tenantId: DEFAULT_TENANT_ID,
        role: "client",
        scopes: ["operator.read"],
        deviceId: "dev-client-1",
        ttlSeconds: 300,
      });

      const res = await requestUnauthenticated("/routing/config", {
        method: "GET",
        headers: { Authorization: `Bearer ${issued.token}` },
      });
      expect(res.status).toBe(403);
    } finally {
      await container.db.close();
    }
  });
});
