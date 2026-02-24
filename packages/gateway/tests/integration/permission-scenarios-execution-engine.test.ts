import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createApp } from "../../src/app.js";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { ExecutionEngine, type StepExecutor } from "../../src/modules/execution/engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("ExecutionEngine policy approval scenarios (e2e)", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  const restoreEnv = (key: string, value: string | undefined) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  };

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

  it("pauses a run for policy approval and resumes when approved", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-perms-engine-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

    const engine = new ExecutionEngine({
      db: container.db,
      redactionEngine: container.redactionEngine,
      policyService: container.policyService,
      logger: container.logger,
    });
    const app = createApp(container, { engine });

    const res = await app.request("/workflow/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: "key-1",
        lane: "lane-1",
        steps: [{ type: "CLI", args: { cmd: "echo", args: ["hi"] } }],
      }),
    });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { run_id: string };
    expect(payload.run_id).toBeTruthy();

    const executor: StepExecutor = {
      execute: vi.fn(async () => {
        throw new Error("step execution should not run before policy approval");
      }),
    };

    await engine.workerTick({ workerId: "w1", executor, runId: payload.run_id });

    const run = await container.db.get<{ status: string; paused_reason: string | null }>(
      "SELECT status, paused_reason FROM execution_runs WHERE run_id = ?",
      [payload.run_id],
    );
    expect(run?.status).toBe("paused");
    expect(run?.paused_reason).toBe("policy");

    const step = await container.db.get<{ status: string; approval_id: number | null }>(
      "SELECT status, approval_id FROM execution_steps WHERE run_id = ? LIMIT 1",
      [payload.run_id],
    );
    expect(step?.status).toBe("paused");
    expect(step?.approval_id).toBeTruthy();

    const approvalId = step?.approval_id ?? 0;
    const approval = await container.db.get<{ kind: string; status: string; resume_token: string | null }>(
      "SELECT kind, status, resume_token FROM approvals WHERE id = ?",
      [approvalId],
    );
    expect(approval?.kind).toBe("policy");
    expect(approval?.status).toBe("pending");
    expect(approval?.resume_token).toBeTruthy();

    const approveRes = await app.request(`/approvals/${String(approvalId)}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });
    expect(approveRes.status).toBe(200);

    const resumed = await container.db.get<{ status: string; paused_reason: string | null }>(
      "SELECT status, paused_reason FROM execution_runs WHERE run_id = ?",
      [payload.run_id],
    );
    expect(resumed?.status).toBe("queued");
    expect(resumed?.paused_reason).toBeNull();

    const stepQueued = await container.db.get<{ status: string }>(
      "SELECT status FROM execution_steps WHERE run_id = ? LIMIT 1",
      [payload.run_id],
    );
    expect(stepQueued?.status).toBe("queued");

    const tokenRow = await container.db.get<{ revoked_at: string | null }>(
      "SELECT revoked_at FROM resume_tokens WHERE token = ?",
      [approval?.resume_token],
    );
    expect(tokenRow?.revoked_at).toBeTruthy();
  });

  it("pauses a run for policy approval and cancels when denied", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-perms-engine-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

    const engine = new ExecutionEngine({
      db: container.db,
      redactionEngine: container.redactionEngine,
      policyService: container.policyService,
      logger: container.logger,
    });
    const app = createApp(container, { engine });

    const res = await app.request("/workflow/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: "key-1",
        lane: "lane-1",
        steps: [{ type: "CLI", args: { cmd: "echo", args: ["hi"] } }],
      }),
    });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { run_id: string };
    expect(payload.run_id).toBeTruthy();

    const executor: StepExecutor = {
      execute: vi.fn(async () => {
        throw new Error("step execution should not run before policy approval");
      }),
    };

    await engine.workerTick({ workerId: "w1", executor, runId: payload.run_id });

    const step = await container.db.get<{ approval_id: number | null }>(
      "SELECT approval_id FROM execution_steps WHERE run_id = ? LIMIT 1",
      [payload.run_id],
    );
    const approvalId = step?.approval_id ?? 0;
    expect(approvalId).toBeTruthy();

    const approval = await container.db.get<{ resume_token: string | null }>(
      "SELECT resume_token FROM approvals WHERE id = ?",
      [approvalId],
    );
    expect(approval?.resume_token).toBeTruthy();

    const denyRes = await app.request(`/approvals/${String(approvalId)}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "denied", reason: "no" }),
    });
    expect(denyRes.status).toBe(200);

    const cancelled = await container.db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [payload.run_id],
    );
    expect(cancelled?.status).toBe("cancelled");

    const tokenRow = await container.db.get<{ revoked_at: string | null }>(
      "SELECT revoked_at FROM resume_tokens WHERE token = ?",
      [approval?.resume_token],
    );
    expect(tokenRow?.revoked_at).toBeTruthy();
  });
});
