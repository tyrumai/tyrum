import { describe, it, expect, beforeEach } from "vitest";
import { createTestApp } from "./helpers.js";

describe("System routes integration", () => {
  it("rejects system routes with a tenant token", async () => {
    const { requestUnauthenticated, auth } = await createTestApp({
      isLocalOnly: false,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    const res = await requestUnauthenticated("/system/tenants", {
      headers: { Authorization: `Bearer ${auth.tenantAdminToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("lists tenants with a system token", async () => {
    const { requestUnauthenticated, auth } = await createTestApp({
      isLocalOnly: false,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    const res = await requestUnauthenticated("/system/tenants", {
      headers: { Authorization: `Bearer ${auth.systemToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenants: Array<{ tenant_key: string; name: string }> };
    expect(body.tenants.some((t) => t.tenant_key === "default" && t.name.length > 0)).toBe(true);
  });

  it("creates a tenant and handles conflict", async () => {
    const { requestUnauthenticated, auth } = await createTestApp({
      isLocalOnly: false,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    const create = await requestUnauthenticated("/system/tenants", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.systemToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tenant_key: "acme", name: "Acme Co" }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { tenant: { tenant_key: string; name: string } };
    expect(created.tenant.tenant_key).toBe("acme");
    expect(created.tenant.name).toBe("Acme Co");

    const conflict = await requestUnauthenticated("/system/tenants", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.systemToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tenant_key: "acme" }),
    });
    expect(conflict.status).toBe(409);
  });

  it("validates tenant create payload and JSON parsing", async () => {
    const { requestUnauthenticated, auth } = await createTestApp({
      isLocalOnly: false,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    const invalidJson = await requestUnauthenticated("/system/tenants", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.systemToken}`,
        "Content-Type": "application/json",
      },
      body: "{",
    });
    expect(invalidJson.status).toBe(400);

    const invalidBody = await requestUnauthenticated("/system/tenants", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.systemToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tenant_key: "" }),
    });
    expect(invalidBody.status).toBe(400);
  });

  it("issues and revokes tokens", async () => {
    const { requestUnauthenticated, auth } = await createTestApp({
      isLocalOnly: false,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    const invalidJson = await requestUnauthenticated("/system/tokens/issue", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.systemToken}`,
        "Content-Type": "application/json",
      },
      body: "{",
    });
    expect(invalidJson.status).toBe(400);

    const invalidRole = await requestUnauthenticated("/system/tokens/issue", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.systemToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tenant_id: null,
        role: "client",
        scopes: ["*"],
      }),
    });
    expect(invalidRole.status).toBe(400);

    const issued = await requestUnauthenticated("/system/tokens/issue", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.systemToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tenant_id: auth.tenantId,
        display_name: "System client token",
        role: "client",
        scopes: ["operator.read"],
        device_id: "dev_client_test",
        ttl_seconds: 60,
      }),
    });
    expect(issued.status).toBe(201);
    const issuedBody = (await issued.json()) as {
      token_id: string;
      token: string;
      display_name: string;
      updated_at: string;
    };
    expect(issuedBody.token_id.length > 0).toBe(true);
    expect(issuedBody.token.startsWith("tyrum-token.v1.")).toBe(true);
    expect(issuedBody.display_name).toBe("System client token");
    expect(typeof issuedBody.updated_at).toBe("string");

    const revokeInvalidJson = await requestUnauthenticated("/system/tokens/revoke", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.systemToken}`,
        "Content-Type": "application/json",
      },
      body: "{",
    });
    expect(revokeInvalidJson.status).toBe(400);

    const revoked = await requestUnauthenticated("/system/tokens/revoke", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.systemToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token_id: issuedBody.token_id }),
    });
    expect(revoked.status).toBe(200);

    const missing = await requestUnauthenticated("/system/tokens/revoke", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.systemToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token_id: "missing-token-id" }),
    });
    expect(missing.status).toBe(404);
  });

  describe("deployment config revisions", () => {
    let systemToken: string;
    let requestUnauthenticated: (input: string, init?: RequestInit) => Promise<Response>;

    beforeEach(async () => {
      const app = await createTestApp({
        isLocalOnly: false,
        deploymentConfig: { modelsDev: { disableFetch: true } },
      });
      systemToken = app.auth.systemToken;
      requestUnauthenticated = app.requestUnauthenticated;
    });

    it("seeds and reads the deployment config", async () => {
      const res = await requestUnauthenticated("/system/deployment-config", {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { revision: number; config: unknown };
      expect(body.revision).toBeGreaterThanOrEqual(1);
      expect(typeof body.config).toBe("object");
    });

    it("updates and reverts the deployment config", async () => {
      const seed = await requestUnauthenticated("/system/deployment-config", {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      expect(seed.status).toBe(200);
      const seeded = (await seed.json()) as { revision: number; config: unknown };

      const updateInvalidJson = await requestUnauthenticated("/system/deployment-config", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${systemToken}`,
          "Content-Type": "application/json",
        },
        body: "{",
      });
      expect(updateInvalidJson.status).toBe(400);

      const update = await requestUnauthenticated("/system/deployment-config", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${systemToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          config: seeded.config,
          reason: "test update",
        }),
      });
      expect(update.status).toBe(200);
      const updated = (await update.json()) as { revision: number };
      expect(updated.revision).toBeGreaterThan(seeded.revision);

      const revertInvalidJson = await requestUnauthenticated("/system/deployment-config/revert", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${systemToken}`,
          "Content-Type": "application/json",
        },
        body: "{",
      });
      expect(revertInvalidJson.status).toBe(400);

      const revert = await requestUnauthenticated("/system/deployment-config/revert", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${systemToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ revision: seeded.revision, reason: "test revert" }),
      });
      expect(revert.status).toBe(200);
      const reverted = (await revert.json()) as {
        revision: number;
        reverted_from_revision?: number;
      };
      expect(reverted.revision).toBeGreaterThan(updated.revision);
      expect(reverted.reverted_from_revision).toBe(seeded.revision);
    });
  });
});
