import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { NodePairingDal } from "../../src/modules/node/pairing-dal.js";
import { createPairingRoutes } from "../../src/routes/pairing.js";

describe("Pairing routes", () => {
  let db: SqliteDb;
  let nodePairingDal: NodePairingDal;
  let app: Hono;

  beforeEach(() => {
    db = openTestSqliteDb();
    nodePairingDal = new NodePairingDal(db);
    app = new Hono();
    app.route("/", createPairingRoutes({ nodePairingDal }));
  });

  afterEach(async () => {
    await db.close();
  });

  async function seedPendingPairing(): Promise<number> {
    const pending = await nodePairingDal.upsertOnConnect({
      nodeId: "node-1",
      pubkey: "pubkey-1",
      label: "node-1",
      capabilities: ["cli"],
      nowIso: "2026-02-23T00:00:00.000Z",
    });
    expect(pending.status).toBe("pending");
    return pending.pairing_id;
  }

  it("rejects approve when trust_level is missing", async () => {
    const pairingId = await seedPendingPairing();
    const res = await app.request(`/pairings/${String(pairingId)}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: "ok",
        capability_allowlist: [],
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("invalid_request");
  });

  it("rejects approve when capability_allowlist is missing", async () => {
    const pairingId = await seedPendingPairing();
    const res = await app.request(`/pairings/${String(pairingId)}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: "ok",
        trust_level: "remote",
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("invalid_request");
  });

  it("allows approving with an explicitly empty capability_allowlist", async () => {
    const pairingId = await seedPendingPairing();
    const res = await app.request(`/pairings/${String(pairingId)}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: "ok",
        trust_level: "remote",
        capability_allowlist: [],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status?: string;
      pairing?: { status?: string; capability_allowlist?: unknown[] };
    };
    expect(body.status).toBe("ok");
    expect(body.pairing?.status).toBe("approved");
    expect(body.pairing?.capability_allowlist).toEqual([]);
  });

  it("does not return scoped_token in the approve response body", async () => {
    const pairingId = await seedPendingPairing();
    const res = await app.request(`/pairings/${String(pairingId)}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: "ok",
        trust_level: "remote",
        capability_allowlist: [],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(body, "scoped_token")).toBe(false);
  });
});
