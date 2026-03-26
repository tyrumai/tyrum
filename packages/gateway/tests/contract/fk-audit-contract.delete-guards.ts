import { deleteIds, ids } from "./fk-audit-contract.fixtures.js";

type SeedStatement = {
  sql: string;
  params: readonly unknown[];
};

type SqliteRunner = {
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
  };
};

type PostgresClient = {
  query(sql: string, params?: unknown[]): Promise<unknown>;
};

const deleteGuardSeedStatements: SeedStatement[] = [
  {
    sql: `INSERT INTO approvals (
            tenant_id,
            approval_id,
            approval_key,
            agent_id,
            workspace_id,
            kind,
            status,
            prompt,
            motivation
          ) VALUES (?, ?, ?, ?, ?, 'policy', 'queued', ?, ?)`,
    params: [
      ids.tenantId,
      deleteIds.approvalId,
      "approval:fk-audit:delete",
      ids.agentId,
      ids.workspaceId,
      "delete guard approval",
      "delete guard approval",
    ],
  },
  {
    sql: `INSERT INTO policy_overrides (
            tenant_id,
            policy_override_id,
            override_key,
            status,
            agent_id,
            workspace_id,
            tool_id,
            pattern,
            created_from_approval_id,
            created_by_json,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      ids.tenantId,
      deleteIds.policyOverrideId,
      "override:fk-audit:delete",
      ids.agentId,
      ids.workspaceId,
      "connector.send",
      "telegram:work:thread-1",
      deleteIds.approvalId,
      "{}",
      "2026-03-05T10:00:00.000Z",
      "2026-03-05T10:00:00.000Z",
    ],
  },
  {
    sql: `INSERT INTO channel_outbox (
            tenant_id,
            inbox_id,
            source,
            thread_id,
            dedupe_key,
            chunk_index,
            text,
            approval_id,
            workspace_id,
            session_id,
            channel_thread_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      ids.tenantId,
      1,
      "telegram:work",
      "thread-1",
      "fk-audit:delete-outbox",
      0,
      "hello",
      deleteIds.approvalId,
      ids.workspaceId,
      ids.sessionId,
      ids.channelThreadId,
    ],
  },
  {
    sql: `INSERT INTO turn_jobs (
            tenant_id,
            job_id,
            agent_id,
            workspace_id,
            conversation_key,
            lane,
            status,
            trigger_json,
            input_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      ids.tenantId,
      deleteIds.runJobId,
      ids.agentId,
      ids.workspaceId,
      "fk-audit:delete-run",
      "main",
      "queued",
      "{}",
      "{}",
    ],
  },
  {
    sql: `INSERT INTO turns (
            tenant_id,
            turn_id,
            job_id,
            conversation_key,
            lane,
            status,
            attempt
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params: [
      ids.tenantId,
      deleteIds.runId,
      deleteIds.runJobId,
      "fk-audit:delete-run",
      "main",
      "paused",
      1,
    ],
  },
  {
    sql: `INSERT INTO approvals (
            tenant_id,
            approval_id,
            approval_key,
            agent_id,
            workspace_id,
            kind,
            status,
            prompt,
            motivation,
            turn_id
          ) VALUES (?, ?, ?, ?, ?, 'policy', 'queued', ?, ?, ?)`,
    params: [
      ids.tenantId,
      deleteIds.runApprovalId,
      "approval:fk-audit:delete-run",
      ids.agentId,
      ids.workspaceId,
      "delete guard run",
      "delete guard run",
      deleteIds.runId,
    ],
  },
  {
    sql: `INSERT INTO turn_jobs (
            tenant_id,
            job_id,
            agent_id,
            workspace_id,
            conversation_key,
            lane,
            status,
            trigger_json,
            input_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      ids.tenantId,
      deleteIds.stepJobId,
      ids.agentId,
      ids.workspaceId,
      "fk-audit:delete-step",
      "main",
      "queued",
      "{}",
      "{}",
    ],
  },
  {
    sql: `INSERT INTO turns (
            tenant_id,
            turn_id,
            job_id,
            conversation_key,
            lane,
            status,
            attempt
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params: [
      ids.tenantId,
      deleteIds.stepRunId,
      deleteIds.stepJobId,
      "fk-audit:delete-step",
      "main",
      "paused",
      1,
    ],
  },
  {
    sql: `INSERT INTO execution_steps (
            tenant_id,
            step_id,
            turn_id,
            step_index,
            status,
            action_json
          ) VALUES (?, ?, ?, ?, ?, ?)`,
    params: [ids.tenantId, deleteIds.stepId, deleteIds.stepRunId, 0, "paused", "{}"],
  },
  {
    sql: `INSERT INTO approvals (
            tenant_id,
            approval_id,
            approval_key,
            agent_id,
            workspace_id,
            kind,
            status,
            prompt,
            motivation,
            step_id
          ) VALUES (?, ?, ?, ?, ?, 'policy', 'queued', ?, ?, ?)`,
    params: [
      ids.tenantId,
      deleteIds.stepApprovalId,
      "approval:fk-audit:delete-step",
      ids.agentId,
      ids.workspaceId,
      "delete guard step",
      "delete guard step",
      deleteIds.stepId,
    ],
  },
  {
    sql: `INSERT INTO turn_jobs (
            tenant_id,
            job_id,
            agent_id,
            workspace_id,
            conversation_key,
            lane,
            status,
            trigger_json,
            input_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      ids.tenantId,
      deleteIds.attemptJobId,
      ids.agentId,
      ids.workspaceId,
      "fk-audit:delete-attempt",
      "main",
      "queued",
      "{}",
      "{}",
    ],
  },
  {
    sql: `INSERT INTO turns (
            tenant_id,
            turn_id,
            job_id,
            conversation_key,
            lane,
            status,
            attempt
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params: [
      ids.tenantId,
      deleteIds.attemptRunId,
      deleteIds.attemptJobId,
      "fk-audit:delete-attempt",
      "main",
      "paused",
      1,
    ],
  },
  {
    sql: `INSERT INTO execution_steps (
            tenant_id,
            step_id,
            turn_id,
            step_index,
            status,
            action_json
          ) VALUES (?, ?, ?, ?, ?, ?)`,
    params: [ids.tenantId, deleteIds.attemptStepId, deleteIds.attemptRunId, 0, "paused", "{}"],
  },
  {
    sql: `INSERT INTO execution_attempts (
            tenant_id,
            attempt_id,
            step_id,
            attempt,
            status
          ) VALUES (?, ?, ?, ?, ?)`,
    params: [ids.tenantId, deleteIds.attemptId, deleteIds.attemptStepId, 1, "running"],
  },
  {
    sql: `INSERT INTO approvals (
            tenant_id,
            approval_id,
            approval_key,
            agent_id,
            workspace_id,
            kind,
            status,
            prompt,
            motivation,
            attempt_id
          ) VALUES (?, ?, ?, ?, ?, 'policy', 'queued', ?, ?, ?)`,
    params: [
      ids.tenantId,
      deleteIds.attemptApprovalId,
      "approval:fk-audit:delete-attempt",
      ids.agentId,
      ids.workspaceId,
      "delete guard attempt",
      "delete guard attempt",
      deleteIds.attemptId,
    ],
  },
];

export function seedSqliteDeleteGuardRows(db: SqliteRunner): void {
  for (const statement of deleteGuardSeedStatements) {
    db.prepare(statement.sql).run(...statement.params);
  }
}

function toPostgresSql(sql: string): string {
  let placeholder = 0;
  return sql.replace(/\?/g, () => `$${String(++placeholder)}`);
}

export async function seedPostgresDeleteGuardRows(client: PostgresClient): Promise<void> {
  for (const statement of deleteGuardSeedStatements) {
    await client.query(toPostgresSql(statement.sql), [...statement.params]);
  }
}
