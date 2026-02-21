import { afterEach, describe, expect, it } from "vitest";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { ApprovalResolver } from "../../src/modules/approval/resolver.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { EventBus } from "../../src/event-bus.js";
import { createEventBus } from "../../src/event-bus.js";

describe("ApprovalResolver", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  /** Seed a minimal execution run in the "paused" state with a resume token. */
  async function seedPausedRun(
    database: SqliteDb,
    opts: { runId: string; resumeToken: string },
  ): Promise<void> {
    const jobId = `job-${opts.runId}`;
    await database.run(
      `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json, workspace_id)
       VALUES (?, 'k', 'main', 'running', '{}', 'default')`,
      [jobId],
    );
    await database.run(
      `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt, paused_reason, paused_detail)
       VALUES (?, ?, 'k', 'main', 'paused', 1, 'approval', '{}')`,
      [opts.runId, jobId],
    );
    await database.run(
      `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json)
       VALUES (?, ?, 0, 'paused', '{}')`,
      [`step-${opts.runId}`, opts.runId],
    );
    await database.run(
      `INSERT INTO resume_tokens (token, run_id, created_at)
       VALUES (?, ?, datetime('now'))`,
      [opts.resumeToken, opts.runId],
    );
  }

  function createResolver(database: SqliteDb): {
    resolver: ApprovalResolver;
    eventBus: EventBus;
    dal: ApprovalDal;
  } {
    const dal = new ApprovalDal(database);
    const eventBus = createEventBus();
    const resolver = new ApprovalResolver({ approvalDal: dal, db: database, eventBus });
    return { resolver, eventBus, dal };
  }

  it("resumes a paused run when approval:resolved fires with approved=true", async () => {
    db = openTestSqliteDb();
    const { resolver, eventBus, dal } = createResolver(db);

    // Seed a paused run
    const runId = "run-resume-1";
    const resumeToken = "resume-tok-1";
    await seedPausedRun(db, { runId, resumeToken });

    // Create an approval linked to this run
    const approval = await dal.create({
      planId: runId,
      stepIndex: 0,
      prompt: "Approve action?",
    });
    await db.run(
      "UPDATE approvals SET run_id = ?, step_id = ?, resume_token = ? WHERE id = ?",
      [runId, `step-${runId}`, resumeToken, approval.id],
    );

    // Mark approval as approved in the DAL (as the route handler would)
    await dal.respond(approval.id, true, "looks good");

    // Start resolver and fire event
    resolver.start();
    eventBus.emit("approval:resolved" as keyof import("../../src/event-bus.js").GatewayEvents, {
      approvalId: approval.id,
      approved: true,
      reason: "looks good",
    } as never);

    // Give async handler time to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify: run is now queued
    const run = await db.get<{ status: string; paused_reason: string | null }>(
      "SELECT status, paused_reason FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run!.status).toBe("queued");
    expect(run!.paused_reason).toBeNull();

    // Verify: step is now queued
    const step = await db.get<{ status: string }>(
      "SELECT status FROM execution_steps WHERE run_id = ? AND status = 'queued'",
      [runId],
    );
    expect(step).toBeDefined();
    expect(step!.status).toBe("queued");

    // Verify: resume token is revoked
    const token = await db.get<{ revoked_at: string | null }>(
      "SELECT revoked_at FROM resume_tokens WHERE token = ?",
      [resumeToken],
    );
    expect(token!.revoked_at).not.toBeNull();
  });

  it("fails a paused run when approval:resolved fires with approved=false", async () => {
    db = openTestSqliteDb();
    const { resolver, eventBus, dal } = createResolver(db);

    const runId = "run-deny-1";
    const resumeToken = "resume-tok-deny-1";
    await seedPausedRun(db, { runId, resumeToken });

    // Create and link approval
    const approval = await dal.create({
      planId: runId,
      stepIndex: 0,
      prompt: "Approve action?",
    });
    await db.run(
      "UPDATE approvals SET run_id = ?, step_id = ?, resume_token = ? WHERE id = ?",
      [runId, `step-${runId}`, resumeToken, approval.id],
    );
    await dal.respond(approval.id, false, "too risky");

    // Fire event
    resolver.start();
    eventBus.emit("approval:resolved" as keyof import("../../src/event-bus.js").GatewayEvents, {
      approvalId: approval.id,
      approved: false,
      reason: "too risky",
    } as never);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify: run is now failed
    const run = await db.get<{ status: string; finished_at: string | null }>(
      "SELECT status, finished_at FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run!.status).toBe("failed");
    expect(run!.finished_at).not.toBeNull();

    // Verify: paused steps are failed
    const step = await db.get<{ status: string }>(
      "SELECT status FROM execution_steps WHERE run_id = ?",
      [runId],
    );
    expect(step!.status).toBe("failed");

    // Verify: resume token is revoked
    const token = await db.get<{ revoked_at: string | null }>(
      "SELECT revoked_at FROM resume_tokens WHERE token = ?",
      [resumeToken],
    );
    expect(token!.revoked_at).not.toBeNull();
  });

  it("createExecutionApproval creates an approval and pauses the run", async () => {
    db = openTestSqliteDb();
    const { resolver } = createResolver(db);

    // Seed a running execution run
    const runId = "run-create-1";
    const jobId = "job-create-1";
    await db.run(
      `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json, workspace_id)
       VALUES (?, 'k', 'main', 'running', '{}', 'default')`,
      [jobId],
    );
    await db.run(
      `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt)
       VALUES (?, ?, 'k', 'main', 'running', 1)`,
      [runId, jobId],
    );
    await db.run(
      `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json)
       VALUES (?, ?, 0, 'running', '{}')`,
      ["step-create-1", runId],
    );

    // Also create a resume token (as the engine would when pausing)
    const resumeToken = "resume-tok-create-1";
    await db.run(
      `INSERT INTO resume_tokens (token, run_id, created_at) VALUES (?, ?, datetime('now'))`,
      [resumeToken, runId],
    );

    await resolver.createExecutionApproval({
      runId,
      stepId: "step-create-1",
      attemptId: "attempt-1",
      prompt: "Allow this step?",
      context: { action: "scrape" },
      resumeToken,
    });

    // Verify: approval was created and linked
    const approval = await db.get<{
      run_id: string | null;
      step_id: string | null;
      attempt_id: string | null;
      resume_token: string | null;
      prompt: string;
    }>(
      "SELECT run_id, step_id, attempt_id, resume_token, prompt FROM approvals WHERE run_id = ?",
      [runId],
    );
    expect(approval).toBeDefined();
    expect(approval!.run_id).toBe(runId);
    expect(approval!.step_id).toBe("step-create-1");
    expect(approval!.attempt_id).toBe("attempt-1");
    expect(approval!.resume_token).toBe(resumeToken);
    expect(approval!.prompt).toBe("Allow this step?");

    // Verify: run is now paused with approval reason
    const run = await db.get<{ status: string; paused_reason: string | null; paused_detail: string | null }>(
      "SELECT status, paused_reason, paused_detail FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run!.status).toBe("paused");
    expect(run!.paused_reason).toBe("approval");
    const detail = JSON.parse(run!.paused_detail!) as { approval_id: number };
    expect(detail.approval_id).toBeGreaterThan(0);
  });

  it("does nothing when approval has no linked run_id", async () => {
    db = openTestSqliteDb();
    const { resolver, eventBus, dal } = createResolver(db);

    // Create an approval without execution context (no run_id)
    const approval = await dal.create({
      planId: "plan-no-run",
      stepIndex: 0,
      prompt: "Approve?",
    });
    await dal.respond(approval.id, true);

    resolver.start();
    eventBus.emit("approval:resolved" as keyof import("../../src/event-bus.js").GatewayEvents, {
      approvalId: approval.id,
      approved: true,
    } as never);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // No execution_runs exist, so nothing should crash
    const runs = await db.all<{ run_id: string }>("SELECT run_id FROM execution_runs");
    expect(runs).toHaveLength(0);
  });

  it("does nothing when approval id does not exist", async () => {
    db = openTestSqliteDb();
    const { resolver, eventBus } = createResolver(db);

    resolver.start();
    eventBus.emit("approval:resolved" as keyof import("../../src/event-bus.js").GatewayEvents, {
      approvalId: 999999,
      approved: true,
    } as never);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // No crash expected; no state changes
    const runs = await db.all<{ run_id: string }>("SELECT run_id FROM execution_runs");
    expect(runs).toHaveLength(0);
  });
});
