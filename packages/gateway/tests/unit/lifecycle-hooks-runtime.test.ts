import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionPrimitive } from "@tyrum/contracts";
import { DEFAULT_TENANT_ID, IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { PolicyBundleConfigDal } from "../../src/modules/policy/config-dal.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import { createGatewayConfigStore } from "../../src/modules/runtime-state/gateway-config-store.js";
import { PolicyService } from "@tyrum/runtime-policy";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { buildHookConversationKey } from "../../src/modules/automation/conversation-routing.js";
import { LifecycleHooksRuntime } from "../../src/modules/hooks/runtime.js";

describe("LifecycleHooksRuntime", () => {
  let db: SqliteDb | undefined;
  let homeDir: string | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("persists matching hooks as queued workflow runs before execution state materializes", async () => {
    db = openTestSqliteDb();
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-hooks-"));

    const policySnapshotDal = new PolicySnapshotDal(db);
    const policyOverrideDal = new PolicyOverrideDal(db);
    const policyService = new PolicyService({
      snapshotDal: policySnapshotDal,
      overrideDal: policyOverrideDal,
    });

    const hookKey = "hook:550e8400-e29b-41d4-a716-446655440000" as const;
    const hookConversationKey = buildHookConversationKey({
      agentKey: "default",
      workspaceKey: "default",
      hookKey,
    });

    const hooks = [
      {
        hook_key: hookKey,
        conversation_key: hookConversationKey,
        event: "command.execute",
        steps: [
          {
            type: "CLI",
            args: { cmd: "echo", args: ["hi"] },
          },
        ] satisfies ActionPrimitive[],
      },
      {
        hook_key: "hook:550e8400-e29b-41d4-a716-446655440001" as const,
        conversation_key: buildHookConversationKey({
          agentKey: "default",
          workspaceKey: "default",
          hookKey: "hook:550e8400-e29b-41d4-a716-446655440001",
        }),
        event: "gateway.start",
        steps: [{ type: "Http", args: { url: "https://example.com/" } }],
      },
    ] as const;

    const runtime = new LifecycleHooksRuntime({
      db,
      policyService,
      hooks,
    });

    const workflowRunIds = await runtime.fire({
      event: "command.execute",
      metadata: { command: "/status" },
    });

    expect(workflowRunIds).toHaveLength(1);

    const workflowRun = await db.get<{
      workflow_run_id: string;
      run_key: string;
      conversation_key: string;
      status: string;
      trigger_json: string;
      policy_snapshot_id: string | null;
    }>(
      `SELECT workflow_run_id, run_key, conversation_key, status, trigger_json, policy_snapshot_id
       FROM workflow_runs
       ORDER BY created_at ASC
       LIMIT 1`,
    );

    expect(workflowRun).toMatchObject({
      workflow_run_id: workflowRunIds[0],
      run_key: hookConversationKey,
      conversation_key: hookConversationKey,
      status: "queued",
    });
    expect(workflowRun?.policy_snapshot_id).toBeTruthy();

    const trigger = JSON.parse(workflowRun!.trigger_json) as {
      kind: string;
      metadata?: Record<string, unknown>;
    };
    expect(trigger.kind).toBe("hook");
    expect(trigger.metadata?.["hook_event"]).toBe("command.execute");
    expect(trigger.metadata?.["command"]).toBe("/status");

    const step = await db.get<{ action_json: string }>(
      `SELECT action_json
       FROM workflow_run_steps
       ORDER BY step_index ASC
       LIMIT 1`,
    );
    const parsedAction = JSON.parse(step!.action_json) as ActionPrimitive;
    expect(parsedAction.type).toBe("CLI");

    const materializedTurnCount = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM turns WHERE tenant_id = ?",
      [DEFAULT_TENANT_ID],
    );
    expect(materializedTurnCount?.n).toBe(0);

    const executionStepCount = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM execution_steps WHERE tenant_id = ?",
      [DEFAULT_TENANT_ID],
    );
    expect(executionStepCount?.n).toBe(0);
  });

  it("uses the hook conversation workspace and agent-scoped policy bundle", async () => {
    db = openTestSqliteDb();

    const identityScopeDal = new IdentityScopeDal(db);
    const travelWorkspaceId = await identityScopeDal.ensureWorkspaceId(DEFAULT_TENANT_ID, "travel");
    const defaultAgentId = await identityScopeDal.ensureAgentId(DEFAULT_TENANT_ID, "default");
    const policySnapshotDal = new PolicySnapshotDal(db);
    const policyOverrideDal = new PolicyOverrideDal(db);
    const policyBundles = new PolicyBundleConfigDal(db);
    const policyService = new PolicyService({
      snapshotDal: policySnapshotDal,
      overrideDal: policyOverrideDal,
      configStore: createGatewayConfigStore({ db }),
    });

    await policyBundles.set({
      scope: { tenantId: DEFAULT_TENANT_ID, scopeKind: "deployment" },
      bundle: {
        v: 1,
        tools: { default: "deny", allow: ["bash"], require_approval: [], deny: [] },
      },
      createdBy: { kind: "test" },
    });
    await policyBundles.set({
      scope: { tenantId: DEFAULT_TENANT_ID, scopeKind: "agent", agentId: defaultAgentId },
      bundle: {
        v: 1,
        tools: { default: "deny", allow: [], require_approval: ["bash"], deny: [] },
      },
      createdBy: { kind: "test" },
    });

    const hookKey = "hook:550e8400-e29b-41d4-a716-446655440004" as const;
    const hookConversationKey = buildHookConversationKey({
      agentKey: "default",
      workspaceKey: "travel",
      hookKey,
    });
    const runtime = new LifecycleHooksRuntime({
      db,
      policyService,
      hooks: [
        {
          hook_key: hookKey,
          conversation_key: hookConversationKey,
          event: "gateway.start",
          steps: [{ type: "CLI", args: { cmd: "echo", args: ["travel"] } }],
        },
      ],
    });

    await runtime.fire({ event: "gateway.start" });

    const workflowRun = await db.get<{ workspace_id: string; policy_snapshot_id: string | null }>(
      `SELECT workspace_id, policy_snapshot_id
       FROM workflow_runs
       WHERE conversation_key = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [hookConversationKey],
    );
    expect(workflowRun?.workspace_id).toBe(travelWorkspaceId);

    const snapshot = await policySnapshotDal.getById(
      DEFAULT_TENANT_ID,
      workflowRun!.policy_snapshot_id!,
    );
    expect(snapshot?.bundle.tools?.require_approval).toContain("bash");
    const decision = await policyService.evaluateToolCallFromSnapshot({
      tenantId: DEFAULT_TENANT_ID,
      policySnapshotId: workflowRun!.policy_snapshot_id!,
      agentId: defaultAgentId,
      workspaceId: travelWorkspaceId,
      toolId: "bash",
      toolMatchTarget: "echo travel",
    });
    expect(decision.decision).toBe("require_approval");
  });

  it("falls back to the shared config store when local hooks are empty", async () => {
    db = openTestSqliteDb();
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-hooks-shared-"));

    const policySnapshotDal = new PolicySnapshotDal(db);
    const policyOverrideDal = new PolicyOverrideDal(db);
    const policyService = new PolicyService({
      snapshotDal: policySnapshotDal,
      overrideDal: policyOverrideDal,
    });

    const configStore = {
      getLifecycleHooks: async () => [
        {
          hook_key: "hook:550e8400-e29b-41d4-a716-446655440002",
          conversation_key: buildHookConversationKey({
            agentKey: "default",
            workspaceKey: "default",
            hookKey: "hook:550e8400-e29b-41d4-a716-446655440002",
          }),
          event: "gateway.start",
          steps: [
            {
              type: "CLI",
              args: { cmd: "echo", args: ["shared"] },
            },
          ] satisfies ActionPrimitive[],
        },
      ],
    };

    const runtime = new LifecycleHooksRuntime({
      db,
      policyService,
      configStore: configStore as never,
      hooks: [],
    });

    const runIds = await runtime.fire({ event: "gateway.start" });

    expect(runIds).toHaveLength(1);
  });

  it("falls back to the shared config store when local hooks are omitted", async () => {
    db = openTestSqliteDb();
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-hooks-shared-undefined-"));

    const policySnapshotDal = new PolicySnapshotDal(db);
    const policyOverrideDal = new PolicyOverrideDal(db);
    const policyService = new PolicyService({
      snapshotDal: policySnapshotDal,
      overrideDal: policyOverrideDal,
    });

    const configStore = {
      getLifecycleHooks: async () => [
        {
          hook_key: "hook:550e8400-e29b-41d4-a716-446655440003",
          conversation_key: buildHookConversationKey({
            agentKey: "default",
            workspaceKey: "default",
            hookKey: "hook:550e8400-e29b-41d4-a716-446655440003",
          }),
          event: "gateway.start",
          steps: [
            {
              type: "CLI",
              args: { cmd: "echo", args: ["shared"] },
            },
          ] satisfies ActionPrimitive[],
        },
      ],
    };

    const runtime = new LifecycleHooksRuntime({
      db,
      policyService,
      configStore: configStore as never,
    });

    const runIds = await runtime.fire({ event: "gateway.start" });

    expect(runIds).toHaveLength(1);
  });
});
