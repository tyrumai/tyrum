export type SqliteCase = {
  name: string;
  sql: string;
  params: readonly unknown[];
};

export type PostgresCase = {
  name: string;
  sql: string;
  params: readonly unknown[];
};

export const ids = {
  tenantId: "10000000-0000-4000-8000-000000000001",
  agentId: "10000000-0000-4000-8000-000000000002",
  workspaceId: "10000000-0000-4000-8000-000000000003",
  channelAccountId: "10000000-0000-4000-8000-000000000004",
  channelThreadId: "10000000-0000-4000-8000-000000000005",
  conversationId: "10000000-0000-4000-8000-000000000006",
} as const;

export const legacyIds = {
  approvalId: "10000000-0000-4000-8000-000000000120",
  runId: "10000000-0000-4000-8000-000000000121",
  stepId: "10000000-0000-4000-8000-000000000122",
  attemptId: "10000000-0000-4000-8000-000000000123",
  missingApprovalId: "10000000-0000-4000-8000-000000000124",
  policyOverrideId: "10000000-0000-4000-8000-000000000125",
} as const;

export const deleteIds = {
  approvalId: "10000000-0000-4000-8000-000000000130",
  policyOverrideId: "10000000-0000-4000-8000-000000000131",
  runJobId: "10000000-0000-4000-8000-000000000132",
  runId: "10000000-0000-4000-8000-000000000133",
  runApprovalId: "10000000-0000-4000-8000-000000000134",
  stepJobId: "10000000-0000-4000-8000-000000000135",
  stepRunId: "10000000-0000-4000-8000-000000000136",
  stepId: "10000000-0000-4000-8000-000000000137",
  stepApprovalId: "10000000-0000-4000-8000-000000000138",
  attemptJobId: "10000000-0000-4000-8000-000000000139",
  attemptRunId: "10000000-0000-4000-8000-000000000140",
  attemptStepId: "10000000-0000-4000-8000-000000000141",
  attemptId: "10000000-0000-4000-8000-000000000142",
  attemptApprovalId: "10000000-0000-4000-8000-000000000143",
} as const;

export const sqliteCases: SqliteCase[] = [
  {
    name: "channel_outbox.approval_id",
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
            conversation_id,
            channel_thread_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      ids.tenantId,
      1,
      "telegram:work",
      "thread-1",
      "fk-audit:outbox",
      0,
      "hello",
      "00000000-0000-4000-8000-000000000111",
      ids.workspaceId,
      ids.conversationId,
      ids.channelThreadId,
    ],
  },
  {
    name: "policy_overrides.created_from_approval_id",
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
      "00000000-0000-4000-8000-000000000112",
      "override:fk-audit",
      ids.agentId,
      ids.workspaceId,
      "connector.send",
      "telegram:work:thread-1",
      "00000000-0000-4000-8000-000000000113",
      "{}",
      "2026-03-05T10:00:00.000Z",
      "2026-03-05T10:00:00.000Z",
    ],
  },
  {
    name: "approvals.turn_id",
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
      "00000000-0000-4000-8000-000000000114",
      "approval:fk-audit:run",
      ids.agentId,
      ids.workspaceId,
      "invalid run",
      "invalid run",
      "00000000-0000-4000-8000-000000000115",
    ],
  },
  {
    name: "approvals.step_id",
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
      "00000000-0000-4000-8000-000000000116",
      "approval:fk-audit:step",
      ids.agentId,
      ids.workspaceId,
      "invalid step",
      "invalid step",
      "00000000-0000-4000-8000-000000000117",
    ],
  },
  {
    name: "approvals.attempt_id",
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
      "00000000-0000-4000-8000-000000000118",
      "approval:fk-audit:attempt",
      ids.agentId,
      ids.workspaceId,
      "invalid attempt",
      "invalid attempt",
      "00000000-0000-4000-8000-000000000119",
    ],
  },
];

export const postgresCases: PostgresCase[] = [
  {
    name: "channel_outbox.approval_id",
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
            conversation_id,
            channel_thread_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    params: [
      ids.tenantId,
      1,
      "telegram:work",
      "thread-1",
      "fk-audit:outbox",
      0,
      "hello",
      "00000000-0000-4000-8000-000000000111",
      ids.workspaceId,
      ids.conversationId,
      ids.channelThreadId,
    ],
  },
  {
    name: "policy_overrides.created_from_approval_id",
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
          ) VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10, $11)`,
    params: [
      ids.tenantId,
      "00000000-0000-4000-8000-000000000112",
      "override:fk-audit",
      ids.agentId,
      ids.workspaceId,
      "connector.send",
      "telegram:work:thread-1",
      "00000000-0000-4000-8000-000000000113",
      "{}",
      "2026-03-05T10:00:00.000Z",
      "2026-03-05T10:00:00.000Z",
    ],
  },
  {
    name: "approvals.turn_id",
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
          ) VALUES ($1, $2, $3, $4, $5, 'policy', 'queued', $6, $7, $8)`,
    params: [
      ids.tenantId,
      "00000000-0000-4000-8000-000000000114",
      "approval:fk-audit:run",
      ids.agentId,
      ids.workspaceId,
      "invalid run",
      "invalid run",
      "00000000-0000-4000-8000-000000000115",
    ],
  },
  {
    name: "approvals.step_id",
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
          ) VALUES ($1, $2, $3, $4, $5, 'policy', 'queued', $6, $7, $8)`,
    params: [
      ids.tenantId,
      "00000000-0000-4000-8000-000000000116",
      "approval:fk-audit:step",
      ids.agentId,
      ids.workspaceId,
      "invalid step",
      "invalid step",
      "00000000-0000-4000-8000-000000000117",
    ],
  },
  {
    name: "approvals.attempt_id",
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
          ) VALUES ($1, $2, $3, $4, $5, 'policy', 'queued', $6, $7, $8)`,
    params: [
      ids.tenantId,
      "00000000-0000-4000-8000-000000000118",
      "approval:fk-audit:attempt",
      ids.agentId,
      ids.workspaceId,
      "invalid attempt",
      "invalid attempt",
      "00000000-0000-4000-8000-000000000119",
    ],
  },
];
