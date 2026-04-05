import { expect, it, vi } from "vitest";
import type { StepExecutor, StepResult } from "../../src/modules/execution/engine.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { RedactionEngine } from "../../src/modules/redaction/engine.js";
import { createQueuedWorkflowRunFromActions } from "../../src/modules/workflow-run/create-queued-run.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  action,
  DEFAULT_TENANT_ID,
  DEFAULT_AGENT_ID,
  DEFAULT_WORKSPACE_ID,
  drain,
  enqueuePlan,
} from "./execution-engine.test-support.js";

export function registerPersistenceTests(fixture: { db: () => SqliteDb }): void {
  it("records attempt finished_at after started_at", async () => {
    const db = fixture.db();
    let calls = 0;
    const baseMs = Date.UTC(2025, 0, 1, 0, 0, 0);
    const engine = new ExecutionEngine({
      db,
      clock: () => {
        calls += 1;
        const nowMs = baseMs + calls * 1000;
        return { nowMs, nowIso: new Date(nowMs).toISOString() };
      },
    });
    await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      planId: "plan-finished-at-1",
      requestId: "test-req-1",
      steps: [action("Research")],
    });
    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
    };
    await drain(engine, "w1", mockExecutor);
    const row = await db.get<{ started_at: string; finished_at: string | null }>(
      "SELECT started_at, finished_at FROM execution_attempts LIMIT 1",
    );
    expect(row!.finished_at).not.toBeNull();
    expect(row!.finished_at).not.toBe(row!.started_at);
    expect(new Date(row!.finished_at!).getTime()).toBeGreaterThan(
      new Date(row!.started_at).getTime(),
    );
  });

  it("persists artifact refs returned by the step executor on attempts", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    const { turnId } = await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      planId: "plan-artifacts-1",
      requestId: "test-req-1",
      steps: [action("Research")],
    });
    const artifactRef = {
      artifact_id: "550e8400-e29b-41d4-a716-446655440000",
      uri: "artifact://550e8400-e29b-41d4-a716-446655440000",
      external_url: "https://gateway.example.test/a/550e8400-e29b-41d4-a716-446655440000",
      kind: "log",
      media_class: "document",
      created_at: new Date().toISOString(),
      filename: "artifact-log.txt",
      mime_type: "text/plain",
      labels: [],
    } as const;
    const mockExecutor: StepExecutor = {
      execute: vi.fn(
        async (): Promise<StepResult> => ({
          success: true,
          result: { ok: true },
          artifacts: [artifactRef],
        }),
      ),
    };
    await drain(engine, "w1", mockExecutor);
    const attemptRow = await db.get<{ artifacts_json: string }>(
      "SELECT artifacts_json FROM execution_attempts LIMIT 1",
    );
    const artifacts = JSON.parse(attemptRow!.artifacts_json) as Array<{
      uri: string;
      kind: string;
    }>;
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.uri).toBe(artifactRef.uri);
    expect(artifacts[0]!.kind).toBe(artifactRef.kind);
    const metadata = await db.get<{
      tenant_id: string;
      workspace_id: string;
      agent_id: string | null;
      kind: string;
    }>("SELECT tenant_id, workspace_id, agent_id, kind FROM artifacts WHERE artifact_id = ?", [
      artifactRef.artifact_id,
    ]);
    expect(metadata).toBeTruthy();
    const links = await db.all<{ parent_kind: string; parent_id: string }>(
      `SELECT parent_kind, parent_id
       FROM artifact_links
       WHERE tenant_id = ?
         AND artifact_id = ?
       ORDER BY parent_kind, parent_id`,
      [metadata!.tenant_id, artifactRef.artifact_id],
    );
    const job = await db.get<{ agent_id: string; workspace_id: string }>(
      "SELECT agent_id, workspace_id FROM turn_jobs WHERE latest_turn_id = ? LIMIT 1",
      [turnId],
    );
    expect(job).toBeTruthy();
    expect(metadata?.workspace_id).toBe(job!.workspace_id);
    expect(metadata?.agent_id).toBe(job!.agent_id);
    expect(metadata?.kind).toBe(artifactRef.kind);
    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ parent_kind: "execution_run", parent_id: turnId }),
      ]),
    );
    const outbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    const types = outbox
      .map((outboxRow) => JSON.parse(outboxRow.payload_json) as { message?: { type?: string } })
      .map((payload) => payload.message?.type)
      .filter((value): value is string => typeof value === "string");
    expect(types).toContain("artifact.created");
    expect(types).not.toContain("artifact.attached");
  });

  it("only emits artifact.created when the artifact is first inserted", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      planId: "plan-artifacts-created-1",
      requestId: "test-req-1",
      steps: [action("Research"), action("Research")],
    });
    const artifactRef = {
      artifact_id: "550e8400-e29b-41d4-a716-446655440000",
      uri: "artifact://550e8400-e29b-41d4-a716-446655440000",
      external_url: "https://gateway.example.test/a/550e8400-e29b-41d4-a716-446655440000",
      kind: "log",
      media_class: "document",
      created_at: new Date().toISOString(),
      filename: "artifact-log.txt",
      mime_type: "text/plain",
      labels: [],
    } as const;
    const mockExecutor: StepExecutor = {
      execute: vi.fn(
        async (): Promise<StepResult> => ({
          success: true,
          result: { ok: true },
          artifacts: [artifactRef],
        }),
      ),
    };
    await drain(engine, "w1", mockExecutor);
    const outbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    const types = outbox
      .map((row) => JSON.parse(row.payload_json) as { message?: { type?: string } })
      .map((row) => row.message?.type)
      .filter((value): value is string => typeof value === "string");
    expect(types.filter((type) => type === "artifact.created")).toHaveLength(1);
    expect(types.filter((type) => type === "artifact.attached")).toHaveLength(0);
  });

  it("redacts registered secrets from persisted attempt results", async () => {
    const db = fixture.db();
    const redaction = new RedactionEngine();
    redaction.registerSecrets(["secret-XYZ"]);
    const engine = new ExecutionEngine({ db, redactionEngine: redaction });
    const { turnId } = await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      planId: "plan-redact-1",
      requestId: "test-req-1",
      steps: [action("Research")],
    });
    const mockExecutor: StepExecutor = {
      execute: vi.fn(
        async (): Promise<StepResult> => ({ success: true, result: { token: "secret-XYZ" } }),
      ),
    };
    await drain(engine, "w1", mockExecutor);
    const row = await db.get<{ result_json: string }>(
      "SELECT result_json FROM execution_attempts WHERE step_id IN (SELECT step_id FROM execution_steps WHERE turn_id = ?) LIMIT 1",
      [turnId],
    );
    expect(row!.result_json).toContain("[REDACTED]");
    expect(row!.result_json).not.toContain("secret-XYZ");
  });

  it("persists per-attempt cost attribution when provided", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    const { turnId } = await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      planId: "plan-cost-1",
      requestId: "test-req-1",
      steps: [action("Research")],
    });
    const mockExecutor: StepExecutor = {
      execute: vi.fn(
        async (): Promise<StepResult> => ({
          success: true,
          result: { ok: true },
          cost: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
        }),
      ),
    };
    await drain(engine, "w1", mockExecutor);
    const row = await db.get<{ cost_json: string | null }>(
      "SELECT cost_json FROM execution_attempts WHERE step_id IN (SELECT step_id FROM execution_steps WHERE turn_id = ?) LIMIT 1",
      [turnId],
    );
    expect(row!.cost_json).toBeTruthy();
    const cost = JSON.parse(row!.cost_json!) as { total_tokens?: number; duration_ms?: number };
    expect(cost.total_tokens).toBe(30);
    expect(typeof cost.duration_ms).toBe("number");
  });

  it("syncs terminal failed attempt cost onto workflow run steps", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    const workflowRunId = await createQueuedWorkflowRunFromActions({
      db,
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      runKey: "agent:agent-1:telegram-1:group:thread-1",
      conversationKey: "agent:agent-1:telegram-1:group:thread-1",
      trigger: {
        kind: "api",
        metadata: { conversation_key: "agent:agent-1:telegram-1:group:thread-1" },
      },
      planId: "plan-failed-cost-sync-1",
      requestId: "test-req-1",
      actions: [action("CLI")],
    });

    const policyFailureExecutor: StepExecutor = {
      execute: vi.fn(
        async (): Promise<StepResult> => ({
          success: false,
          error: "policy denied bash",
          failureKind: "policy",
          cost: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
        }),
      ),
    };

    await drain(engine, "w1", policyFailureExecutor);

    const attemptRow = await db.get<{ status: string; cost_json: string | null }>(
      `SELECT status, cost_json
       FROM execution_attempts
       WHERE step_id IN (SELECT step_id FROM execution_steps WHERE turn_id = ?)
       LIMIT 1`,
      [workflowRunId],
    );
    expect(attemptRow?.status).toBe("failed");
    expect(attemptRow?.cost_json).toBeTruthy();

    const workflowStepRow = await db.get<{ cost_json: string | null }>(
      `SELECT cost_json
       FROM workflow_run_steps
       WHERE tenant_id = ?
         AND workflow_run_id = ?
       LIMIT 1`,
      [DEFAULT_TENANT_ID, workflowRunId],
    );
    expect(workflowStepRow?.cost_json).toBeTruthy();
    const cost = JSON.parse(workflowStepRow!.cost_json!) as {
      total_tokens?: number;
      duration_ms?: number;
    };
    expect(cost.total_tokens).toBe(30);
    expect(typeof cost.duration_ms).toBe("number");
  });
}
