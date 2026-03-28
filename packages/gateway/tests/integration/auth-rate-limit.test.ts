import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestApp } from "./helpers.js";
import { SlidingWindowRateLimiter } from "../../src/modules/auth/rate-limiter.js";

async function startServer(server: Server): Promise<number> {
  return await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr !== null ? addr.port : 0);
    });
  });
}

describe("Auth rate limiting", () => {
  let server: Server | undefined;
  let tokenHome: string | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }

    if (tokenHome) {
      await rm(tokenHome, { recursive: true, force: true });
      tokenHome = undefined;
    }
  });

  it("returns 429 Too Many Requests after 20 /auth/cookie requests per minute", async () => {
    tokenHome = await mkdtemp(join(tmpdir(), "tyrum-auth-rate-limit-"));

    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      max: 20,
      cleanupIntervalMs: 0,
    });

    const { app, container, auth } = await createTestApp({
      tyrumHome: tokenHome,
      isLocalOnly: true,
      authRateLimiter: limiter,
    });
    const adminToken = auth.tenantAdminToken;

    const requestListener = getRequestListener(app.fetch);
    server = createServer(requestListener);
    const port = await startServer(server);
    const url = `http://127.0.0.1:${String(port)}/auth/cookie`;

    for (let i = 0; i < 20; i += 1) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: adminToken }),
      });
      expect(res.status).toBe(204);
    }

    const rateLimited = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: adminToken }),
    });

    expect(rateLimited.status).toBe(429);
    const retryAfter = rateLimited.headers.get("retry-after");
    expect(retryAfter).toBeTruthy();
    const retryAfterSeconds = Number(retryAfter);
    expect(Number.isFinite(retryAfterSeconds)).toBe(true);
    expect(retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(retryAfterSeconds).toBeLessThanOrEqual(60);

    limiter.stop();
    await container.db.close();
  });

  it("returns 429 Too Many Requests after 2 /auth/device-tokens/issue requests per minute", async () => {
    tokenHome = await mkdtemp(join(tmpdir(), "tyrum-auth-rate-limit-device-tokens-"));

    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      max: 2,
      cleanupIntervalMs: 0,
    });

    const { app, container, auth } = await createTestApp({
      tyrumHome: tokenHome,
      isLocalOnly: true,
      authRateLimiter: limiter,
    });
    const adminToken = auth.tenantAdminToken;

    const requestListener = getRequestListener(app.fetch);
    server = createServer(requestListener);
    const port = await startServer(server);
    const url = `http://127.0.0.1:${String(port)}/auth/device-tokens/issue`;

    for (let i = 0; i < 2; i += 1) {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          device_id: `test-device-${String(i + 1)}`,
          role: "client",
          scopes: ["*"],
        }),
      });
      expect(res.status).toBe(201);
    }

    const rateLimited = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        device_id: "test-device-3",
        role: "client",
        scopes: ["*"],
      }),
    });

    expect(rateLimited.status).toBe(429);

    limiter.stop();
    await container.db.close();
  });
});
