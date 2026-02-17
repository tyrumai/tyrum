import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createSecretRoutes } from "../../src/routes/secret.js";
import { EnvSecretProvider } from "../../src/modules/secret/provider.js";

describe("Secret routes (integration)", () => {
  function setup() {
    const provider = new EnvSecretProvider();
    const app = new Hono();
    app.route("/", createSecretRoutes(provider));
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
