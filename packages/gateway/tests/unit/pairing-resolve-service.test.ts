import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveNodePairing } from "../../src/modules/node/pairing-resolve-service.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { NodePairingDal } from "../../src/modules/node/pairing-dal.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("resolveNodePairing", () => {
  let db: SqliteDb;
  let nodePairingDal: NodePairingDal;

  beforeEach(() => {
    db = openTestSqliteDb();
    nodePairingDal = new NodePairingDal(db);
  });

  afterEach(async () => {
    await db.close();
  });

  async function seedAwaitingHumanPairing(nodeId: string): Promise<number> {
    const pairing = await nodePairingDal.upsertOnConnect({
      tenantId: DEFAULT_TENANT_ID,
      nodeId,
      pubkey: `${nodeId}-pubkey`,
      label: nodeId,
      capabilities: ["desktop"],
      motivation: "Human review is required before this node can be paired.",
      initialStatus: "awaiting_human",
      nowIso: "2026-02-23T00:00:00.000Z",
    });
    expect(pairing.status).toBe("awaiting_human");
    return pairing.pairing_id;
  }

  it("approves a pairing once and does not replay side effects on duplicate approval", async () => {
    const pairingId = await seedAwaitingHumanPairing("node-1");
    const deliveredTokens: Array<{ nodeId: string; scopedToken: string }> = [];
    const emittedTypes: string[] = [];

    const first = await resolveNodePairing(
      {
        nodePairingDal,
        emitEvent: ({ event }) => {
          emittedTypes.push(event.type);
        },
        emitPairingApproved: ({ nodeId, scopedToken }) => {
          deliveredTokens.push({ nodeId, scopedToken });
        },
      },
      {
        tenantId: DEFAULT_TENANT_ID,
        pairingId,
        decision: "approved",
        trustLevel: "remote",
        capabilityAllowlist: [],
        resolvedBy: { kind: "http" },
      },
    );

    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.message);
    expect(first.pairing.status).toBe("approved");
    expect(deliveredTokens).toHaveLength(1);
    expect(deliveredTokens[0]).toMatchObject({ nodeId: "node-1" });
    expect(deliveredTokens[0]?.scopedToken.length).toBeGreaterThan(0);
    expect(emittedTypes).toEqual(["pairing.updated"]);
    expect(
      (await nodePairingDal.getById(pairingId, DEFAULT_TENANT_ID, true))?.latest_review
        ?.decision_payload,
    ).toEqual({
      decision: "approved",
      reason: null,
      trust_level: "remote",
      capability_allowlist: [],
      actor: { kind: "http" },
    });

    const second = await resolveNodePairing(
      {
        nodePairingDal,
        emitEvent: ({ event }) => {
          emittedTypes.push(event.type);
        },
        emitPairingApproved: ({ nodeId, scopedToken }) => {
          deliveredTokens.push({ nodeId, scopedToken });
        },
      },
      {
        tenantId: DEFAULT_TENANT_ID,
        pairingId,
        decision: "approved",
        trustLevel: "remote",
        capabilityAllowlist: [],
        resolvedBy: { kind: "http" },
      },
    );

    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.message);
    expect(second.pairing.status).toBe("approved");
    expect(deliveredTokens).toHaveLength(1);
    expect(emittedTypes).toEqual(["pairing.updated"]);
  });

  it("only emits pairing.approved delivery for approvals", async () => {
    const denyPairingId = await seedAwaitingHumanPairing("node-deny");
    const revokePairingId = await seedAwaitingHumanPairing("node-revoke");
    const deliveredTokens: Array<{ nodeId: string; scopedToken: string }> = [];
    const emittedTypes: string[] = [];

    const denied = await resolveNodePairing(
      {
        nodePairingDal,
        emitEvent: ({ event }) => {
          emittedTypes.push(event.type);
        },
        emitPairingApproved: ({ nodeId, scopedToken }) => {
          deliveredTokens.push({ nodeId, scopedToken });
        },
      },
      {
        tenantId: DEFAULT_TENANT_ID,
        pairingId: denyPairingId,
        decision: "denied",
        reason: "too risky",
        resolvedBy: { kind: "http" },
      },
    );

    expect(denied.ok).toBe(true);
    if (!denied.ok) throw new Error(denied.message);
    expect(denied.pairing.status).toBe("denied");
    expect(deliveredTokens).toHaveLength(0);
    expect(emittedTypes).toEqual(["pairing.updated"]);

    emittedTypes.length = 0;

    const approved = await resolveNodePairing(
      {
        nodePairingDal,
      },
      {
        tenantId: DEFAULT_TENANT_ID,
        pairingId: revokePairingId,
        decision: "approved",
        trustLevel: "remote",
        capabilityAllowlist: [],
        resolvedBy: { kind: "http" },
      },
    );
    expect(approved.ok).toBe(true);
    if (!approved.ok) throw new Error(approved.message);

    const revoked = await resolveNodePairing(
      {
        nodePairingDal,
        emitEvent: ({ event }) => {
          emittedTypes.push(event.type);
        },
        emitPairingApproved: ({ nodeId, scopedToken }) => {
          deliveredTokens.push({ nodeId, scopedToken });
        },
      },
      {
        tenantId: DEFAULT_TENANT_ID,
        pairingId: revokePairingId,
        decision: "revoked",
        reason: "rotated credentials",
        resolvedBy: { kind: "http" },
      },
    );

    expect(revoked.ok).toBe(true);
    if (!revoked.ok) throw new Error(revoked.message);
    expect(revoked.pairing.status).toBe("revoked");
    expect(deliveredTokens).toHaveLength(0);
    expect(emittedTypes).toEqual(["pairing.updated"]);
    expect(
      (await nodePairingDal.getById(revokePairingId, DEFAULT_TENANT_ID, true))?.latest_review
        ?.decision_payload,
    ).toEqual({
      decision: "revoked",
      reason: "rotated credentials",
      actor: { kind: "http" },
    });
  });
});
