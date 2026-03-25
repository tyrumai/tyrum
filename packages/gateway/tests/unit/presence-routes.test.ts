/**
 * presence.ts — unit tests for presence route branches.
 *
 * Covers null/undefined coalescing paths in the peer entry mapping.
 */

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createPresenceRoutes } from "../../src/routes/presence.js";
import type { PresenceDal } from "../../src/modules/presence/dal.js";

function makePresenceDal(rows: Awaited<ReturnType<PresenceDal["listNonExpired"]>>): {
  dal: PresenceDal;
  listNonExpired: ReturnType<typeof vi.fn>;
} {
  const listNonExpired = vi.fn().mockResolvedValue(rows);
  const dal = {
    listNonExpired,
    upsert: vi.fn(),
    deleteByConnectionId: vi.fn(),
    deleteByInstanceId: vi.fn(),
    pruneExpired: vi.fn(),
  } as unknown as PresenceDal;
  return { dal, listNonExpired };
}

function buildApp(dal: PresenceDal, tenantId = "00000000-0000-4000-8000-00000000b001"): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("authClaims", {
      tenant_id: tenantId,
    });
    await next();
  });
  app.route(
    "/",
    createPresenceRoutes({
      instanceId: "gw-1",
      version: "1.0.0",
      role: "all",
      presenceDal: dal,
    }),
  );
  return app;
}

describe("GET /presence", () => {
  it("returns gateway self entry when no peers are connected", async () => {
    const presenceDal = makePresenceDal([]);
    const app = buildApp(presenceDal.dal);
    const res = await app.request("/presence");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      entries: Array<Record<string, unknown>>;
    };
    expect(body.status).toBe("ok");
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]!["role"]).toBe("gateway");
    expect(body.entries[0]!["instance_id"]).toBe("gw-1");
    expect(body.entries[0]!["version"]).toBe("1.0.0");
    expect(presenceDal.listNonExpired).toHaveBeenCalledWith(
      expect.any(Number),
      200,
      "00000000-0000-4000-8000-00000000b001",
    );
  });

  it("maps peer entries with null optional fields to undefined", async () => {
    const nowMs = Date.now();
    const presenceDal = makePresenceDal([
      {
        tenant_id: "00000000-0000-4000-8000-00000000b001",
        instance_id: "peer-1",
        role: "client",
        host: null,
        ip: null,
        version: null,
        mode: null,
        connected_at_ms: nowMs - 10_000,
        last_seen_at_ms: nowMs,
        expires_at_ms: nowMs + 30_000,
        last_input_seconds: null,
        metadata: {},
      },
    ]);
    const app = buildApp(presenceDal.dal);

    const res = await app.request("/presence");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<Record<string, unknown>>;
    };
    expect(body.entries).toHaveLength(2);

    const peer = body.entries[1]!;
    expect(peer["instance_id"]).toBe("peer-1");
    // Null fields should not appear in JSON (serialized as undefined)
    expect(peer).not.toHaveProperty("host");
    expect(peer).not.toHaveProperty("ip");
    expect(peer).not.toHaveProperty("version");
    expect(peer).not.toHaveProperty("mode");
    expect(peer).not.toHaveProperty("last_input_seconds");
    expect(presenceDal.listNonExpired).toHaveBeenCalledWith(
      expect.any(Number),
      200,
      "00000000-0000-4000-8000-00000000b001",
    );
  });

  it("maps peer entries with present optional fields", async () => {
    const nowMs = Date.now();
    const presenceDal = makePresenceDal([
      {
        tenant_id: "00000000-0000-4000-8000-00000000b001",
        instance_id: "peer-2",
        role: "node",
        host: "my-host",
        ip: "10.0.0.1",
        version: "2.0.0",
        mode: "desktop",
        connected_at_ms: nowMs - 5_000,
        last_seen_at_ms: nowMs,
        expires_at_ms: nowMs + 60_000,
        last_input_seconds: 42,
        metadata: { capabilities: ["shell"] },
      },
    ]);
    const app = buildApp(presenceDal.dal);

    const res = await app.request("/presence");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<Record<string, unknown>>;
    };
    const peer = body.entries[1]!;
    expect(peer["host"]).toBe("my-host");
    expect(peer["ip"]).toBe("10.0.0.1");
    expect(peer["version"]).toBe("2.0.0");
    expect(peer["mode"]).toBe("desktop");
    expect(peer["last_input_seconds"]).toBe(42);
    expect(typeof peer["connected_at"]).toBe("string");
    expect(typeof peer["expires_at"]).toBe("string");
    expect(presenceDal.listNonExpired).toHaveBeenCalledWith(
      expect.any(Number),
      200,
      "00000000-0000-4000-8000-00000000b001",
    );
  });
});
