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
const TEST_STEP_ID = "6f9619ff-8b86-4d11-b42d-00c04fc964ff";
const TEST_ATTEMPT_ID = "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e";

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

async function seedExecutionAttempt(params: {
  db: ReturnType<typeof openTestSqliteDb>;
  tenantId: string;
  metadataJson?: string | null;
}) {
  const { db, tenantId, metadataJson = null } = params;
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
  await db.run(
    `INSERT INTO execution_steps (tenant_id, step_id, turn_id, step_index, status, action_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      TEST_STEP_ID,
      TEST_RUN_ID,
      0,
      "running",
      JSON.stringify({ type: "Desktop", args: { op: "screenshot" } }),
    ],
  );
  await db.run(
    `INSERT INTO execution_attempts (tenant_id, attempt_id, step_id, attempt, status, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tenantId, TEST_ATTEMPT_ID, TEST_STEP_ID, 1, "running", metadataJson],
  );
}

export function registerHandleMessageTenantBoundaryTests(): void {
  it("rejects attempt.evidence for attempts that belong to another tenant", async () => {
    const db = openTestSqliteDb();
    try {
      await seedTenantScope(db, OTHER_TENANT_ID);
      const cm = new ConnectionManager();
      const { id: nodeConnId } = makeClient(cm, ["desktop"], {
        role: "node",
        deviceId: "dev_test",
        protocolRev: 2,
      });
      const { ws: operatorWs } = makeClient(cm, ["desktop"], { protocolRev: 2 });
      const node = cm.getClient(nodeConnId)!;

      await seedExecutionAttempt({
        db,
        tenantId: OTHER_TENANT_ID,
        metadataJson: JSON.stringify({
          executor: { kind: "node", node_id: "dev_test", connection_id: nodeConnId },
        }),
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
            step_id: TEST_STEP_ID,
            attempt_id: TEST_ATTEMPT_ID,
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
  it("updates only the current tenant attempt when attempt ids overlap across tenants", async () => {
    const db = openTestSqliteDb();
    try {
      await seedTenantScope(db, OTHER_TENANT_ID);
      await seedExecutionAttempt({ db, tenantId: DEFAULT_TENANT_ID });
      await seedExecutionAttempt({ db, tenantId: OTHER_TENANT_ID });

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

      await dispatchTask(
        { type: "Desktop", args: { op: "screenshot" } },
        {
          tenantId: DEFAULT_TENANT_ID,
          turnId: TEST_RUN_ID,
          stepId: TEST_STEP_ID,
          attemptId: TEST_ATTEMPT_ID,
        },
        deps,
      );

      const currentTenantRow = await db.get<{ metadata_json: string | null }>(
        "SELECT metadata_json FROM execution_attempts WHERE tenant_id = ? AND attempt_id = ?",
        [DEFAULT_TENANT_ID, TEST_ATTEMPT_ID],
      );
      const otherTenantRow = await db.get<{ metadata_json: string | null }>(
        "SELECT metadata_json FROM execution_attempts WHERE tenant_id = ? AND attempt_id = ?",
        [OTHER_TENANT_ID, TEST_ATTEMPT_ID],
      );

      const currentTenantMeta = JSON.parse(currentTenantRow?.metadata_json ?? "{}") as {
        executor?: { node_id?: string };
      };
      expect(currentTenantMeta.executor?.node_id).toBe("dev_test");
      expect(otherTenantRow?.metadata_json).toBeNull();
    } finally {
      await db.close();
    }
  });
}
