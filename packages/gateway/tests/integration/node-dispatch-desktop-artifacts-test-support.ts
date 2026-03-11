import { expect, vi } from "vitest";
import type { McpManager } from "../../src/modules/agent/mcp-manager.js";

type SqlRunner = {
  run(sql: string, params?: unknown[]): Promise<unknown>;
};

export type ExecutionScopeIds = {
  jobId: string;
  runId: string;
  stepId: string;
  attemptId: string;
};

export async function seedExecutionScope(
  db: SqlRunner,
  ids: ExecutionScopeIds,
  scope: {
    tenantId: string;
    agentId: string;
    workspaceId: string;
    key: string;
    lane: string;
  },
): Promise<void> {
  await db.run(
    `INSERT INTO execution_jobs (
       tenant_id,
       job_id,
       agent_id,
       workspace_id,
       key,
       lane,
       status,
       trigger_json,
       input_json,
       latest_run_id
     )
     VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
    [
      scope.tenantId,
      ids.jobId,
      scope.agentId,
      scope.workspaceId,
      scope.key,
      scope.lane,
      "{}",
      "{}",
      ids.runId,
    ],
  );

  await db.run(
    `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt)
     VALUES (?, ?, ?, ?, ?, 'running', 1)`,
    [scope.tenantId, ids.runId, ids.jobId, scope.key, scope.lane],
  );

  await db.run(
    `INSERT INTO execution_steps (tenant_id, step_id, run_id, step_index, status, action_json)
     VALUES (?, ?, ?, 0, 'running', ?)`,
    [scope.tenantId, ids.stepId, ids.runId, "{}"],
  );

  await db.run(
    `INSERT INTO execution_attempts (tenant_id, attempt_id, step_id, attempt, status, artifacts_json)
     VALUES (?, ?, ?, 1, 'running', '[]')`,
    [scope.tenantId, ids.attemptId, ids.stepId],
  );
}

export function stubMcpManager(): McpManager {
  return {
    listTools: async () => ({ tools: [] }),
    callTool: async () => ({ content: [] }),
  } as unknown as McpManager;
}

function unwrapToolOutput(output: string): string {
  const trimmed = output.trim();
  const match = trimmed.match(/^<data source="tool">\s*([\s\S]*)\s*<\/data>$/);
  return (match?.[1] ?? trimmed).trim();
}

export function extractPayloadArtifactId(
  output: string,
  key: "artifact" | "tree_artifact",
): string {
  const parsed = JSON.parse(unwrapToolOutput(output)) as { payload?: unknown } | undefined;
  const payload = parsed?.payload as Record<string, unknown> | undefined;
  const artifact = payload?.[key] as { artifact_id?: unknown } | undefined;
  const artifactId = artifact?.artifact_id;
  expect(typeof artifactId).toBe("string");
  return artifactId as string;
}

export function createDesktopInspectionService(nodeId: string) {
  return {
    inspect: vi.fn(async ({ capabilityId }: { capabilityId: string }) => {
      const isScreenshot = capabilityId === "tyrum.desktop.screenshot";
      return {
        status: "ok",
        generated_at: new Date().toISOString(),
        node_id: nodeId,
        capability: capabilityId,
        capability_version: "1.0.0",
        connected: true,
        paired: true,
        dispatchable: true,
        source_of_truth: {
          schema: "gateway_catalog",
          state: "node_capability_state",
        },
        actions: [
          {
            name: isScreenshot ? "screenshot" : "snapshot",
            description: isScreenshot
              ? "Capture a desktop screenshot."
              : "Collect a desktop accessibility snapshot.",
            supported: true,
            enabled: true,
            availability_status: "unknown",
            input_schema: {},
            output_schema: {},
            consent: {
              requires_operator_enable: false,
              requires_runtime_consent: false,
              may_prompt_user: false,
              sensitive_data_category: "screen",
            },
            permissions: { browser_apis: [] },
            transport: {
              primitive_kind: "Desktop",
              op_field: "op",
              op_value: isScreenshot ? "screenshot" : "snapshot",
              result_channel: "result_or_evidence",
              artifactize_binary_fields: [],
            },
          },
        ],
      };
    }),
  };
}
