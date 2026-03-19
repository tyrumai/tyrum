import { expect, it, vi } from "vitest";
import type { StepExecutor, StepResult } from "../../src/modules/execution/engine.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { RedactionEngine } from "../../src/modules/redaction/engine.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { action, enqueuePlan, drain } from "./execution-engine.test-support.js";

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
      lane: "main",
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
    const { runId } = await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-artifacts-1",
      requestId: "test-req-1",
      steps: [action("Research")],
    });
    const artifactRef = {
      artifact_id: "550e8400-e29b-41d4-a716-446655440000",
      uri: "artifact://550e8400-e29b-41d4-a716-446655440000",
      kind: "log",
      created_at: new Date().toISOString(),
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
    const attempt = await db.get<{ attempt_id: string; step_id: string }>(
      "SELECT attempt_id, step_id FROM execution_attempts LIMIT 1",
    );
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
      "SELECT agent_id, workspace_id FROM execution_jobs WHERE latest_run_id = ? LIMIT 1",
      [runId],
    );
    expect(job).toBeTruthy();
    expect(metadata?.workspace_id).toBe(job!.workspace_id);
    expect(metadata?.agent_id).toBe(job!.agent_id);
    expect(metadata?.kind).toBe(artifactRef.kind);
    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ parent_kind: "execution_run", parent_id: runId }),
        expect.objectContaining({ parent_kind: "execution_step", parent_id: attempt!.step_id }),
        expect.objectContaining({
          parent_kind: "execution_attempt",
          parent_id: attempt!.attempt_id,
        }),
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
    expect(types).toContain("artifact.attached");
  });

  it("only emits artifact.created when the artifact is first inserted", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-artifacts-created-1",
      requestId: "test-req-1",
      steps: [action("Research"), action("Research")],
    });
    const artifactRef = {
      artifact_id: "550e8400-e29b-41d4-a716-446655440000",
      uri: "artifact://550e8400-e29b-41d4-a716-446655440000",
      kind: "log",
      created_at: new Date().toISOString(),
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
    expect(types.filter((type) => type === "artifact.attached")).toHaveLength(2);
  });

  it("redacts registered secrets from persisted attempt results", async () => {
    const db = fixture.db();
    const redaction = new RedactionEngine();
    redaction.registerSecrets(["secret-XYZ"]);
    const engine = new ExecutionEngine({ db, redactionEngine: redaction });
    const { runId } = await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
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
      "SELECT result_json FROM execution_attempts WHERE step_id IN (SELECT step_id FROM execution_steps WHERE run_id = ?) LIMIT 1",
      [runId],
    );
    expect(row!.result_json).toContain("[REDACTED]");
    expect(row!.result_json).not.toContain("secret-XYZ");
  });

  it("persists per-attempt cost attribution when provided", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    const { runId } = await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
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
      "SELECT cost_json FROM execution_attempts WHERE step_id IN (SELECT step_id FROM execution_steps WHERE run_id = ?) LIMIT 1",
      [runId],
    );
    expect(row!.cost_json).toBeTruthy();
    const cost = JSON.parse(row!.cost_json!) as { total_tokens?: number; duration_ms?: number };
    expect(cost.total_tokens).toBe(30);
    expect(typeof cost.duration_ms).toBe("number");
  });
}
