import { describe, it, expect, afterEach } from "vitest";
import { NodeDal } from "../../src/modules/node/dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { SqlDb } from "../../src/statestore/types.js";

describe("NodeDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  function createDal(): NodeDal {
    db = openTestSqliteDb();
    return new NodeDal(db);
  }

  it("creates a pending pairing request", async () => {
    const dal = createDal();
    const node = await dal.createPairingRequest(
      "node-1",
      "My Edge Node",
      ["playwright", "shell"],
      { region: "us-east" },
    );

    expect(node.node_id).toBe("node-1");
    expect(node.label).toBe("My Edge Node");
    expect(node.capabilities).toEqual(["playwright", "shell"]);
    expect(node.pairing_status).toBe("pending");
    expect(node.requested_at).toBeTruthy();
    expect(node.resolved_at).toBeNull();
    expect(node.resolved_by).toBeNull();
    expect(node.resolution_reason).toBeNull();
    expect(node.metadata).toEqual({ region: "us-east" });
  });

  it("creates a pairing request with minimal params", async () => {
    const dal = createDal();
    const node = await dal.createPairingRequest("node-minimal");

    expect(node.node_id).toBe("node-minimal");
    expect(node.label).toBeNull();
    expect(node.capabilities).toEqual([]);
    expect(node.pairing_status).toBe("pending");
    expect(node.metadata).toBeNull();
  });

  it("resolves pairing to approved", async () => {
    const dal = createDal();
    await dal.createPairingRequest("node-1", "Test Node");

    const resolved = await dal.resolvePairing(
      "node-1",
      "approved",
      "admin@example.com",
      "trusted operator",
    );

    expect(resolved).toBeDefined();
    expect(resolved!.pairing_status).toBe("approved");
    expect(resolved!.resolved_by).toBe("admin@example.com");
    expect(resolved!.resolution_reason).toBe("trusted operator");
    expect(resolved!.resolved_at).toBeTruthy();
  });

  it("resolves pairing to denied", async () => {
    const dal = createDal();
    await dal.createPairingRequest("node-1");

    const resolved = await dal.resolvePairing("node-1", "denied", undefined, "untrusted");
    expect(resolved).toBeDefined();
    expect(resolved!.pairing_status).toBe("denied");
    expect(resolved!.resolution_reason).toBe("untrusted");
  });

  it("returns undefined when resolving non-existent node", async () => {
    const dal = createDal();
    const result = await dal.resolvePairing("does-not-exist", "approved");
    expect(result).toBeUndefined();
  });

  it("returns undefined when resolving already-resolved node", async () => {
    const dal = createDal();
    await dal.createPairingRequest("node-1");
    await dal.resolvePairing("node-1", "approved");

    const second = await dal.resolvePairing("node-1", "denied");
    expect(second).toBeUndefined();

    // Original decision is preserved
    const node = await dal.getById("node-1");
    expect(node!.pairing_status).toBe("approved");
  });

  it("lists all nodes when no status filter", async () => {
    const dal = createDal();
    await dal.createPairingRequest("node-1");
    await dal.createPairingRequest("node-2");
    await dal.createPairingRequest("node-3");
    await dal.resolvePairing("node-2", "approved");

    const all = await dal.listNodes();
    expect(all).toHaveLength(3);
  });

  it("lists nodes filtered by status", async () => {
    const dal = createDal();
    await dal.createPairingRequest("node-1");
    await dal.createPairingRequest("node-2");
    await dal.createPairingRequest("node-3");
    await dal.resolvePairing("node-2", "approved");

    const pending = await dal.listNodes("pending");
    expect(pending).toHaveLength(2);
    expect(pending[0]!.node_id).toBe("node-1");
    expect(pending[1]!.node_id).toBe("node-3");

    const approved = await dal.listNodes("approved");
    expect(approved).toHaveLength(1);
    expect(approved[0]!.node_id).toBe("node-2");
  });

  it("gets a node by ID", async () => {
    const dal = createDal();
    await dal.createPairingRequest("node-1", "Test Node");

    const node = await dal.getById("node-1");
    expect(node).toBeDefined();
    expect(node!.node_id).toBe("node-1");
    expect(node!.label).toBe("Test Node");
  });

  it("returns undefined for non-existent node ID", async () => {
    const dal = createDal();
    expect(await dal.getById("does-not-exist")).toBeUndefined();
  });

  it("revokes a node", async () => {
    const dal = createDal();
    await dal.createPairingRequest("node-1");
    await dal.resolvePairing("node-1", "approved");

    const revoked = await dal.revokeNode("node-1");
    expect(revoked).toBeDefined();
    expect(revoked!.pairing_status).toBe("revoked");
    expect(revoked!.resolved_at).toBeTruthy();
  });

  it("revoke returns undefined for non-existent node", async () => {
    const dal = createDal();
    expect(await dal.revokeNode("does-not-exist")).toBeUndefined();
  });

  it("updates last_seen_at", async () => {
    const dal = createDal();
    await dal.createPairingRequest("node-1");

    const before = await dal.getById("node-1");
    expect(before!.last_seen_at).toBeNull();

    await dal.updateLastSeen("node-1");

    const after = await dal.getById("node-1");
    expect(after!.last_seen_at).toBeTruthy();
  });

  it("normalizes requested_at when Postgres returns Date", async () => {
    const requestedAt = new Date("2024-06-15T12:00:00.000Z");
    const raw = {
      node_id: "node-pg",
      label: null,
      capabilities: "[]",
      pairing_status: "pending",
      requested_at: requestedAt,
      resolved_at: null,
      resolved_by: null,
      resolution_reason: null,
      last_seen_at: null,
      metadata: null,
    };

    const stubDb: SqlDb = {
      kind: "postgres",
      get: async () => raw,
      all: async () => [],
      run: async () => ({ changes: 0 }),
      exec: async () => {},
      transaction: async (fn) => await fn(stubDb),
      close: async () => {},
    };

    const dal = new NodeDal(stubDb);
    const fetched = await dal.getById("node-pg");
    expect(fetched).toBeDefined();
    expect(fetched!.requested_at).toBe(requestedAt.toISOString());
  });
});
