import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { ActionPrimitive, PolicyBundle, type SecretHandle } from "@tyrum/schemas";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { createLocalStepExecutor } from "../../src/modules/execution/local-step-executor.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("executor policy regressions", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await container?.db.close();
    container = undefined;
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  async function createHarness() {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-executor-policy-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    const engine = new ExecutionEngine({
      db: container.db,
      redactionEngine: container.redactionEngine,
      logger: container.logger,
    });
    return { container, engine, homeDir };
  }

  async function loadRunState(runId: string) {
    const run = await container!.db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE tenant_id = ? AND run_id = ?",
      [DEFAULT_TENANT_ID, runId],
    );
    const step = await container!.db.get<{ status: string }>(
      "SELECT status FROM execution_steps WHERE tenant_id = ? AND run_id = ? LIMIT 1",
      [DEFAULT_TENANT_ID, runId],
    );
    const attempt = await container!.db.get<{
      error: string | null;
      policy_snapshot_id: string | null;
    }>(
      `SELECT error, policy_snapshot_id
       FROM execution_attempts
       WHERE tenant_id = ? AND step_id = (
         SELECT step_id FROM execution_steps WHERE tenant_id = ? AND run_id = ? LIMIT 1
       )
       ORDER BY attempt DESC
       LIMIT 1`,
      [DEFAULT_TENANT_ID, DEFAULT_TENANT_ID, runId],
    );
    return { run, step, attempt };
  }

  it("fails workflow execution closed when executor context is missing a policy snapshot id", async () => {
    const { engine, homeDir: harnessHome } = await createHarness();
    const executor = createLocalStepExecutor({
      tyrumHome: harnessHome,
      policyService: container!.policyService,
    });

    const action = ActionPrimitive.parse({
      type: "CLI",
      args: {
        cmd: process.execPath,
        args: ["-e", "process.stdout.write('ok')"],
      },
    });

    const enqueued = await engine.enqueuePlan({
      tenantId: DEFAULT_TENANT_ID,
      key: "agent:test",
      lane: "main",
      planId: "plan-missing-policy",
      requestId: "req-missing-policy",
      steps: [action],
    });

    await engine.workerTick({ workerId: "w1", executor, runId: enqueued.runId });

    const state = await loadRunState(enqueued.runId);
    expect(state.run?.status).toBe("failed");
    expect(state.step?.status).toBe("failed");
    expect(state.attempt?.error).toContain("policy snapshot");
    expect(state.attempt?.policy_snapshot_id).toBeNull();
  });

  it("fails workflow execution before fetch when executor-side policy denies egress", async () => {
    const { engine, homeDir: harnessHome } = await createHarness();
    const snapshot = await container!.policyService.getOrCreateSnapshot(
      DEFAULT_TENANT_ID,
      PolicyBundle.parse({
        v: 1,
        tools: { default: "deny", allow: ["webfetch"], require_approval: [], deny: [] },
        network_egress: { default: "deny", allow: [], require_approval: [], deny: [] },
        secrets: { default: "allow", allow: [], require_approval: [], deny: [] },
      }),
    );
    const executor = createLocalStepExecutor({
      tyrumHome: harnessHome,
      policyService: container!.policyService,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
      ),
    );

    const action = ActionPrimitive.parse({
      type: "Http",
      args: {
        url: "https://93.184.216.34/data",
        method: "GET",
      },
    });

    const enqueued = await engine.enqueuePlan({
      tenantId: DEFAULT_TENANT_ID,
      key: "agent:test",
      lane: "main",
      planId: "plan-egress-deny",
      requestId: "req-egress-deny",
      steps: [action],
      policySnapshotId: snapshot.policy_snapshot_id,
    });

    await engine.workerTick({ workerId: "w1", executor, runId: enqueued.runId });

    const state = await loadRunState(enqueued.runId);
    expect(state.run?.status).toBe("failed");
    expect(state.step?.status).toBe("failed");
    expect(state.attempt?.error).toContain("policy denied");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails workflow execution before secret resolution when executor-side policy denies secrets", async () => {
    const { engine, homeDir: harnessHome } = await createHarness();
    const handle: SecretHandle = {
      handle_id: "handle-abc",
      provider: "db",
      scope: "billing",
      created_at: new Date().toISOString(),
    };
    const secretProvider: SecretProvider = {
      resolve: vi.fn(async () => "SECRET_VALUE"),
      store: vi.fn(async () => handle),
      revoke: vi.fn(async () => true),
      list: vi.fn(async () => [handle]),
    };
    const snapshot = await container!.policyService.getOrCreateSnapshot(
      DEFAULT_TENANT_ID,
      PolicyBundle.parse({
        v: 1,
        tools: { default: "deny", allow: ["webfetch"], require_approval: [], deny: [] },
        network_egress: {
          default: "deny",
          allow: ["https://93.184.216.34/*"],
          require_approval: [],
          deny: [],
        },
        secrets: { default: "deny", allow: [], require_approval: [], deny: [] },
      }),
    );
    const executor = createLocalStepExecutor({
      tyrumHome: harnessHome,
      secretProvider,
      policyService: container!.policyService,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
      ),
    );

    const action = ActionPrimitive.parse({
      type: "Http",
      args: {
        url: "https://93.184.216.34/data",
        method: "GET",
        headers: { Authorization: "secret:handle-abc" },
      },
    });

    const enqueued = await engine.enqueuePlan({
      tenantId: DEFAULT_TENANT_ID,
      key: "agent:test",
      lane: "main",
      planId: "plan-secret-deny",
      requestId: "req-secret-deny",
      steps: [action],
      policySnapshotId: snapshot.policy_snapshot_id,
    });

    await engine.workerTick({ workerId: "w1", executor, runId: enqueued.runId });

    const state = await loadRunState(enqueued.runId);
    expect(state.run?.status).toBe("failed");
    expect(state.step?.status).toBe("failed");
    expect(state.attempt?.error).toContain("policy denied secret resolution");
    expect(secretProvider.list).toHaveBeenCalled();
    expect(secretProvider.resolve).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not re-pause executor-side policy gates after the same policy approval is approved", async () => {
    const { engine, homeDir: harnessHome } = await createHarness();
    const snapshot = await container!.policyService.getOrCreateSnapshot(
      DEFAULT_TENANT_ID,
      PolicyBundle.parse({
        v: 1,
        tools: { default: "require_approval", allow: [], require_approval: [], deny: [] },
        network_egress: { default: "allow", allow: [], require_approval: [], deny: [] },
        secrets: { default: "allow", allow: [], require_approval: [], deny: [] },
      }),
    );
    const executor = createLocalStepExecutor({
      tyrumHome: harnessHome,
      policyService: container!.policyService,
      isPolicyApprovalApproved: async (tenantId, approvalId) => {
        const row = await container!.db.get<{ kind: string; status: string }>(
          "SELECT kind, status FROM approvals WHERE tenant_id = ? AND approval_id = ? LIMIT 1",
          [tenantId, approvalId],
        );
        return row?.kind === "policy" && row?.status === "approved";
      },
    });

    const action = ActionPrimitive.parse({
      type: "CLI",
      args: {
        cmd: process.execPath,
        args: ["-e", "process.stdout.write('ok')"],
      },
      idempotency_key: "policy-approval-loop",
    });

    const enqueued = await engine.enqueuePlan({
      tenantId: DEFAULT_TENANT_ID,
      key: "agent:test",
      lane: "main",
      planId: "plan-policy-approved-resume",
      requestId: "req-policy-approved-resume",
      steps: [action],
      policySnapshotId: snapshot.policy_snapshot_id,
    });

    await engine.workerTick({ workerId: "w1", executor, runId: enqueued.runId });

    const approval = await container!.approvalDal.getPending({ tenantId: DEFAULT_TENANT_ID });
    expect(approval).toHaveLength(1);
    expect(approval[0]?.kind).toBe("policy");
    expect(approval[0]?.resume_token).toBeTruthy();
    if (!approval[0]?.resume_token) return;

    await container!.approvalDal.respond({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval[0].approval_id,
      decision: "approved",
    });
    await engine.resumeRun(approval[0].resume_token);

    await engine.workerTick({ workerId: "w1", executor, runId: enqueued.runId });
    await engine.workerTick({ workerId: "w1", executor, runId: enqueued.runId });

    const state = await loadRunState(enqueued.runId);
    expect(state.run?.status).toBe("succeeded");
    expect(state.step?.status).toBe("succeeded");

    const pendingAfter = await container!.approvalDal.getPending({ tenantId: DEFAULT_TENANT_ID });
    expect(pendingAfter).toHaveLength(0);
  });
});
