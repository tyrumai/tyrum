import { afterEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { NodePairingDal } from "../../src/modules/node/pairing-dal.js";
import { CAPABILITY_DESCRIPTOR_DEFAULT_VERSION, descriptorIdForClientCapability } from "@tyrum/schemas";

describe("NodePairingDal.upsertOnConnect", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
  });

  it("does not wipe trust_level or allowlist when reopening after revoke", async () => {
    db = openTestSqliteDb();
    const dal = new NodePairingDal(db);

    const nodeId = "node-1";
    const cliDescriptor = {
      id: descriptorIdForClientCapability("cli"),
      version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
    };

    const pending = await dal.upsertOnConnect({
      nodeId,
      pubkey: "pubkey-1",
      label: "node-1",
      capabilities: ["cli"],
      nowIso: "2026-02-23T00:00:00.000Z",
    });
    expect(pending.status).toBe("pending");

    const approved = await dal.resolve({
      pairingId: pending.pairing_id,
      decision: "approved",
      trustLevel: "local",
      capabilityAllowlist: [cliDescriptor],
      resolvedBy: { kind: "test" },
      nowIso: "2026-02-23T00:00:01.000Z",
    });
    expect(approved).toBeDefined();
    expect(approved!.pairing.status).toBe("approved");
    expect(approved!.pairing.trust_level).toBe("local");
    expect(approved!.pairing.capability_allowlist).toEqual([cliDescriptor]);

    const revoked = await dal.revoke({
      pairingId: approved!.pairing.pairing_id,
      reason: "revoked for test",
      resolvedBy: { kind: "test" },
      nowIso: "2026-02-23T00:00:02.000Z",
    });
    expect(revoked).toBeDefined();
    expect(revoked!.status).toBe("revoked");
    expect(revoked!.trust_level).toBe("local");
    expect(revoked!.capability_allowlist).toEqual([cliDescriptor]);

    const reopened = await dal.upsertOnConnect({
      nodeId,
      pubkey: "pubkey-1",
      label: "node-1",
      capabilities: ["cli"],
      nowIso: "2026-02-23T00:00:03.000Z",
    });
    expect(reopened.status).toBe("pending");
    expect(reopened.trust_level).toBe("local");
    expect(reopened.capability_allowlist).toEqual([cliDescriptor]);
  });

  it("does not wipe trust_level or allowlist when reopening after deny", async () => {
    db = openTestSqliteDb();
    const dal = new NodePairingDal(db);

    const nodeId = "node-2";
    const cliDescriptor = {
      id: descriptorIdForClientCapability("cli"),
      version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
    };

    await dal.upsertOnConnect({
      nodeId,
      pubkey: "pubkey-2",
      label: "node-2",
      capabilities: ["cli"],
      nowIso: "2026-02-23T00:00:00.000Z",
    });

    await db.run(
      `UPDATE node_pairings
       SET status = 'denied',
           trust_level = 'local',
           capability_allowlist_json = ?,
           resolved_at = ?,
           resolved_by_json = ?,
           resolution_reason = ?
       WHERE node_id = ?`,
      [
        JSON.stringify([cliDescriptor]),
        "2026-02-23T00:00:01.000Z",
        JSON.stringify({ kind: "test" }),
        "denied for test",
        nodeId,
      ],
    );

    const reopened = await dal.upsertOnConnect({
      nodeId,
      pubkey: "pubkey-2",
      label: "node-2",
      capabilities: ["cli"],
      nowIso: "2026-02-23T00:00:02.000Z",
    });
    expect(reopened.status).toBe("pending");
    expect(reopened.trust_level).toBe("local");
    expect(reopened.capability_allowlist).toEqual([cliDescriptor]);
  });

  it("allows approving with an explicitly empty allowlist", async () => {
    db = openTestSqliteDb();
    const dal = new NodePairingDal(db);

    const nodeId = "node-3";
    const pending = await dal.upsertOnConnect({
      nodeId,
      pubkey: "pubkey-3",
      label: "node-3",
      capabilities: ["cli"],
      nowIso: "2026-02-23T00:00:00.000Z",
    });
    expect(pending.status).toBe("pending");

    const approved = await dal.resolve({
      pairingId: pending.pairing_id,
      decision: "approved",
      reason: "ok",
      trustLevel: "remote",
      capabilityAllowlist: [],
      resolvedBy: { kind: "test" },
      nowIso: "2026-02-23T00:00:01.000Z",
    });

    expect(approved).toBeDefined();
    expect(approved!.pairing.status).toBe("approved");
    expect(approved!.pairing.trust_level).toBe("remote");
    expect(approved!.pairing.capability_allowlist).toEqual([]);

    const approvedReloaded = await dal.getById(approved!.pairing.pairing_id);
    expect(approvedReloaded).toBeDefined();
    expect(approvedReloaded!.capability_allowlist).toEqual([]);
  });
});
