import Database from "better-sqlite3";
import type {
  LifecycleHookDefinition as LifecycleHookDefinitionT,
  PolicyBundle as PolicyBundleT,
} from "@tyrum/contracts";
import { join } from "node:path";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { migrate } from "../../src/migrate.js";
import type { ApprovalRunSeed } from "./startup-process.fixtures.js";

const SQLITE_MIGRATIONS_DIR = join(import.meta.dirname, "../../migrations/sqlite");

type ExecutionRunState = {
  pausedReason?: string | null;
  status?: string;
};

type HookRunRecord = {
  status: string;
  triggerJson: string;
};

type HookRunRecordWithPause = HookRunRecord & {
  pausedReason: string | null;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export function openTestDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  migrate(db, SQLITE_MIGRATIONS_DIR);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

export function seedLifecycleHooksConfig(
  db: Database.Database,
  hooks: readonly LifecycleHookDefinitionT[],
): void {
  db.prepare(
    `INSERT INTO lifecycle_hook_configs (
       tenant_id,
       hooks_json,
       created_at,
       created_by_json,
       reason
     ) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    DEFAULT_TENANT_ID,
    JSON.stringify(hooks),
    new Date().toISOString(),
    JSON.stringify({ kind: "test" }),
    "seed",
  );
}

export function seedDeploymentPolicyBundle(db: Database.Database, bundle: PolicyBundleT): void {
  db.prepare(
    `INSERT INTO policy_bundle_config_revisions (
       tenant_id,
       scope_kind,
       agent_id,
       bundle_json,
       created_at,
       created_by_json,
       reason
     ) VALUES (?, 'deployment', NULL, ?, ?, ?, ?)`,
  ).run(
    DEFAULT_TENANT_ID,
    JSON.stringify(bundle),
    new Date().toISOString(),
    JSON.stringify({ kind: "test" }),
    "seed",
  );
}

export function seedPausedApprovalRun(db: Database.Database, fixture: ApprovalRunSeed): void {
  const nowIso = new Date().toISOString();
  const triggerJson = JSON.stringify({
    kind: "conversation",
    conversation_key: fixture.key,
  });
  const actionJson = JSON.stringify({ type: "Decide", args: {} });
  const contextJson = JSON.stringify({ source: "agent-tool-execution" });

  db.prepare(
    `INSERT INTO turn_jobs (
       tenant_id,
       job_id,
       agent_id,
       workspace_id,
       conversation_key,
       status,
       trigger_json,
       created_at
     ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`,
  ).run(
    DEFAULT_TENANT_ID,
    fixture.jobId,
    DEFAULT_AGENT_ID,
    DEFAULT_WORKSPACE_ID,
    fixture.key,
    triggerJson,
    nowIso,
  );

  db.prepare(
    `INSERT INTO turns (
       tenant_id,
       turn_id,
       job_id,
       conversation_key,
       status,
       attempt,
       created_at,
       started_at,
       blocked_reason,
       blocked_detail
     ) VALUES (?, ?, ?, ?, 'paused', 1, ?, ?, 'approval', 'waiting on approval')`,
  ).run(DEFAULT_TENANT_ID, fixture.turnId, fixture.jobId, fixture.key, nowIso, nowIso);

  db.prepare(
    `INSERT INTO workflow_runs (
       workflow_run_id,
       tenant_id,
       agent_id,
       workspace_id,
       run_key,
       status,
       trigger_json,
       created_at,
       started_at,
       blocked_reason,
       blocked_detail
     ) VALUES (?, ?, ?, ?, ?, 'paused', ?, ?, ?, 'approval', 'waiting on approval')`,
  ).run(
    fixture.turnId,
    DEFAULT_TENANT_ID,
    DEFAULT_AGENT_ID,
    DEFAULT_WORKSPACE_ID,
    fixture.key,
    triggerJson,
    nowIso,
    nowIso,
  );

  if (fixture.resumeToken) {
    db.prepare(
      `INSERT INTO resume_tokens (tenant_id, token, turn_id, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(DEFAULT_TENANT_ID, fixture.resumeToken, fixture.turnId, nowIso);
  }

  db.prepare(
    `INSERT INTO workflow_run_steps (
       tenant_id,
       workflow_run_step_id,
       workflow_run_id,
       step_index,
       status,
       action_json,
       created_at
     ) VALUES (?, ?, ?, 0, 'paused', ?, ?)`,
  ).run(DEFAULT_TENANT_ID, fixture.stepId, fixture.turnId, actionJson, nowIso);

  db.prepare(
    `INSERT INTO approvals (
       tenant_id,
       approval_id,
       approval_key,
       agent_id,
       workspace_id,
       kind,
       status,
       prompt,
       motivation,
       context_json,
       created_at,
       expires_at,
       turn_id,
       workflow_run_step_id,
       resume_token
     ) VALUES (?, ?, ?, ?, ?, 'workflow_step', 'awaiting_human', ?, ?, ?, ?, NULL, ?, ?, ?)`,
  ).run(
    DEFAULT_TENANT_ID,
    fixture.approvalId,
    fixture.approvalKey,
    DEFAULT_AGENT_ID,
    DEFAULT_WORKSPACE_ID,
    "test approval",
    "test approval",
    contextJson,
    nowIso,
    fixture.turnId,
    fixture.stepId,
    fixture.resumeToken ?? null,
  );
}

function readExecutionRunState(
  db: Database.Database,
  turnId: string,
): ExecutionRunState | undefined {
  const workflowRun = db
    .prepare(
      `SELECT status, blocked_reason AS pausedReason
       FROM workflow_runs
       WHERE tenant_id = ? AND workflow_run_id = ?`,
    )
    .get(DEFAULT_TENANT_ID, turnId) as ExecutionRunState | undefined;
  if (workflowRun) {
    return workflowRun;
  }

  return db
    .prepare(
      `SELECT status, blocked_reason AS pausedReason
       FROM turns
       WHERE tenant_id = ? AND turn_id = ?`,
    )
    .get(DEFAULT_TENANT_ID, turnId) as ExecutionRunState | undefined;
}

export async function waitForExecutionRunToLeavePaused(
  db: Database.Database,
  turnId: string,
  timeoutMs = 5_000,
): Promise<ExecutionRunState> {
  const deadline = Date.now() + timeoutMs;
  let row: ExecutionRunState | undefined;

  while (Date.now() < deadline) {
    row = readExecutionRunState(db, turnId);
    if (row?.status && row.status !== "paused") return row;
    await delay(25);
  }

  return row ?? {};
}

export async function waitForExecutionRunStatus(
  db: Database.Database,
  turnId: string,
  expectedStatus: string,
  timeoutMs = 5_000,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  let status: string | undefined;

  while (Date.now() < deadline) {
    const row = readExecutionRunState(db, turnId);
    status = row?.status;
    if (status === expectedStatus) return status;
    await delay(25);
  }

  return status;
}

export async function waitForExecutionRunKeyStatus(
  db: Database.Database,
  key: string,
  expectedStatus: string,
  output: () => string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const row = db
        .prepare(
          `SELECT status
           FROM workflow_runs
           WHERE conversation_key = ?
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(key) as { status?: string } | undefined;
      if (row?.status === expectedStatus) return;
    } catch {
      // DB may be briefly busy while the gateway is migrating / writing.
    }
    await delay(50);
  }

  throw new Error(`execution run for '${key}' did not reach '${expectedStatus}'.\n${output()}`);
}

export function readLatestHookRun(db: Database.Database, key: string): HookRunRecord | undefined {
  return db
    .prepare(
      `SELECT status, trigger_json AS triggerJson
       FROM workflow_runs
       WHERE conversation_key = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(key) as HookRunRecord | undefined;
}

export function readLatestHookRunWithPause(
  db: Database.Database,
  key: string,
): HookRunRecordWithPause | undefined {
  return db
    .prepare(
      `SELECT
         status,
         blocked_reason AS pausedReason,
         trigger_json AS triggerJson
       FROM workflow_runs
       WHERE conversation_key = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(key) as HookRunRecordWithPause | undefined;
}
