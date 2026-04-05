import { expect, it } from "vitest";
import { CAPABILITY_DESCRIPTOR_DEFAULT_VERSION } from "@tyrum/contracts";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { dispatchTask, handleClientMessage } from "../../src/ws/protocol.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { createMockWs, makeDeps, makeClient } from "./ws-protocol.test-support.js";

const OTHER_TENANT_ID = "11111111-1111-4111-8111-111111111111";
const TEST_RUN_ID = "550e8400-e29b-41d4-a716-446655440000";
const TEST_DISPATCH_ID = "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e";

async function seedTenantScope(db: ReturnType<typeof openTestSqliteDb>, tenantId: string) {
  await db.run("INSERT INTO tenants (tenant_id, tenant_key) VALUES (?, ?)", [
    tenantId,
    `${tenantId}-key`,
  ]);
  await db.run("INSERT INTO agents (tenant_id, agent_id, agent_key) VALUES (?, ?, ?)", [
    tenantId,
    DEFAULT_AGENT_ID,
    "default",
  ]);
  await db.run("INSERT INTO workspaces (tenant_id, workspace_id, workspace_key) VALUES (?, ?, ?)", [
    tenantId,
    DEFAULT_WORKSPACE_ID,
    "default",
  ]);
  await db.run(
    "INSERT INTO agent_workspaces (tenant_id, agent_id, workspace_id) VALUES (?, ?, ?)",
    [tenantId, DEFAULT_AGENT_ID, DEFAULT_WORKSPACE_ID],
  );
}

async function seedTurnScope(db: ReturnType<typeof openTestSqliteDb>, tenantId: string) {
  await db.run(
    `INSERT INTO turn_jobs (
       tenant_id,
       job_id,
       agent_id,
       workspace_id,
       conversation_key,
       status,
       trigger_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      "job-1",
      DEFAULT_AGENT_ID,
      DEFAULT_WORKSPACE_ID,
      "agent:default:main",
      "running",
      "{}",
    ],
  );
  await db.run(
    `INSERT INTO turns (tenant_id, turn_id, job_id, conversation_key, status, attempt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tenantId, TEST_RUN_ID, "job-1", "agent:default:main", "running", 1],
  );
}

async function seedDispatchRecord(params: {
  db: ReturnType<typeof openTestSqliteDb>;
  tenantId: string;
  selectedNodeId: string;
  connectionId: string;
}) {
  const { db, tenantId, selectedNodeId, connectionId } = params;
  await db.run(
    `INSERT INTO dispatch_records (
       tenant_id,
       dispatch_id,
       turn_id,
       selected_node_id,
       capability,
       action_json,
       task_id,
       status,
       connection_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      TEST_DISPATCH_ID,
      TEST_RUN_ID,
      selectedNodeId,
      "tyrum.desktop.screenshot",
      JSON.stringify({ type: "Desktop", args: { op: "screenshot" } }),
      "task-1",
      "dispatched",
      connectionId,
    ],
  );
}

export function registerHandleMessageTenantBoundaryTests(): void {
  it("rejects attempt.evidence for dispatches that belong to another tenant", async () => {
    const db = openTestSqliteDb();
    try {
      await seedTenantScope(db, OTHER_TENANT_ID);
      await seedTurnScope(db, OTHER_TENANT_ID);

      const cm = new ConnectionManager();
      const { id: nodeConnId } = makeClient(cm, ["desktop"], {
        role: "node",
        deviceId: "dev_test",
        protocolRev: 2,
      });
      const { ws: operatorWs } = makeClient(cm, ["desktop"], { protocolRev: 2 });
      const node = cm.getClient(nodeConnId)!;

      await seedDispatchRecord({
        db,
        tenantId: OTHER_TENANT_ID,
        selectedNodeId: "dev_test",
        connectionId: nodeConnId,
      });

      const deps = makeDeps(cm, {
        db,
        nodePairingDal: {
          getByNodeId: async () => ({ status: "approved" }) as never,
        } as never,
      });

      const result = await handleClientMessage(
        node,
        JSON.stringify({
          request_id: "r-attempt-evidence-cross-tenant-1",
          type: "attempt.evidence",
          payload: {
            turn_id: TEST_RUN_ID,
            dispatch_id: TEST_DISPATCH_ID,
            evidence: { http: { status: 200 } },
          },
        }),
        deps,
      );

      expect(result).toBeDefined();
      expect((result as { ok: boolean }).ok).toBe(false);
      expect((result as { type: string }).type).toBe("attempt.evidence");
      expect((result as { error: { code: string } }).error.code).toBe("invalid_request");
      expect(operatorWs.send).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });
}

export function registerDispatchTenantBoundaryTests(): void {
  it("creates dispatch records only for the current tenant when turn ids overlap", async () => {
    const db = openTestSqliteDb();
    try {
      await seedTenantScope(db, OTHER_TENANT_ID);
      await seedTurnScope(db, DEFAULT_TENANT_ID);
      await seedTurnScope(db, OTHER_TENANT_ID);

      const cm = new ConnectionManager();
      const nodeWs = createMockWs();
      cm.addClient(
        nodeWs as never,
        [
          {
            id: "tyrum.desktop.screenshot",
            version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
          },
        ] as never,
        {
          id: "node-1",
          role: "node",
          deviceId: "dev_test",
          protocolRev: 2,
          authClaims: {
            token_kind: "device",
            token_id: "token-node-1",
            tenant_id: DEFAULT_TENANT_ID,
            role: "node",
            device_id: "dev_test",
            scopes: [],
          },
        },
      );

      const deps = makeDeps(cm, {
        db,
        nodePairingDal: {
          getByNodeId: async () =>
            ({
              status: "approved",
              capability_allowlist: [
                {
                  id: "tyrum.desktop.screenshot",
                  version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
                },
              ],
            }) as never,
        } as never,
      });

      const dispatched = await dispatchTask(
        { type: "Desktop", args: { op: "screenshot" } },
        {
          tenantId: DEFAULT_TENANT_ID,
          turnId: TEST_RUN_ID,
        },
        deps,
      );

      const currentTenantRow = await db.get<{
        selected_node_id: string | null;
        connection_id: string | null;
      }>(
        `SELECT selected_node_id, connection_id
         FROM dispatch_records
         WHERE tenant_id = ? AND dispatch_id = ?`,
        [DEFAULT_TENANT_ID, dispatched.dispatchId],
      );
      const otherTenantRow = await db.get<{ dispatch_id: string }>(
        `SELECT dispatch_id
         FROM dispatch_records
         WHERE tenant_id = ? AND dispatch_id = ?`,
        [OTHER_TENANT_ID, dispatched.dispatchId],
      );

      expect(currentTenantRow).toEqual({
        selected_node_id: "dev_test",
        connection_id: "node-1",
      });
      expect(otherTenantRow).toBeUndefined();
    } finally {
      await db.close();
    }
  });
}
