import { afterEach, describe, expect, it } from "vitest";
import { executeCommand } from "../../src/modules/commands/dispatcher.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("/status command", () => {
  let db: ReturnType<typeof openTestSqliteDb> | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("returns model/auth health, catalog freshness, lane state, queue depth, and sandbox mode", async () => {
    db = openTestSqliteDb();

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const soonIso = new Date(now + 30 * 60 * 1000).toISOString();

    await db.run(
      `INSERT INTO models_dev_cache (
         id,
         fetched_at,
         etag,
         sha256,
         json,
         source,
         last_error,
         updated_at
       ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nowIso,
        "etag-1",
        "sha-1",
        JSON.stringify({
          openai: {
            id: "openai",
            name: "OpenAI",
            models: {
              "gpt-4.1": { id: "gpt-4.1", name: "GPT-4.1" },
            },
          },
        }),
        "cache",
        null,
        nowIso,
      ],
    );

    await db.run(
      `INSERT INTO auth_profiles (
         profile_id,
         agent_id,
         provider,
         type,
         secret_handles_json,
         labels_json,
         status,
         cooldown_until_ms,
         expires_at,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      [
        "profile-active",
        "default",
        "openai",
        "oauth",
        JSON.stringify({ access_token_handle: "h-access", refresh_token_handle: "h-refresh" }),
        JSON.stringify({ email: "active@example.test" }),
        now + 60_000,
        soonIso,
        nowIso,
        nowIso,
      ],
    );

    await db.run(
      `INSERT INTO auth_profiles (
         profile_id,
         agent_id,
         provider,
         type,
         secret_handles_json,
         labels_json,
         status,
         disabled_reason,
         disabled_at,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'disabled', ?, ?, ?, ?)`,
      [
        "profile-disabled",
        "default",
        "openai",
        "api_key",
        JSON.stringify({ api_key_handle: "h-key" }),
        "{}",
        "quota_exhausted",
        nowIso,
        nowIso,
        nowIso,
      ],
    );

    await db.run(
      `INSERT INTO sessions (
         agent_id,
         session_id,
         channel,
         thread_id,
         summary,
         turns_json,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, '', '[]', ?, ?)`,
      ["default", "ui:thread-1", "ui", "thread-1", nowIso, nowIso],
    );

    await db.run(
      `INSERT INTO session_provider_pins (
         agent_id,
         session_id,
         provider,
         profile_id,
         pinned_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      ["default", "ui:thread-1", "openai", "profile-active", nowIso, nowIso],
    );

    await db.run(
      `INSERT INTO execution_jobs (
         job_id,
         key,
         lane,
         status,
         created_at,
         trigger_json,
         input_json,
         latest_run_id
       ) VALUES (?, ?, ?, 'queued', ?, '{}', '{}', ?)`,
      ["job-1", "agent:default:ui:main", "main", nowIso, "run-2"],
    );
    await db.run(
      `INSERT INTO execution_jobs (
         job_id,
         key,
         lane,
         status,
         created_at,
         trigger_json,
         input_json,
         latest_run_id
       ) VALUES (?, ?, ?, 'running', ?, '{}', '{}', ?)`,
      ["job-2", "agent:default:ui:main", "main", nowIso, "run-2"],
    );
    await db.run(
      `INSERT INTO execution_jobs (
         job_id,
         key,
         lane,
         status,
         created_at,
         trigger_json,
         input_json,
         latest_run_id
       ) VALUES (?, ?, ?, 'queued', ?, '{}', '{}', ?)`,
      ["job-3", "cron:daily", "cron", nowIso, "run-3"],
    );

    await db.run(
      `INSERT INTO execution_runs (
         run_id,
         job_id,
         key,
         lane,
         status,
         attempt,
         created_at
       ) VALUES (?, ?, ?, ?, 'queued', 1, ?)`,
      ["run-1", "job-1", "agent:default:ui:main", "main", nowIso],
    );
    await db.run(
      `INSERT INTO execution_runs (
         run_id,
         job_id,
         key,
         lane,
         status,
         attempt,
         created_at,
         started_at
       ) VALUES (?, ?, ?, ?, 'running', 1, ?, ?)`,
      ["run-2", "job-2", "agent:default:ui:main", "main", nowIso, nowIso],
    );
    await db.run(
      `INSERT INTO execution_runs (
         run_id,
         job_id,
         key,
         lane,
         status,
         attempt,
         created_at
       ) VALUES (?, ?, ?, ?, 'queued', 1, ?)`,
      ["run-3", "job-3", "cron:daily", "cron", nowIso],
    );

    await db.run(
      `INSERT INTO lane_leases (key, lane, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)`,
      ["agent:default:ui:main", "main", "worker-a", now + 60_000],
    );

    await db.run(
      `INSERT INTO channel_inbox (
         source,
         thread_id,
         message_id,
         key,
         lane,
         received_at_ms,
         payload_json,
         status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued')`,
      ["telegram", "chat-1", "msg-1", "agent:default:ui:main", "main", now, "{}"],
    );
    await db.run(
      `INSERT INTO channel_outbox (
         inbox_id,
         source,
         thread_id,
         dedupe_key,
         text,
         status
       ) VALUES (1, ?, ?, ?, ?, 'queued')`,
      ["telegram", "chat-1", "dedupe-1", "queued"],
    );

    await db.run(
      `INSERT INTO watcher_firings (
         firing_id,
         watcher_id,
         plan_id,
         trigger_type,
         scheduled_at_ms,
         status
       ) VALUES (?, ?, ?, ?, ?, 'queued')`,
      ["firing-1", 1, "plan-1", "cron", now],
    );

    const result = await executeCommand("/status", {
      runtime: {
        version: "test-version",
        instanceId: "test-instance",
        role: "all",
        dbKind: "sqlite",
        isExposed: false,
        otelEnabled: false,
      },
      db,
      policyService: {
        getStatus: async () => ({
          enabled: true,
          observe_only: false,
          effective_sha256: "policy-sha",
          sources: { deployment: "default", agent: null },
        }),
        loadEffectiveBundle: async () => ({
          bundle: {
            v: 1 as const,
            tools: {
              default: "require_approval" as const,
              allow: [],
              require_approval: ["cli.*"],
              deny: [],
            },
          },
          sha256: "policy-sha",
          sources: { deployment: "default", agent: null, playbook: null },
        }),
      } as unknown as import("../../src/modules/policy/service.js").PolicyService,
    });

    expect(result.output).toContain("queue_depth");

    const payload = result.data as Record<string, unknown>;
    const catalog = payload["catalog_freshness"] as Record<string, unknown>;
    expect(catalog["source"]).toBe("cache");
    expect(catalog["last_refresh_status"]).toBe("ok");
    expect(catalog["provider_count"]).toBe(1);
    expect(catalog["model_count"]).toBe(1);

    const modelAuth = payload["model_auth"] as Record<string, unknown>;
    const auth = modelAuth["auth_profiles"] as Record<string, unknown>;
    expect(auth["total"]).toBe(2);
    expect(auth["active"]).toBe(1);
    expect(auth["disabled"]).toBe(1);
    expect(auth["cooldown_active"]).toBe(1);
    expect(auth["oauth_expiring_within_24h"]).toBe(1);
    expect((auth["selected"] as Record<string, unknown>)["profile_id"]).toBe("profile-active");

    const sessionLanes = payload["session_lanes"] as Array<Record<string, unknown>>;
    const mainLane = sessionLanes.find(
      (lane) => lane["key"] === "agent:default:ui:main" && lane["lane"] === "main",
    );
    expect(mainLane).toBeDefined();
    expect(mainLane?.["latest_run_status"]).toBe("running");
    expect(mainLane?.["queued_runs"]).toBe(1);
    expect(mainLane?.["lease_active"]).toBe(true);

    const queueDepth = payload["queue_depth"] as Record<string, unknown>;
    const executionRuns = queueDepth["execution_runs"] as Record<string, unknown>;
    expect(executionRuns["queued"]).toBe(2);
    expect(executionRuns["running"]).toBe(1);

    const channelOutbox = queueDepth["channel_outbox"] as Record<string, unknown>;
    expect(channelOutbox["queued"]).toBe(1);

    const sandbox = payload["sandbox"] as Record<string, unknown>;
    expect(sandbox["mode"]).toBe("enforce");
    expect(sandbox["elevated_execution_available"]).toBe(true);
  });
});
