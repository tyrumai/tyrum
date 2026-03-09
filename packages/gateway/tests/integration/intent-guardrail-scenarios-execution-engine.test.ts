import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { PolicyBundle, type ActionPrimitive } from "@tyrum/schemas";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import {
  ExecutionEngine,
  type StepExecutor,
  type StepResult,
} from "../../src/modules/execution/engine.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import {
  sha256HexFromString,
  stableJsonStringify,
} from "../../src/modules/policy/canonical-json.js";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

function action(type: ActionPrimitive["type"], args?: Record<string, unknown>): ActionPrimitive {
  return { type, args: args ?? {} };
}

describe("ExecutionEngine intent guardrail scenarios (issues #632 / #599)", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;
  const sessionKey = "agent:default:ui:default:channel:intent-guardrail";

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
  };

  beforeEach(() => {
    process.env["TYRUM_POLICY_ENABLED"] = "1";
    process.env["TYRUM_POLICY_MODE"] = "enforce";
  });

  afterEach(async () => {
    restoreEnv("TYRUM_POLICY_ENABLED", originalEnv.TYRUM_POLICY_ENABLED);
    restoreEnv("TYRUM_POLICY_MODE", originalEnv.TYRUM_POLICY_MODE);

    await container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("pauses a side-effecting work item step when ToolIntent is missing (best-effort evidence)", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-intent-guardrail-"));
    container = createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

    const workboard = new WorkboardDal(container.db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const item = await workboard.createItem({
      scope,
      item: {
        kind: "action",
        title: "Intent guardrail conformance",
        acceptance: { ok: true },
        created_from_session_key: sessionKey,
      },
    });

    const snapshotDal = new PolicySnapshotDal(container.db);
    const snapshot = await snapshotDal.getOrCreate(
      DEFAULT_TENANT_ID,
      PolicyBundle.parse({
        v: 1,
        tools: { default: "allow", allow: [], require_approval: [], deny: [] },
        network_egress: { default: "allow", allow: [], require_approval: [], deny: [] },
      }),
    );

    const engine = new ExecutionEngine({
      db: container.db,
      redactionEngine: container.redactionEngine,
      policyService: container.policyService,
      logger: container.logger,
    });

    const { runId } = await engine.enqueuePlan({
      key: sessionKey,
      lane: "subagent",
      tenantId: scope.tenant_id,
      workspaceId: scope.workspace_id,
      planId: "plan-intent-missing-1",
      requestId: "req-intent-missing-1",
      policySnapshotId: snapshot.policy_snapshot_id,
      steps: [action("Http", { url: "https://example.com/" })],
      trigger: {
        kind: "manual",
        key: sessionKey,
        lane: "subagent",
        metadata: { ...scope, work_item_id: item.work_item_id },
      } as unknown as never,
    });

    const executor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        throw new Error("step execution should not run before intent approval");
      }),
    };

    await engine.workerTick({ workerId: "w1", executor, runId });

    expect((executor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      0,
    );

    const run = await container.db.get<{ status: string; paused_reason: string | null }>(
      "SELECT status, paused_reason FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run?.status).toBe("paused");
    expect(run?.paused_reason).toBe("approval");

    const approval = await container.db.get<{ kind: string; status: string }>(
      "SELECT kind, status FROM approvals WHERE run_id = ? ORDER BY created_at ASC LIMIT 1",
      [runId],
    );
    expect(approval?.kind).toBe("intent");
    expect(approval?.status).toBe("pending");

    const artifact = await container.db.get<{ kind: string; body_md: string | null }>(
      "SELECT kind, body_md FROM work_artifacts WHERE work_item_id = ? AND kind = 'verification_report' ORDER BY created_at DESC LIMIT 1",
      [item.work_item_id],
    );
    if (artifact) {
      expect(artifact.kind).toBe("verification_report");
      expect(artifact.body_md ?? "").toMatch(/missing toolintent/i);
    }
  });

  it("does not bypass policy approvals when ToolIntent matches the current intent graph", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-intent-guardrail-"));
    container = createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

    const workboard = new WorkboardDal(container.db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const item = await workboard.createItem({
      scope,
      item: {
        kind: "action",
        title: "Intent guardrail policy interplay",
        acceptance: { ok: true },
        created_from_session_key: sessionKey,
      },
    });

    const snapshotDal = new PolicySnapshotDal(container.db);
    const snapshot = await snapshotDal.getOrCreate(
      DEFAULT_TENANT_ID,
      PolicyBundle.parse({
        v: 1,
        tools: { default: "allow", allow: [], require_approval: ["webfetch"], deny: [] },
        network_egress: { default: "allow", allow: [], require_approval: [], deny: [] },
      }),
    );

    const engine = new ExecutionEngine({
      db: container.db,
      redactionEngine: container.redactionEngine,
      policyService: container.policyService,
      logger: container.logger,
    });

    const { runId } = await engine.enqueuePlan({
      key: sessionKey,
      lane: "subagent",
      tenantId: scope.tenant_id,
      workspaceId: scope.workspace_id,
      planId: "plan-intent-policy-1",
      requestId: "req-intent-policy-1",
      policySnapshotId: snapshot.policy_snapshot_id,
      steps: [action("Http", { url: "https://example.com/" })],
      trigger: {
        kind: "manual",
        key: sessionKey,
        lane: "subagent",
        metadata: { ...scope, work_item_id: item.work_item_id },
      } as unknown as never,
    });

    const intentGraphSha256 = sha256HexFromString(
      stableJsonStringify({
        v: 1,
        work_item_id: item.work_item_id,
        acceptance: item.acceptance ?? null,
        state_kv: {},
        decision_ids: [],
        policy_snapshot_id: snapshot.policy_snapshot_id,
      }),
    );

    await workboard.createArtifact({
      scope,
      artifact: {
        work_item_id: item.work_item_id,
        kind: "tool_intent",
        title: "ToolIntent (ok)",
        provenance_json: {
          v: 1,
          run_id: runId,
          step_index: 0,
          goal: "Fetch example.com",
          expected_value: "Confirm connectivity",
          cost_budget: { max_duration_ms: 5_000 },
          side_effect_class: "network",
          risk_class: "low",
          expected_evidence: { http: { status: 200 } },
          intent_graph_sha256: intentGraphSha256,
        },
      },
    });

    const executor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        throw new Error("step execution should not run before policy approval");
      }),
    };

    await engine.workerTick({ workerId: "w1", executor, runId });

    expect((executor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      0,
    );

    const run = await container.db.get<{ status: string; paused_reason: string | null }>(
      "SELECT status, paused_reason FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run?.status).toBe("paused");
    expect(run?.paused_reason).toBe("policy");

    const approval = await container.db.get<{ kind: string; status: string }>(
      "SELECT kind, status FROM approvals WHERE run_id = ? ORDER BY created_at ASC LIMIT 1",
      [runId],
    );
    expect(approval?.kind).toBe("policy");
    expect(approval?.status).toBe("pending");

    const decisionCount = await container.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM work_decisions WHERE work_item_id = ?",
      [item.work_item_id],
    );
    expect(decisionCount?.n).toBe(0);

    const guardrailArtifacts = await container.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM work_artifacts WHERE work_item_id = ? AND kind = 'verification_report'",
      [item.work_item_id],
    );
    expect(guardrailArtifacts?.n).toBe(0);
  });
});
