import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { createSecretRoutes } from "../../src/routes/secret.js";
import { EnvSecretProvider, FileSecretProvider } from "../../src/modules/secret/provider.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Secret routes (integration)", () => {
  function setup() {
    const provider = new EnvSecretProvider();
    const app = new Hono();
    app.route("/", createSecretRoutes({ secretProvider: provider }));
    return { app, provider };
  }

  it("POST /secrets stores a secret and returns a handle", async () => {
    const { app } = setup();

    const res = await app.request("/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "MY_API_KEY", value: "super-secret-123" }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { handle: { handle_id: string; provider: string; scope: string } };
    expect(body.handle.handle_id).toBeTruthy();
    expect(body.handle.provider).toBe("env");
    expect(body.handle.scope).toBe("MY_API_KEY");
    // Value must never be in the response
    expect(JSON.stringify(body)).not.toContain("super-secret-123");
  });

  it("POST /secrets supports env handles without sending a value", async () => {
    const { app } = setup();

    const res = await app.request("/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "MY_API_KEY" }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { handle: { provider: string; scope: string } };
    expect(body.handle.provider).toBe("env");
    expect(body.handle.scope).toBe("MY_API_KEY");
  });

  it("GET /secrets lists stored handles", async () => {
    const { app } = setup();

    // Store two secrets
    await app.request("/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "KEY_A", value: "val-a" }),
    });
    await app.request("/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "KEY_B", value: "val-b" }),
    });

    const res = await app.request("/secrets");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { handles: Array<{ scope: string }> };
    expect(body.handles).toHaveLength(2);
    expect(body.handles.map((h) => h.scope).sort()).toEqual(["KEY_A", "KEY_B"]);
    // Values must never be in the response
    expect(JSON.stringify(body)).not.toContain("val-a");
    expect(JSON.stringify(body)).not.toContain("val-b");
  });

  it("DELETE /secrets/:id revokes a handle", async () => {
    const { app } = setup();

    const storeRes = await app.request("/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "TEMP_KEY", value: "temp-val" }),
    });
    const { handle } = (await storeRes.json()) as { handle: { handle_id: string } };

    const deleteRes = await app.request(`/secrets/${handle.handle_id}`, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);
    const deleteBody = (await deleteRes.json()) as { revoked: boolean };
    expect(deleteBody.revoked).toBe(true);

    // Verify it's gone from the list
    const listRes = await app.request("/secrets");
    const listBody = (await listRes.json()) as { handles: unknown[] };
    expect(listBody.handles).toHaveLength(0);
  });

  it("DELETE /secrets/:id returns 404 for unknown handle", async () => {
    const { app } = setup();

    const res = await app.request("/secrets/nonexistent-id", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  it("POST /secrets/:id/rotate rejects rotation for env provider", async () => {
    const { app } = setup();

    const storeRes = await app.request("/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "ROTATE_ME", value: "v1" }),
    });
    const { handle } = (await storeRes.json()) as { handle: { handle_id: string } };

    const rotateRes = await app.request(`/secrets/${handle.handle_id}/rotate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "v2" }),
    });
    expect(rotateRes.status).toBe(400);
  });

  it("POST /secrets rejects invalid body", async () => {
    const { app } = setup();

    const res = await app.request("/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "", value: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("full flow: store -> list -> revoke -> list", async () => {
    const { app } = setup();

    // Store
    const storeRes = await app.request("/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "FULL_FLOW_KEY", value: "flow-val" }),
    });
    expect(storeRes.status).toBe(201);
    const { handle } = (await storeRes.json()) as { handle: { handle_id: string } };

    // List — should have 1
    const list1 = await app.request("/secrets");
    const list1Body = (await list1.json()) as { handles: unknown[] };
    expect(list1Body.handles).toHaveLength(1);

    // Revoke
    const revokeRes = await app.request(`/secrets/${handle.handle_id}`, {
      method: "DELETE",
    });
    expect(revokeRes.status).toBe(200);

    // List — should have 0
    const list2 = await app.request("/secrets");
    const list2Body = (await list2.json()) as { handles: unknown[] };
    expect(list2Body.handles).toHaveLength(0);
  });
});

describe("Secret routes (integration) — file provider rotation", () => {
  let tempDir: string;
  let secretsPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-secret-route-test-"));
    secretsPath = join(tempDir, ".secrets.enc");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function setupFile() {
    const provider = await FileSecretProvider.create(
      secretsPath,
      "test-admin-token-for-testing",
    );
    const app = new Hono();
    app.route("/", createSecretRoutes({ secretProvider: provider }));
    return { app, provider };
  }

  it("POST /secrets/:id/rotate revokes old handle and returns a new handle", async () => {
    const { app, provider } = await setupFile();

    const storeRes = await app.request("/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "DB_PASSWORD", value: "v1" }),
    });
    expect(storeRes.status).toBe(201);
    const { handle: oldHandle } = (await storeRes.json()) as {
      handle: { handle_id: string; scope: string };
    };

    const rotateRes = await app.request(`/secrets/${oldHandle.handle_id}/rotate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "v2" }),
    });
    expect(rotateRes.status).toBe(201);
    const rotateBody = (await rotateRes.json()) as {
      revoked: boolean;
      handle: { handle_id: string; scope: string };
    };
    expect(rotateBody.revoked).toBe(true);
    expect(rotateBody.handle.handle_id).not.toBe(oldHandle.handle_id);
    expect(rotateBody.handle.scope).toBe(oldHandle.scope);

    // Old handle should no longer resolve; new handle should resolve to v2.
    const oldResolved = await provider.resolve({
      handle_id: oldHandle.handle_id,
      provider: "file",
      scope: oldHandle.scope,
      created_at: new Date().toISOString(),
    });
    expect(oldResolved).toBeNull();

    const newResolved = await provider.resolve({
      handle_id: rotateBody.handle.handle_id,
      provider: "file",
      scope: rotateBody.handle.scope,
      created_at: new Date().toISOString(),
    });
    expect(newResolved).toBe("v2");
  });
});
