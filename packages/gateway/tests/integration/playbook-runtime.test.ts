import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createApp } from "../../src/app.js";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { ExecutionEngine, type StepExecutor } from "../../src/modules/execution/engine.js";
import { loadAllPlaybooks } from "../../src/modules/playbook/loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");
const fixturesDir = join(__dirname, "../fixtures/playbooks");

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRunId(container: GatewayContainer, timeoutMs = 1_000): Promise<string> {
  const deadline = Date.now() + Math.max(1, timeoutMs);
  while (Date.now() < deadline) {
    const row = await container.db.get<{ run_id: string }>(
      "SELECT run_id FROM execution_runs ORDER BY created_at DESC LIMIT 1",
    );
    if (row?.run_id) return row.run_id;
    await sleep(5);
  }
  throw new Error("timed out waiting for execution run to be created");
}

async function waitForRunStatus(
  container: GatewayContainer,
  runId: string,
  statuses: readonly string[],
  timeoutMs = 1_000,
): Promise<string> {
  const desired = new Set(statuses);
  const deadline = Date.now() + Math.max(1, timeoutMs);
  while (Date.now() < deadline) {
    const row = await container.db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    if (row?.status && desired.has(row.status)) return row.status;
    await sleep(5);
  }
  throw new Error(`timed out waiting for run status: ${statuses.join(", ")}`);
}

const INLINE_PLAYBOOK = `
id: inline-runtime-test
name: Inline runtime test
version: "1.0.0"
steps:
  - id: step-1
    command: cli echo hi
`.trim();

const IMPLICIT_SHELL_PLAYBOOK = `
id: implicit-shell-runtime-test
name: Implicit shell runtime test
version: "1.0.0"
steps:
  - id: step-1
    command: echo hi
`.trim();

const HTTP_MISSING_URL_PLAYBOOK = `
id: http-missing-url-runtime-test
name: HTTP missing URL runtime test
version: "1.0.0"
steps:
  - id: step-1
    command: http GET
`.trim();

