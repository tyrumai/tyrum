import { afterEach, describe, expect, it } from "vitest";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { toApprovalContract } from "../../src/modules/approval/to-contract.js";
import { NodePairingDal } from "../../src/modules/node/pairing-dal.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { WsEventDal } from "../../src/modules/ws-event/dal.js";
import {
  ensureApprovalResolvedEvent,
  ensurePairingResolvedEvent,
  ensurePolicyOverrideCreatedEvent,
} from "../../src/ws/stable-events.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { OutboxDal } from "../../src/modules/backplane/outbox-dal.js";
import { broadcastWsEvent } from "../../src/ws/broadcast.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";

const POLICY_AUDIENCE = {
  roles: ["client"],
  required_scopes: ["operator.admin"],
} as const;

describe("stable ws event builders", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("reuses the persisted event_id for approval.updated re-emission", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);
    const wsEventDal = new WsEventDal(db);

    const created = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: "stable-approval-event",
      prompt: "Approve stable event id?",
      motivation: "Human review is required before this approval may continue.",
      kind: "policy",
      status: "awaiting_human",
    });
    const resolved = await approvalDal.resolveWithEngineAction({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: created.approval_id,
      decision: "approved",
      resolvedBy: { kind: "test" },
    });
    if (!resolved) {
      throw new Error("expected approval resolution");
    }

    const approval = toApprovalContract(resolved.approval);
    if (!approval) {
      throw new Error("expected approval contract");
    }

    const first = await ensureApprovalResolvedEvent({
      tenantId: DEFAULT_TENANT_ID,
      approval,
      wsEventDal,
    });
    const second = await ensureApprovalResolvedEvent({
      tenantId: DEFAULT_TENANT_ID,
      approval,
      wsEventDal,
    });

    expect(second.event.event_id).toBe(first.event.event_id);
    expect(second.event.occurred_at).toBe(first.event.occurred_at);
  });

  it("reuses the persisted event_id for the same pairing transition and changes it for revoke", async () => {
    db = openTestSqliteDb();
    const nodePairingDal = new NodePairingDal(db);
    const wsEventDal = new WsEventDal(db);

    const pending = await nodePairingDal.upsertOnConnect({
      tenantId: DEFAULT_TENANT_ID,
      nodeId: "node-stable-event",
      pubkey: "pubkey-stable-event",
      label: "node-stable-event",
      capabilities: ["cli"],
      motivation: "Human review is required before pairing this node.",
      initialStatus: "awaiting_human",
      nowIso: "2026-03-06T12:00:00.000Z",
    });
    const approved = await nodePairingDal.resolve({
      tenantId: DEFAULT_TENANT_ID,
      pairingId: pending.pairing_id,
      decision: "approved",
      reason: "allow",
      resolvedBy: { kind: "test" },
      trustLevel: "remote",
      capabilityAllowlist: [],
    });
    if (!approved) {
      throw new Error("expected pairing approval");
    }

    const firstApproved = await ensurePairingResolvedEvent({
      tenantId: DEFAULT_TENANT_ID,
      pairing: approved.pairing,
      wsEventDal,
    });
    const secondApproved = await ensurePairingResolvedEvent({
      tenantId: DEFAULT_TENANT_ID,
      pairing: approved.pairing,
      wsEventDal,
    });

    expect(secondApproved.event.event_id).toBe(firstApproved.event.event_id);

    const revoked = await nodePairingDal.revoke({
      tenantId: DEFAULT_TENANT_ID,
      pairingId: pending.pairing_id,
      reason: "revoke",
      resolvedBy: { kind: "test" },
    });
    if (!revoked) {
      throw new Error("expected pairing revoke");
    }

    const revokedEvent = await ensurePairingResolvedEvent({
      tenantId: DEFAULT_TENANT_ID,
      pairing: revoked,
      wsEventDal,
    });

    expect(revokedEvent.event.event_id).not.toBe(firstApproved.event.event_id);
  });

  it("reuses the persisted event_id and audience for policy_override.created and preserves it in the outbox", async () => {
    db = openTestSqliteDb();
    const policyOverrideDal = new PolicyOverrideDal(db);
    const wsEventDal = new WsEventDal(db);
    const outboxDal = new OutboxDal(db);

    const override = await policyOverrideDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      toolId: "bash",
      pattern: "echo stable event",
      createdBy: { kind: "test" },
    });

    const first = await ensurePolicyOverrideCreatedEvent({
      tenantId: DEFAULT_TENANT_ID,
      override,
      audience: POLICY_AUDIENCE,
      wsEventDal,
    });
    const second = await ensurePolicyOverrideCreatedEvent({
      tenantId: DEFAULT_TENANT_ID,
      override,
      audience: { roles: ["node"] },
      wsEventDal,
    });

    expect(second.event.event_id).toBe(first.event.event_id);
    expect(second.audience).toEqual(POLICY_AUDIENCE);

    broadcastWsEvent(
      DEFAULT_TENANT_ID,
      first.event,
      {
        connectionManager: new ConnectionManager(),
        cluster: {
          edgeId: "edge-a",
          outboxDal,
        },
      },
      first.audience,
    );

    let outboxRows = await outboxDal.poll(DEFAULT_TENANT_ID, "edge-b");
    for (let attempt = 0; outboxRows.length === 0 && attempt < 5; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      outboxRows = await outboxDal.poll(DEFAULT_TENANT_ID, "edge-b");
    }

    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.payload).toEqual(
      expect.objectContaining({
        audience: POLICY_AUDIENCE,
        message: expect.objectContaining({
          event_id: first.event.event_id,
          type: "policy_override.created",
        }),
      }),
    );
  });
});
