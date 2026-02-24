import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionPrimitive } from "@tyrum/schemas";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import { PolicyService } from "../../src/modules/policy/service.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
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
      home: homeDir,
      snapshotDal: policySnapshotDal,
      overrideDal: policyOverrideDal,
    });

    const engine = new ExecutionEngine({ db });
    const hookKey = "hook:550e8400-e29b-41d4-a716-446655440000" as const;

    const hooks = [
      {
        hook_key: hookKey,
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

    const job = await db.get<{ key: string; lane: string; trigger_json: string; policy_snapshot_id: string | null }>(
      "SELECT key, lane, trigger_json, policy_snapshot_id FROM execution_jobs ORDER BY created_at ASC LIMIT 1",
    );

    expect(job?.key).toBe(hookKey);
    expect(job?.lane).toBe("cron");
    expect(job?.policy_snapshot_id).toBeTruthy();

    const trigger = JSON.parse(job!.trigger_json) as { kind: string; metadata?: Record<string, unknown> };
    expect(trigger.kind).toBe("hook");
    expect(trigger.metadata?.["hook_event"]).toBe("command.execute");
    expect(trigger.metadata?.["command"]).toBe("/status");

    const step = await db.get<{ action_json: string }>(
      "SELECT action_json FROM execution_steps ORDER BY step_index ASC LIMIT 1",
    );
    const parsedAction = JSON.parse(step!.action_json) as ActionPrimitive;
    expect(parsedAction.type).toBe("CLI");
  });
});