describe("POST /playbooks/runtime (playbook runtime envelope)", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  const originalEnv = {
    TYRUM_POLICY_ENABLED: process.env["TYRUM_POLICY_ENABLED"],
    TYRUM_POLICY_MODE: process.env["TYRUM_POLICY_MODE"],
    TYRUM_POLICY_BUNDLE_PATH: process.env["TYRUM_POLICY_BUNDLE_PATH"],
    TYRUM_HOME: process.env["TYRUM_HOME"],
  };

  beforeEach(() => {
    process.env["TYRUM_POLICY_ENABLED"] = "1";
    process.env["TYRUM_POLICY_MODE"] = "enforce";
    delete process.env["TYRUM_POLICY_BUNDLE_PATH"];
    delete process.env["TYRUM_HOME"];
  });

  afterEach(async () => {
    restoreEnv("TYRUM_POLICY_ENABLED", originalEnv.TYRUM_POLICY_ENABLED);
    restoreEnv("TYRUM_POLICY_MODE", originalEnv.TYRUM_POLICY_MODE);
    restoreEnv("TYRUM_POLICY_BUNDLE_PATH", originalEnv.TYRUM_POLICY_BUNDLE_PATH);
    restoreEnv("TYRUM_HOME", originalEnv.TYRUM_HOME);

    await container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("returns status=error envelope for invalid pipelines (no run created)", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    const engine = new ExecutionEngine({
      db: container.db,
      redactionEngine: container.redactionEngine,
      policyService: container.policyService,
      logger: container.logger,
    });
    const playbooks = loadAllPlaybooks(fixturesDir, { onInvalidPlaybook: () => {} });
    const app = createApp(container, { engine, playbooks });

    const res = await app.request("/playbooks/runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "run", pipeline: "not: a playbook", timeoutMs: 50 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; status: string; error?: { code?: string } };
    expect(body.ok).toBe(false);
    expect(body.status).toBe("error");
    expect(body.error?.code).toBe("invalid_request");

    const runCount = await container.db.get<{ count: number }>("SELECT COUNT(*) as count FROM execution_runs");
    expect(runCount?.count ?? 0).toBe(0);
  });

  it("returns status=error envelope when argsJson is invalid (no run created)", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    const engine = new ExecutionEngine({
      db: container.db,
      redactionEngine: container.redactionEngine,
      policyService: container.policyService,
      logger: container.logger,
    });
    const playbooks = loadAllPlaybooks(fixturesDir, { onInvalidPlaybook: () => {} });
    const app = createApp(container, { engine, playbooks });

    const res = await app.request("/playbooks/runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "run", pipeline: INLINE_PLAYBOOK, argsJson: "{not json", timeoutMs: 50 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; status: string; error?: { code?: string } };
    expect(body.ok).toBe(false);
    expect(body.status).toBe("error");
    expect(body.error?.code).toBe("invalid_request");

    const runCount = await container.db.get<{ count: number }>("SELECT COUNT(*) as count FROM execution_runs");
    expect(runCount?.count ?? 0).toBe(0);
  });

  it("returns status=error envelope for implicit shell commands (no run created)", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    const engine = new ExecutionEngine({
      db: container.db,
      redactionEngine: container.redactionEngine,
      policyService: container.policyService,
      logger: container.logger,
    });
    const playbooks = loadAllPlaybooks(fixturesDir, { onInvalidPlaybook: () => {} });
    const app = createApp(container, { engine, playbooks });

    const res = await app.request("/playbooks/runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "run", pipeline: IMPLICIT_SHELL_PLAYBOOK, timeoutMs: 50 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; status: string; error?: { code?: string } };
    expect(body.ok).toBe(false);
    expect(body.status).toBe("error");
    expect(body.error?.code).toBe("invalid_request");

    const runCount = await container.db.get<{ count: number }>("SELECT COUNT(*) as count FROM execution_runs");
    expect(runCount?.count ?? 0).toBe(0);
  });

  it("returns status=error envelope for invalid http commands (no run created)", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    const engine = new ExecutionEngine({
      db: container.db,
      redactionEngine: container.redactionEngine,
      policyService: container.policyService,
      logger: container.logger,
    });
    const playbooks = loadAllPlaybooks(fixturesDir, { onInvalidPlaybook: () => {} });
    const app = createApp(container, { engine, playbooks });

    const res = await app.request("/playbooks/runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "run", pipeline: HTTP_MISSING_URL_PLAYBOOK, timeoutMs: 50 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; status: string; error?: { code?: string } };
    expect(body.ok).toBe(false);
    expect(body.status).toBe("error");
    expect(body.error?.code).toBe("invalid_request");

    const runCount = await container.db.get<{ count: number }>("SELECT COUNT(*) as count FROM execution_runs");
    expect(runCount?.count ?? 0).toBe(0);
  });

  it("returns status=needs_approval with resumeToken when paused for policy approval", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    const engine = new ExecutionEngine({
      db: container.db,
      redactionEngine: container.redactionEngine,
      policyService: container.policyService,
      logger: container.logger,
    });
    const playbooks = loadAllPlaybooks(fixturesDir, { onInvalidPlaybook: () => {} });
    const app = createApp(container, { engine, playbooks });

    const resPromise = app.request("/playbooks/runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "run",
        pipeline: INLINE_PLAYBOOK,
        argsJson: "{\"k\":\"v\"}",
        cwd: "subdir",
        maxOutputBytes: 1234,
        timeoutMs: 2_000,
      }),
    });

    const runId = await waitForRunId(container);
    const step = await container.db.get<{ action_json: string }>(
      "SELECT action_json FROM execution_steps WHERE run_id = ? AND step_index = 0",
      [runId],
    );
    const action = step?.action_json ? (JSON.parse(step.action_json) as { args?: { cwd?: unknown; max_output_bytes?: unknown } }) : undefined;
    expect(action?.args?.cwd).toBe("subdir");
    expect(action?.args?.max_output_bytes).toBe(1234);

    const executor: StepExecutor = {
      execute: vi.fn(async () => {
        throw new Error("step execution should not run before policy approval");
      }),
    };

    await engine.workerTick({ workerId: "w1", executor, runId });

    const res = await resPromise;
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      status: string;
      requiresApproval?: { resumeToken?: string };
    };

    expect(body.ok).toBe(true);
    expect(body.status).toBe("needs_approval");
    expect(body.requiresApproval?.resumeToken).toBeTruthy();
  });

  it("resume approve=false returns status=cancelled", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    const engine = new ExecutionEngine({
      db: container.db,
      redactionEngine: container.redactionEngine,
      policyService: container.policyService,
      logger: container.logger,
    });
    const playbooks = loadAllPlaybooks(fixturesDir, { onInvalidPlaybook: () => {} });
    const app = createApp(container, { engine, playbooks });

    const runResPromise = app.request("/playbooks/runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "run", pipeline: INLINE_PLAYBOOK, timeoutMs: 2_000 }),
    });

    const runId = await waitForRunId(container);
    const pauseExecutor: StepExecutor = {
      execute: vi.fn(async () => {
        throw new Error("step execution should not run before policy approval");
      }),
    };
    await engine.workerTick({ workerId: "w1", executor: pauseExecutor, runId });

    const runRes = await runResPromise;
    const paused = (await runRes.json()) as { requiresApproval?: { resumeToken?: string } };
    const resumeToken = paused.requiresApproval?.resumeToken ?? "";
    expect(resumeToken).toBeTruthy();

    const resumeRes = await app.request("/playbooks/runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "resume", token: resumeToken, approve: false, timeoutMs: 2_000 }),
    });

    expect(resumeRes.status).toBe(200);
    const body = (await resumeRes.json()) as { ok: boolean; status: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("cancelled");

    const runRow = await container.db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(runRow?.status).toBe("cancelled");
  });

  it("resume does not cancel when the approval was resolved concurrently (TOCTOU)", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    const engine = new ExecutionEngine({
      db: container.db,
      redactionEngine: container.redactionEngine,
      policyService: container.policyService,
      logger: container.logger,
    });
    const playbooks = loadAllPlaybooks(fixturesDir, { onInvalidPlaybook: () => {} });
    const app = createApp(container, { engine, playbooks });

    const runResPromise = app.request("/playbooks/runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "run", pipeline: INLINE_PLAYBOOK, timeoutMs: 2_000 }),
    });

    const runId = await waitForRunId(container);
    const pauseExecutor: StepExecutor = {
      execute: vi.fn(async () => {
        throw new Error("step execution should not run before policy approval");
      }),
    };
    await engine.workerTick({ workerId: "w1", executor: pauseExecutor, runId });

    const runRes = await runResPromise;
    const paused = (await runRes.json()) as { requiresApproval?: { resumeToken?: string } };
    const resumeToken = paused.requiresApproval?.resumeToken ?? "";
    expect(resumeToken).toBeTruthy();

    const originalRespond = container.approvalDal.respond.bind(container.approvalDal);
    const respondSpy = vi
      .spyOn(container.approvalDal, "respond")
      .mockImplementation(async (id, approved, reason) => {
        const nowIso = new Date().toISOString();
        await container.db.run(
          "UPDATE approvals SET status = 'approved', responded_at = ?, response_reason = ? WHERE id = ?",
          [nowIso, "approved concurrently", id],
        );
        return await originalRespond(id, approved, reason);
      });

    const resumeRes = await app.request("/playbooks/runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "resume", token: resumeToken, approve: false, timeoutMs: 2_000 }),
    });

    respondSpy.mockRestore();

    expect(resumeRes.status).toBe(200);
    const body = (await resumeRes.json()) as { ok: boolean; status: string; error?: { code?: string } };
    expect(body.ok).toBe(false);
    expect(body.status).toBe("error");
    expect(body.error?.code).toBe("conflict");

    const runRow = await container.db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(runRow?.status).toBe("paused");
  });

  it("resume approve=true returns status=ok when the run completes", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    const engine = new ExecutionEngine({
      db: container.db,
      redactionEngine: container.redactionEngine,
      policyService: container.policyService,
      logger: container.logger,
    });
    const playbooks = loadAllPlaybooks(fixturesDir, { onInvalidPlaybook: () => {} });
    const app = createApp(container, { engine, playbooks });

    const runResPromise = app.request("/playbooks/runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "run", pipeline: INLINE_PLAYBOOK, timeoutMs: 2_000 }),
    });

    const runId = await waitForRunId(container);
    const pauseExecutor: StepExecutor = {
      execute: vi.fn(async () => {
        throw new Error("step execution should not run before policy approval");
      }),
    };
    await engine.workerTick({ workerId: "w1", executor: pauseExecutor, runId });

    const runRes = await runResPromise;
    const paused = (await runRes.json()) as { requiresApproval?: { resumeToken?: string } };
    const resumeToken = paused.requiresApproval?.resumeToken ?? "";
    expect(resumeToken).toBeTruthy();

    const resumePromise = app.request("/playbooks/runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "resume", token: resumeToken, approve: true, timeoutMs: 2_000 }),
    });

    await waitForRunStatus(container, runId, ["queued", "running"]);

    const executor: StepExecutor = {
      execute: vi.fn(async () => ({ success: true, result: { ok: true } })),
    };

    for (let i = 0; i < 10; i += 1) {
      await engine.workerTick({ workerId: "w1", executor, runId });
      const row = await container.db.get<{ status: string }>(
        "SELECT status FROM execution_runs WHERE run_id = ?",
        [runId],
      );
      if (row?.status === "succeeded") break;
    }

    const resumeRes = await resumePromise;
    expect(resumeRes.status).toBe(200);
    const body = (await resumeRes.json()) as { ok: boolean; status: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("ok");
  });

  it("resume approve=true returns status=error when the run fails", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-runtime-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    const engine = new ExecutionEngine({
      db: container.db,
      redactionEngine: container.redactionEngine,
      policyService: container.policyService,
      logger: container.logger,
    });
    const playbooks = loadAllPlaybooks(fixturesDir, { onInvalidPlaybook: () => {} });
    const app = createApp(container, { engine, playbooks });

    const runResPromise = app.request("/playbooks/runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "run", pipeline: INLINE_PLAYBOOK, timeoutMs: 2_000 }),
    });

    const runId = await waitForRunId(container);
    const pauseExecutor: StepExecutor = {
      execute: vi.fn(async () => {
        throw new Error("step execution should not run before policy approval");
      }),
    };
    await engine.workerTick({ workerId: "w1", executor: pauseExecutor, runId });

    const runRes = await runResPromise;
    const paused = (await runRes.json()) as { requiresApproval?: { resumeToken?: string } };
    const resumeToken = paused.requiresApproval?.resumeToken ?? "";
    expect(resumeToken).toBeTruthy();

    const stepRow = await container.db.get<{ step_id: string }>(
      "SELECT step_id FROM execution_steps WHERE run_id = ? LIMIT 1",
      [runId],
    );
    await container.db.run(
      "UPDATE execution_steps SET max_attempts = 1 WHERE step_id = ?",
      [stepRow?.step_id],
    );

    const resumePromise = app.request("/playbooks/runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "resume", token: resumeToken, approve: true, timeoutMs: 2_000 }),
    });

    await waitForRunStatus(container, runId, ["queued", "running"]);

    // Regression: ensure stale paused metadata doesn't shadow the actual execution error.
    await container.db.run(
      "UPDATE execution_runs SET paused_reason = ?, paused_detail = ? WHERE run_id = ?",
      ["stale paused reason", "stale paused detail", runId],
    );

    const executor: StepExecutor = {
      execute: vi.fn(async () => ({ success: false, error: "boom" })),
    };

    for (let i = 0; i < 10; i += 1) {
      await engine.workerTick({ workerId: "w1", executor, runId });
      const row = await container.db.get<{ status: string }>(
        "SELECT status FROM execution_runs WHERE run_id = ?",
        [runId],
      );
      if (row?.status === "failed") break;
    }

    const resumeRes = await resumePromise;
    expect(resumeRes.status).toBe(200);
    const body = (await resumeRes.json()) as { ok: boolean; status: string; error?: { message?: string } };
    expect(body.ok).toBe(false);
    expect(body.status).toBe("error");
    expect(body.error?.message).toContain("boom");
    expect(body.error?.message).not.toContain("stale paused detail");
  });
});
