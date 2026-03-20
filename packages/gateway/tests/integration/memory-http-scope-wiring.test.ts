import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { createTestApp } from "./helpers.js";

describe("memory HTTP scope wiring", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tyrum-memory-http-scope-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("allows memory read routes for operator.read scoped device tokens", async () => {
    const { container, requestUnauthenticated, auth } = await createTestApp({
      tyrumHome: tempDir,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    try {
      const issued = await auth.authTokens.issueToken({
        tenantId: DEFAULT_TENANT_ID,
        role: "client",
        scopes: ["operator.read"],
        deviceId: "device-memory-read",
        ttlSeconds: 300,
      });

      for (const path of [
        "/memory/items",
        "/memory/items/missing-item",
        "/memory/search?query=memory",
        "/memory/tombstones",
      ]) {
        const res = await requestUnauthenticated(path, {
          method: "GET",
          headers: { Authorization: `Bearer ${issued.token}` },
        });
        expect([200, 404], path).toContain(res.status);
        await expect(res.json()).resolves.not.toMatchObject({
          error: "forbidden",
          message: "route is not scope-authorized for scoped tokens",
        });
      }
    } finally {
      await container.db.close();
    }
  });

  it("keeps memory delete forbidden for operator.read but allows operator.write", async () => {
    const { container, requestUnauthenticated, auth } = await createTestApp({
      tyrumHome: tempDir,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    try {
      const readIssued = await auth.authTokens.issueToken({
        tenantId: DEFAULT_TENANT_ID,
        role: "client",
        scopes: ["operator.read"],
        deviceId: "device-memory-read-only",
        ttlSeconds: 300,
      });
      const writeIssued = await auth.authTokens.issueToken({
        tenantId: DEFAULT_TENANT_ID,
        role: "client",
        scopes: ["operator.write"],
        deviceId: "device-memory-write",
        ttlSeconds: 300,
      });

      const readRes = await requestUnauthenticated("/memory/items/missing-item", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${readIssued.token}` },
      });
      expect(readRes.status).toBe(403);
      await expect(readRes.json()).resolves.toMatchObject({
        error: "forbidden",
        message: "insufficient scope",
      });

      const writeRes = await requestUnauthenticated("/memory/items/missing-item", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${writeIssued.token}` },
      });
      expect(writeRes.status).toBe(404);
      await expect(writeRes.json()).resolves.toMatchObject({
        error: "not_found",
        message: "memory item not found",
      });
    } finally {
      await container.db.close();
    }
  });

  it("allows elevated-mode device tokens to read memory routes", async () => {
    const { container, requestUnauthenticated, auth } = await createTestApp({
      tyrumHome: tempDir,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    try {
      const issued = await auth.authTokens.issueToken({
        tenantId: DEFAULT_TENANT_ID,
        role: "client",
        scopes: [
          "operator.read",
          "operator.write",
          "operator.approvals",
          "operator.pairing",
          "operator.admin",
        ],
        deviceId: "device-memory-elevated",
        ttlSeconds: 300,
      });

      const res = await requestUnauthenticated("/memory/items", {
        method: "GET",
        headers: { Authorization: `Bearer ${issued.token}` },
      });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        items: [],
      });
    } finally {
      await container.db.close();
    }
  });
});
