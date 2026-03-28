import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { runPlaybookRuntimeEnvelope } from "../../src/modules/playbook/runtime.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { PlaybookRunner } from "../../src/modules/playbook/runner.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("playbook runtime resume timeout", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    vi.useRealTimers();

    await container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("does not double timeout budget when resuming", async () => {
    vi.useFakeTimers();

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-runtime-timeout-"));
    container = createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

    const engine = new ExecutionEngine({
      db: container.db,
      redactionEngine: container.redactionEngine,
      policyService: container.policyService,
      logger: container.logger,
    });
    const runner = new PlaybookRunner();

    const jobId = "job-resume-timeout-1";
    const turnId = "run-resume-timeout-1";

    await container.db.run(
      `INSERT INTO turn_jobs (
         tenant_id,
         job_id,
         agent_id,
         workspace_id,
         conversation_id,
         conversation_key,
         status,
         trigger_json,
         input_json,
         latest_turn_id
       )
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        jobId,
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        null,
        "key-1",
        "{}",
        "{}",
        turnId,
      ],
    );
    await container.db.run(
      `INSERT INTO turns (
         tenant_id,
         turn_id,
         job_id,
         conversation_key,
         status,
         attempt,
         blocked_reason,
         blocked_detail
       )
       VALUES (?, ?, ?, ?, 'paused', 1, 'test', 'paused')`,
      [DEFAULT_TENANT_ID, turnId, jobId, "key-1"],
    );

    const resumeToken = "resume-resolve-timeout-1";
    await container.approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: "approval-resume-timeout-1",
      prompt: "test",
      motivation: "Resume tokens should respect the original timeout budget.",
      kind: "policy",
      status: "awaiting_human",
      turnId,
      resumeToken,
    });

    const timeoutMs = 100;
    const start = Date.now();
    const envelopePromise = runPlaybookRuntimeEnvelope(
      {
        db: container.db,
        engine,
        policyService: container.policyService,
        approvalDal: container.approvalDal,
        playbooks: [],
        runner,
      },
      { action: "resume", token: resumeToken, approve: true, timeoutMs },
    ).then((envelope) => ({ envelope, resolvedAt: Date.now() }));

    await vi.advanceTimersByTimeAsync(90);
    await container.db.run(
      "UPDATE turns SET status = 'queued' WHERE tenant_id = ? AND turn_id = ?",
      [DEFAULT_TENANT_ID, turnId],
    );
    await vi.advanceTimersByTimeAsync(500);

    const { envelope, resolvedAt } = await envelopePromise;
    expect(envelope.ok).toBe(false);
    expect(envelope.status).toBe("error");
    expect(envelope.error?.code).toBe("timeout");
    expect(resolvedAt - start).toBeLessThanOrEqual(150);
  });
});
