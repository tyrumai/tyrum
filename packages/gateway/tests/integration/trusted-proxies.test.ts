import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { createTestApp } from "./helpers.js";

async function startServer(server: Server): Promise<number> {
  return await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr !== null ? addr.port : 0);
    });
  });
}

describe("Trusted proxies", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  it("ignores forwarding headers when trusted proxies allowlist is unset", async () => {
    const { app, container, auth } = await createTestApp();
    const requestListener = getRequestListener(app.fetch);
    server = createServer(requestListener);
    const port = await startServer(server);

    const pending = await container.nodePairingDal.upsertOnConnect({
      nodeId: "node-1",
      pubkey: "pubkey-1",
      label: "node-1",
      capabilities: ["cli"],
      nowIso: "2026-02-23T00:00:00.000Z",
    });
    expect(pending.status).toBe("pending");

    const res = await fetch(
      `http://127.0.0.1:${String(port)}/pairings/${String(pending.pairing_id)}/approve`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${auth.tenantAdminToken}`,
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.9",
        },
        body: JSON.stringify({
          trust_level: "remote",
          capability_allowlist: [],
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status?: string;
      pairing?: { resolution?: { resolved_by?: { ip?: string } } };
    };
    expect(body.status).toBe("ok");
    expect(body.pairing?.resolution?.resolved_by?.ip).toBe("127.0.0.1");

    await container.db.close();
  });

  it("accepts forwarding headers only from explicit trusted proxies allowlist", async () => {
    const { app, container, auth } = await createTestApp({
      deploymentConfig: { server: { trustedProxies: "127.0.0.1" } },
    });
    const requestListener = getRequestListener(app.fetch);
    server = createServer(requestListener);
    const port = await startServer(server);

    const pending = await container.nodePairingDal.upsertOnConnect({
      nodeId: "node-1",
      pubkey: "pubkey-1",
      label: "node-1",
      capabilities: ["cli"],
      nowIso: "2026-02-23T00:00:00.000Z",
    });
    expect(pending.status).toBe("pending");

    const res = await fetch(
      `http://127.0.0.1:${String(port)}/pairings/${String(pending.pairing_id)}/approve`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${auth.tenantAdminToken}`,
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.9",
        },
        body: JSON.stringify({
          trust_level: "remote",
          capability_allowlist: [],
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status?: string;
      pairing?: { resolution?: { resolved_by?: { ip?: string } } };
    };
    expect(body.status).toBe("ok");
    expect(body.pairing?.resolution?.resolved_by?.ip).toBe("203.0.113.9");

    await container.db.close();
  });

  it("falls back to socket ip when forwarding headers are invalid", async () => {
    const { app, container, auth } = await createTestApp({
      deploymentConfig: { server: { trustedProxies: "127.0.0.1" } },
    });
    const requestListener = getRequestListener(app.fetch);
    server = createServer(requestListener);
    const port = await startServer(server);

    const pending = await container.nodePairingDal.upsertOnConnect({
      nodeId: "node-1",
      pubkey: "pubkey-1",
      label: "node-1",
      capabilities: ["cli"],
      nowIso: "2026-02-23T00:00:00.000Z",
    });
    expect(pending.status).toBe("pending");

    const res = await fetch(
      `http://127.0.0.1:${String(port)}/pairings/${String(pending.pairing_id)}/approve`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${auth.tenantAdminToken}`,
          "content-type": "application/json",
          "x-forwarded-for": "not-an-ip",
        },
        body: JSON.stringify({
          trust_level: "remote",
          capability_allowlist: [],
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status?: string;
      pairing?: { resolution?: { resolved_by?: { ip?: string } } };
    };
    expect(body.status).toBe("ok");
    expect(body.pairing?.resolution?.resolved_by?.ip).toBe("127.0.0.1");

    await container.db.close();
  });

  it("parses RFC7239 Forwarded header when proxy is trusted", async () => {
    const { app, container, auth } = await createTestApp({
      deploymentConfig: { server: { trustedProxies: "127.0.0.1" } },
    });
    const requestListener = getRequestListener(app.fetch);
    server = createServer(requestListener);
    const port = await startServer(server);

    const pending = await container.nodePairingDal.upsertOnConnect({
      nodeId: "node-1",
      pubkey: "pubkey-1",
      label: "node-1",
      capabilities: ["cli"],
      nowIso: "2026-02-23T00:00:00.000Z",
    });
    expect(pending.status).toBe("pending");

    const res = await fetch(
      `http://127.0.0.1:${String(port)}/pairings/${String(pending.pairing_id)}/approve`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${auth.tenantAdminToken}`,
          "content-type": "application/json",
          forwarded: "for=203.0.113.11;proto=https;by=127.0.0.1",
        },
        body: JSON.stringify({
          trust_level: "remote",
          capability_allowlist: [],
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status?: string;
      pairing?: { resolution?: { resolved_by?: { ip?: string } } };
    };
    expect(body.status).toBe("ok");
    expect(body.pairing?.resolution?.resolved_by?.ip).toBe("203.0.113.11");

    await container.db.close();
  });

  it("rejects spoofed X-Forwarded-For leftmost entries when proxy appends", async () => {
    const { app, container, auth } = await createTestApp({
      deploymentConfig: { server: { trustedProxies: "127.0.0.1" } },
    });
    const requestListener = getRequestListener(app.fetch);
    server = createServer(requestListener);
    const port = await startServer(server);

    const pending = await container.nodePairingDal.upsertOnConnect({
      nodeId: "node-1",
      pubkey: "pubkey-1",
      label: "node-1",
      capabilities: ["cli"],
      nowIso: "2026-02-23T00:00:00.000Z",
    });
    expect(pending.status).toBe("pending");

    const res = await fetch(
      `http://127.0.0.1:${String(port)}/pairings/${String(pending.pairing_id)}/approve`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${auth.tenantAdminToken}`,
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.9, 198.51.100.10",
        },
        body: JSON.stringify({
          trust_level: "remote",
          capability_allowlist: [],
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status?: string;
      pairing?: { resolution?: { resolved_by?: { ip?: string } } };
    };
    expect(body.status).toBe("ok");
    expect(body.pairing?.resolution?.resolved_by?.ip).toBe("198.51.100.10");

    await container.db.close();
  });
});
