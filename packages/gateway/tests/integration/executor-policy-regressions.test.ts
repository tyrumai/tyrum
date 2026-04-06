import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { ActionPrimitive, PolicyBundle, type SecretHandle } from "@tyrum/contracts";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { createLocalStepExecutor } from "../../src/modules/execution/local-step-executor.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import { createWorkflowRunRunner } from "../../src/modules/workflow-run/create-runner.js";
import {
  enqueueWorkflowRunForTest,
  tickWorkflowRunUntilSettled,
} from "../helpers/workflow-run-support.js";

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
    return {
      container,
      homeDir,
      workflowRunner: createWorkflowRunRunner(container),
    };
  }

  async function loadRunState(workflowRunId: string) {
    const run = await container!.db.get<{ status: string }>(
      "SELECT status FROM workflow_runs WHERE workflow_run_id = ?",
      [workflowRunId],
    );
    const step = await container!.db.get<{
      status: string;
      error: string | null;
      policy_snapshot_id: string | null;
    }>(
      `SELECT status, error, policy_snapshot_id
       FROM workflow_run_steps
       WHERE workflow_run_id = ?
       ORDER BY step_index DESC
       LIMIT 1`,
      [workflowRunId],
    );
    return { run, step };
  }

  it("fails workflow execution closed when executor context is missing a policy snapshot id", async () => {
    const { homeDir: harnessHome } = await createHarness();
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

    const workflowRunId = await enqueueWorkflowRunForTest(container!, {
      runKey: "agent:test",
      planId: "plan-missing-policy",
      requestId: "req-missing-policy",
      actions: [action],
    });

    await tickWorkflowRunUntilSettled(container!, { workflowRunId, executor, maxTicks: 1 });

    const state = await loadRunState(workflowRunId);
    expect(state.run?.status).toBe("failed");
    expect(state.step?.status).toBe("failed");
    expect(state.step?.error).toContain("policy snapshot");
    expect(state.step?.policy_snapshot_id).toBeNull();
  });

  it("fails workflow execution before fetch when executor-side policy denies egress", async () => {
    const { homeDir: harnessHome } = await createHarness();
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

    const workflowRunId = await enqueueWorkflowRunForTest(container!, {
      runKey: "agent:test",
      planId: "plan-egress-deny",
      requestId: "req-egress-deny",
      actions: [action],
      policySnapshotId: snapshot.policy_snapshot_id,
    });

    await tickWorkflowRunUntilSettled(container!, { workflowRunId, executor, maxTicks: 1 });

    const state = await loadRunState(workflowRunId);
    expect(state.run?.status).toBe("failed");
    expect(state.step?.status).toBe("failed");
    expect(state.step?.error).toContain("policy denied");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails workflow execution before secret resolution when executor-side policy denies secrets", async () => {
    const { homeDir: harnessHome } = await createHarness();
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

    const workflowRunId = await enqueueWorkflowRunForTest(container!, {
      runKey: "agent:test",
      planId: "plan-secret-deny",
      requestId: "req-secret-deny",
      actions: [action],
      policySnapshotId: snapshot.policy_snapshot_id,
    });

    await tickWorkflowRunUntilSettled(container!, { workflowRunId, executor, maxTicks: 1 });

    const state = await loadRunState(workflowRunId);
    expect(state.run?.status).toBe("failed");
    expect(state.step?.status).toBe("failed");
    expect(state.step?.error).toContain("policy denied secret resolution");
    expect(secretProvider.list).toHaveBeenCalled();
    expect(secretProvider.resolve).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not re-pause executor-side policy gates after the same policy approval is approved", async () => {
    const { homeDir: harnessHome, workflowRunner } = await createHarness();
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

    const workflowRunId = await enqueueWorkflowRunForTest(container!, {
      runKey: "agent:test",
      planId: "plan-policy-approved-resume",
      requestId: "req-policy-approved-resume",
      actions: [action],
      policySnapshotId: snapshot.policy_snapshot_id,
    });

    await tickWorkflowRunUntilSettled(container!, {
      workflowRunId,
      executor,
      maxTicks: 1,
      terminalStatuses: ["paused"],
    });

    const approvals = await container!.approvalDal.getPending({ tenantId: DEFAULT_TENANT_ID });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.kind).toBe("policy");
    expect(approvals[0]?.resume_token).toBeTruthy();
    if (!approvals[0]?.resume_token) return;

    await container!.approvalDal.respond({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approvals[0].approval_id,
      decision: "approved",
    });
    await workflowRunner.resumeRun(approvals[0].resume_token);

    await tickWorkflowRunUntilSettled(container!, { workflowRunId, executor, maxTicks: 2 });

    const state = await loadRunState(workflowRunId);
    expect(state.run?.status).toBe("succeeded");
    expect(state.step?.status).toBe("succeeded");
    expect(state.step?.error).toBeNull();

    const pendingAfter = await container!.approvalDal.getPending({ tenantId: DEFAULT_TENANT_ID });
    expect(pendingAfter).toHaveLength(0);
  });
});
