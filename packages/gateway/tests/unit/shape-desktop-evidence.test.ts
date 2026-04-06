import { afterEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { DispatchRecordDal } from "../../src/modules/node/dispatch-record-dal.js";
import { resolveDesktopEvidenceSensitivity } from "../../src/modules/desktop/shape-desktop-evidence.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

const OTHER_TENANT_ID = "tenant-alt";
const SCREENSHOT_ACTION = {
  type: "Desktop",
  args: { op: "screenshot" },
} as const;

type ExecutionScopeIds = {
  jobId: string;
  turnId: string;
};

async function seedTenantScope(db: SqliteDb, tenantId: string): Promise<void> {
  await db.run("INSERT OR IGNORE INTO tenants (tenant_id, tenant_key) VALUES (?, ?)", [
    tenantId,
    `${tenantId}-key`,
  ]);
  await db.run("INSERT OR IGNORE INTO agents (tenant_id, agent_id, agent_key) VALUES (?, ?, ?)", [
    tenantId,
    DEFAULT_AGENT_ID,
    "default",
  ]);
  await db.run(
    "INSERT OR IGNORE INTO workspaces (tenant_id, workspace_id, workspace_key) VALUES (?, ?, ?)",
    [tenantId, DEFAULT_WORKSPACE_ID, "default"],
  );
  await db.run(
    "INSERT OR IGNORE INTO agent_workspaces (tenant_id, agent_id, workspace_id) VALUES (?, ?, ?)",
    [tenantId, DEFAULT_AGENT_ID, DEFAULT_WORKSPACE_ID],
  );
}

async function seedExecutionScope(
  db: SqliteDb,
  ids: ExecutionScopeIds,
  tenantId: string,
): Promise<void> {
  await seedTenantScope(db, tenantId);
  await db.run(
    `INSERT INTO turn_jobs (
       tenant_id,
       job_id,
       agent_id,
       workspace_id,
       conversation_key,
       status,
       trigger_json,
       input_json,
       latest_turn_id
     )
     VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
    [
      tenantId,
      ids.jobId,
      DEFAULT_AGENT_ID,
      DEFAULT_WORKSPACE_ID,
      "agent:default:test:default:channel:thread-1",
      "{}",
      "{}",
      ids.turnId,
    ],
  );

  await db.run(
    `INSERT INTO turns (tenant_id, turn_id, job_id, conversation_key, status, attempt)
     VALUES (?, ?, ?, ?, 'running', 1)`,
    [tenantId, ids.turnId, ids.jobId, "agent:default:test:default:channel:thread-1"],
  );
}

async function insertNodePairing(
  db: SqliteDb,
  input: {
    tenantId: string;
    nodeId: string;
    mode?: string;
  },
): Promise<void> {
  await seedTenantScope(db, input.tenantId);
  const metadata = input.mode ? { mode: input.mode } : {};
  await db.run(
    `INSERT INTO node_pairings (tenant_id, status, node_id, metadata_json, motivation)
     VALUES (?, 'approved', ?, ?, ?)`,
    [
      input.tenantId,
      input.nodeId,
      JSON.stringify(metadata),
      "Desktop sandbox evidence access was approved for this node.",
    ],
  );
}

describe("resolveDesktopEvidenceSensitivity", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
  });

  it("uses tenant-scoped dispatch records to resolve desktop evidence sensitivity", async () => {
    db = openTestSqliteDb();
    const tenantScope = {
      jobId: "job-desktop-evidence-default",
      turnId: "550e8400-e29b-41d4-a716-446655440100",
    };
    const otherScope = {
      jobId: "job-desktop-evidence-other",
      turnId: tenantScope.turnId,
    };
    await seedExecutionScope(db, tenantScope, DEFAULT_TENANT_ID);
    await seedExecutionScope(db, otherScope, OTHER_TENANT_ID);

    const dispatchDal = new DispatchRecordDal(db);
    await dispatchDal.create({
      tenantId: DEFAULT_TENANT_ID,
      dispatchId: "550e8400-e29b-41d4-a716-446655440105",
      capability: "tyrum.desktop.screenshot",
      action: SCREENSHOT_ACTION,
      taskId: "task-desktop-evidence-default",
      turnId: tenantScope.turnId,
      selectedNodeId: "node-desktop-sandbox",
      connectionId: "conn-default",
      createdAtIso: "2026-04-05T00:00:00.000Z",
    });
    await dispatchDal.create({
      tenantId: OTHER_TENANT_ID,
      dispatchId: "550e8400-e29b-41d4-a716-446655440106",
      capability: "tyrum.desktop.screenshot",
      action: SCREENSHOT_ACTION,
      taskId: "task-desktop-evidence-other",
      turnId: otherScope.turnId,
      selectedNodeId: "node-sensitive",
      connectionId: "conn-other",
      createdAtIso: "2026-04-05T00:00:01.000Z",
    });
    await insertNodePairing(db, {
      tenantId: DEFAULT_TENANT_ID,
      nodeId: "node-desktop-sandbox",
      mode: "desktop-sandbox",
    });
    await insertNodePairing(db, {
      tenantId: OTHER_TENANT_ID,
      nodeId: "node-sensitive",
    });

    const sensitivity = await resolveDesktopEvidenceSensitivity(db, {
      tenantId: DEFAULT_TENANT_ID,
      turnId: tenantScope.turnId,
    });

    expect(sensitivity).toBe("normal");
  });

  it("uses tenant-scoped node pairing metadata when node ids overlap", async () => {
    db = openTestSqliteDb();
    const scope = {
      jobId: "job-desktop-evidence-shared-node",
      turnId: "550e8400-e29b-41d4-a716-446655440110",
    };
    await seedExecutionScope(db, scope, DEFAULT_TENANT_ID);

    const dispatchId = "550e8400-e29b-41d4-a716-446655440113";
    await new DispatchRecordDal(db).create({
      tenantId: DEFAULT_TENANT_ID,
      dispatchId,
      capability: "tyrum.desktop.screenshot",
      action: SCREENSHOT_ACTION,
      taskId: "task-desktop-evidence-shared-node",
      turnId: scope.turnId,
      selectedNodeId: "shared-node",
      connectionId: "conn-shared",
    });
    await insertNodePairing(db, {
      tenantId: OTHER_TENANT_ID,
      nodeId: "shared-node",
    });
    await insertNodePairing(db, {
      tenantId: DEFAULT_TENANT_ID,
      nodeId: "shared-node",
      mode: "desktop-sandbox",
    });

    const sensitivity = await resolveDesktopEvidenceSensitivity(db, {
      tenantId: DEFAULT_TENANT_ID,
      turnId: scope.turnId,
      dispatchId,
    });

    expect(sensitivity).toBe("normal");
  });

  it("uses the exact dispatch id lookup when the dispatch record has no turn id", async () => {
    db = openTestSqliteDb();
    await insertNodePairing(db, {
      tenantId: DEFAULT_TENANT_ID,
      nodeId: "node-desktop-sandbox-null-turn",
      mode: "desktop-sandbox",
    });

    const dispatchId = "550e8400-e29b-41d4-a716-446655440114";
    await new DispatchRecordDal(db).create({
      tenantId: DEFAULT_TENANT_ID,
      dispatchId,
      capability: "tyrum.desktop.screenshot",
      action: SCREENSHOT_ACTION,
      taskId: "task-desktop-evidence-null-turn",
      selectedNodeId: "node-desktop-sandbox-null-turn",
      connectionId: "conn-null-turn",
    });

    const sensitivity = await resolveDesktopEvidenceSensitivity(db, {
      tenantId: DEFAULT_TENANT_ID,
      turnId: "550e8400-e29b-41d4-a716-446655440115",
      dispatchId,
    });

    expect(sensitivity).toBe("normal");
  });
});
