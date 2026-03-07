import { afterEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { NodePairingDal } from "../../src/modules/node/pairing-dal.js";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
} from "@tyrum/schemas";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("NodePairingDal.upsertOnConnect", () => {
  let db: SqliteDb | undefined;
  const tenantId = DEFAULT_TENANT_ID;

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
      tenantId,
      nodeId,
      pubkey: "pubkey-1",
      label: "node-1",
      capabilities: ["cli"],
      nowIso: "2026-02-23T00:00:00.000Z",
    });
    expect(pending.status).toBe("pending");

    const approved = await dal.resolve({
      tenantId,
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
      tenantId,
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
      tenantId,
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
      tenantId,
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
      tenantId,
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
      tenantId,
      nodeId,
      pubkey: "pubkey-3",
      label: "node-3",
      capabilities: ["cli"],
      nowIso: "2026-02-23T00:00:00.000Z",
    });
    expect(pending.status).toBe("pending");

    const approved = await dal.resolve({
      tenantId,
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

    const approvedReloaded = await dal.getById(approved!.pairing.pairing_id, tenantId);
    expect(approvedReloaded).toBeDefined();
    expect(approvedReloaded!.capability_allowlist).toEqual([]);
  });

  it("rejects pairing writes without a tenant id", async () => {
    db = openTestSqliteDb();
    const dal = new NodePairingDal(db);

    await expect(
      dal.upsertOnConnect({
        tenantId: "   ",
        nodeId: "node-missing-tenant",
        capabilities: ["cli"],
      }),
    ).rejects.toThrow("tenantId is required");
  });

  it("does not cross tenants when resolving pairings", async () => {
    db = openTestSqliteDb();
    const dal = new NodePairingDal(db);
    const otherTenantId = "00000000-0000-4000-8000-000000000099";
    await db.run("INSERT INTO tenants (tenant_id, tenant_key) VALUES (?, ?)", [
      otherTenantId,
      "other-tenant",
    ]);

    const primary = await dal.upsertOnConnect({
      tenantId,
      nodeId: "node-shared",
      pubkey: "pubkey-primary",
      label: "primary",
      capabilities: ["cli"],
      nowIso: "2026-02-23T00:00:00.000Z",
    });
    const secondary = await dal.upsertOnConnect({
      tenantId: otherTenantId,
      nodeId: "node-shared",
      pubkey: "pubkey-secondary",
      label: "secondary",
      capabilities: ["cli"],
      nowIso: "2026-02-23T00:00:01.000Z",
    });

    expect(primary.pairing_id).not.toBe(secondary.pairing_id);
    expect(await dal.getByNodeId("node-shared", tenantId)).toMatchObject({
      pairing_id: primary.pairing_id,
      node: { label: "primary" },
    });
    expect(await dal.getByNodeId("node-shared", otherTenantId)).toMatchObject({
      pairing_id: secondary.pairing_id,
      node: { label: "secondary" },
    });
  });
});
