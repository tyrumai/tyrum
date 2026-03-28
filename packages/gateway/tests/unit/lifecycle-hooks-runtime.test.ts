import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionPrimitive } from "@tyrum/contracts";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
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

  it("enqueues allowlisted hooks on matching events", async () => {
    db = openTestSqliteDb();
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-hooks-"));

    const policySnapshotDal = new PolicySnapshotDal(db);
    const policyOverrideDal = new PolicyOverrideDal(db);
    const policyService = new PolicyService({
      snapshotDal: policySnapshotDal,
      overrideDal: policyOverrideDal,
    });

    const engine = new ExecutionEngine({ db });
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
      engine,
      policyService,
      hooks,
    });

    await runtime.fire({
      event: "command.execute",
      metadata: { command: "/status" },
    });

    const job = await db.get<{
      conversation_key: string;
      trigger_json: string;
      policy_snapshot_id: string | null;
    }>(
      "SELECT conversation_key, trigger_json, policy_snapshot_id FROM turn_jobs ORDER BY created_at ASC LIMIT 1",
    );

    expect(job?.conversation_key).toBe(hookConversationKey);
    expect(job?.policy_snapshot_id).toBeTruthy();

    const trigger = JSON.parse(job!.trigger_json) as {
      kind: string;
      metadata?: Record<string, unknown>;
    };
    expect(trigger.kind).toBe("hook");
    expect(trigger.metadata?.["hook_event"]).toBe("command.execute");
    expect(trigger.metadata?.["command"]).toBe("/status");

    const step = await db.get<{ action_json: string }>(
      "SELECT action_json FROM execution_steps ORDER BY step_index ASC LIMIT 1",
    );
    const parsedAction = JSON.parse(step!.action_json) as ActionPrimitive;
    expect(parsedAction.type).toBe("CLI");
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

    const engine = new ExecutionEngine({ db });
    const hookKey = "hook:550e8400-e29b-41d4-a716-446655440004" as const;
    const hookConversationKey = buildHookConversationKey({
      agentKey: "default",
      workspaceKey: "travel",
      hookKey,
    });
    const runtime = new LifecycleHooksRuntime({
      db,
      engine,
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

    const job = await db.get<{ workspace_id: string; policy_snapshot_id: string | null }>(
      `SELECT workspace_id, policy_snapshot_id
       FROM turn_jobs
       WHERE conversation_key = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [hookConversationKey],
    );
    expect(job?.workspace_id).toBe(travelWorkspaceId);

    const snapshot = await policySnapshotDal.getById(DEFAULT_TENANT_ID, job!.policy_snapshot_id!);
    expect(snapshot?.bundle.tools?.require_approval).toContain("bash");
    const decision = await policyService.evaluateToolCallFromSnapshot({
      tenantId: DEFAULT_TENANT_ID,
      policySnapshotId: job!.policy_snapshot_id!,
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

    const engine = new ExecutionEngine({ db });
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
      engine,
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

    const engine = new ExecutionEngine({ db });
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
      engine,
      policyService,
      configStore: configStore as never,
    });

    const runIds = await runtime.fire({ event: "gateway.start" });

    expect(runIds).toHaveLength(1);
  });
});
