import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { createTestApp } from "./helpers.js";

describe("elevated admin HTTP scope wiring", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tyrum-elevated-admin-http-scope-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("allows scoped device tokens with operator.admin on elevated admin route families", async () => {
    const { container, requestUnauthenticated, auth } = await createTestApp({
      tyrumHome: tempDir,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    try {
      const issued = await auth.authTokens.issueToken({
        tenantId: DEFAULT_TENANT_ID,
        role: "client",
        scopes: ["operator.admin"],
        deviceId: "device-elevated-admin",
        ttlSeconds: 300,
      });

      for (const path of ["/agents", "/desktop-environment-hosts", "/desktop-environments"]) {
        const res = await requestUnauthenticated(path, {
          method: "GET",
          headers: { Authorization: `Bearer ${issued.token}` },
        });
        expect(res.status, path).toBe(200);
      }

      const deploymentRes = await requestUnauthenticated("/config/policy/deployment", {
        method: "GET",
        headers: { Authorization: `Bearer ${issued.token}` },
      });
      expect(deploymentRes.status, "/config/policy/deployment").toBe(404);
      await expect(deploymentRes.json()).resolves.toMatchObject({
        error: "not_found",
      });

      const revisionsRes = await requestUnauthenticated("/config/policy/deployment/revisions", {
        method: "GET",
        headers: { Authorization: `Bearer ${issued.token}` },
      });
      expect(revisionsRes.status, "/config/policy/deployment/revisions").toBe(200);
      await expect(revisionsRes.json()).resolves.toEqual({ revisions: [] });
    } finally {
      await container.db.close();
    }
  });

  it("keeps the elevated admin route families forbidden for scoped tokens without operator.admin", async () => {
    const { container, requestUnauthenticated, auth } = await createTestApp({
      tyrumHome: tempDir,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    try {
      const issued = await auth.authTokens.issueToken({
        tenantId: DEFAULT_TENANT_ID,
        role: "client",
        scopes: ["operator.read"],
        deviceId: "device-read-only",
        ttlSeconds: 300,
      });

      for (const path of [
        "/agents",
        "/desktop-environment-hosts",
        "/desktop-environments",
        "/config/policy/deployment",
        "/config/policy/deployment/revisions",
      ]) {
        const res = await requestUnauthenticated(path, {
          method: "GET",
          headers: { Authorization: `Bearer ${issued.token}` },
        });
        expect(res.status, path).toBe(403);
        await expect(res.json()).resolves.toMatchObject({
          error: "forbidden",
          message: "insufficient scope",
        });
      }
    } finally {
      await container.db.close();
    }
  });
});
