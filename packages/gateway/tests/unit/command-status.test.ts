import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { executeCommand } from "../../src/modules/commands/dispatcher.js";
import { SessionDal } from "../../src/modules/agent/session-dal.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
  IdentityScopeDal,
} from "../../src/modules/identity/scope.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("/status command", () => {
  let db: ReturnType<typeof openTestSqliteDb> | undefined;

  async function ensureSession(input: {
    agentKey: string;
    channel: string;
    threadId: string;
    containerKind: "dm" | "group" | "channel";
  }): Promise<Awaited<ReturnType<SessionDal["getOrCreate"]>>> {
    if (!db) throw new Error("db not initialized");
    const sessionDal = new SessionDal(db, new IdentityScopeDal(db), new ChannelThreadDal(db));
    return await sessionDal.getOrCreate({
      scopeKeys: { agentKey: input.agentKey, workspaceKey: "default" },
      connectorKey: input.channel,
      accountKey: undefined,
      providerThreadId: input.threadId,
      containerKind: input.containerKind,
    });
  }

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("returns model/auth health, catalog freshness, lane state, queue depth, and sandbox mode", async () => {
    db = openTestSqliteDb();

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const agoIso = new Date(now - 60_000).toISOString();

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

    const session = await ensureSession({
      agentKey: "default",
      channel: "ui",
      threadId: "thread-1",
      containerKind: "channel",
    });

    const activeProfileId = randomUUID();
    await db.run(
      `INSERT INTO auth_profiles (
         tenant_id,
         auth_profile_id,
         auth_profile_key,
         provider_key,
         type,
         labels_json,
         status,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        activeProfileId,
        "profile-active",
        "openai",
        "oauth",
        JSON.stringify({ email: "active@example.test" }),
        nowIso,
        nowIso,
      ],
    );

    const disabledProfileId = randomUUID();
    await db.run(
      `INSERT INTO auth_profiles (
         tenant_id,
         auth_profile_id,
         auth_profile_key,
         provider_key,
         type,
         labels_json,
         status,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'disabled', ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        disabledProfileId,
        "profile-disabled",
        "openai",
        "api_key",
        "{}",
        nowIso,
        nowIso,
      ],
    );

    await db.run(
      `INSERT INTO conversation_provider_pins (
         tenant_id,
         conversation_id,
         provider_key,
         auth_profile_id,
         pinned_at
       ) VALUES (?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, session.session_id, "openai", activeProfileId, nowIso],
    );

    const mainKey = "agent:default:ui:main";
    const mainLane = "main";
    const cronKey = "cron:daily";
    const cronLane = "cron";

    await db.run(
      `INSERT INTO turn_jobs (
         tenant_id,
         job_id,
         agent_id,
         workspace_id,
         conversation_key,
         lane,
         status,
         created_at,
         trigger_json,
         input_json,
         latest_turn_id
       ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, '{}', '{}', ?)`,
      [
        DEFAULT_TENANT_ID,
        "job-1",
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        mainKey,
        mainLane,
        agoIso,
        "run-1",
      ],
    );
    await db.run(
      `INSERT INTO turn_jobs (
         tenant_id,
         job_id,
         agent_id,
         workspace_id,
         conversation_key,
         lane,
         status,
         created_at,
         trigger_json,
         input_json,
         latest_turn_id
       ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, '{}', '{}', ?)`,
      [
        DEFAULT_TENANT_ID,
        "job-2",
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        mainKey,
        mainLane,
        nowIso,
        "run-2",
      ],
    );
    await db.run(
      `INSERT INTO turn_jobs (
         tenant_id,
         job_id,
         agent_id,
         workspace_id,
         conversation_key,
         lane,
         status,
         created_at,
         trigger_json,
         input_json,
         latest_turn_id
       ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, '{}', '{}', ?)`,
      [
        DEFAULT_TENANT_ID,
        "job-3",
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        cronKey,
        cronLane,
        nowIso,
        "run-3",
      ],
    );

    await db.run(
      `INSERT INTO turns (
         tenant_id,
         turn_id,
         job_id,
         conversation_key,
         lane,
         status,
         attempt,
         created_at
       ) VALUES (?, ?, ?, ?, ?, 'queued', 1, ?)`,
      [DEFAULT_TENANT_ID, "run-1", "job-1", mainKey, mainLane, agoIso],
    );
    await db.run(
      `INSERT INTO turns (
         tenant_id,
         turn_id,
         job_id,
         conversation_key,
         lane,
         status,
         attempt,
         created_at,
         started_at
       ) VALUES (?, ?, ?, ?, ?, 'running', 1, ?, ?)`,
      [DEFAULT_TENANT_ID, "run-2", "job-2", mainKey, mainLane, nowIso, nowIso],
    );
    await db.run(
      `INSERT INTO turns (
         tenant_id,
         turn_id,
         job_id,
         conversation_key,
         lane,
         status,
         attempt,
         created_at
       ) VALUES (?, ?, ?, ?, ?, 'queued', 1, ?)`,
      [DEFAULT_TENANT_ID, "run-3", "job-3", cronKey, cronLane, nowIso],
    );

    await db.run(
      `INSERT INTO conversation_leases (
         tenant_id,
         conversation_key,
         lane,
         lease_owner,
         lease_expires_at_ms
       )
       VALUES (?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, mainKey, mainLane, "worker-a", now + 60_000],
    );

    await db.run(
      `INSERT INTO channel_inbox (
         tenant_id,
         source,
         thread_id,
         message_id,
         key,
         lane,
         received_at_ms,
         payload_json,
         status,
         workspace_id,
         session_id,
         channel_thread_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "telegram:default",
        "chat-1",
        "msg-1",
        mainKey,
        mainLane,
        now,
        "{}",
        DEFAULT_WORKSPACE_ID,
        session.session_id,
        session.channel_thread_id,
      ],
    );
    const inboxRow = await db.get<{ inbox_id: number }>(
      "SELECT inbox_id FROM channel_inbox WHERE message_id = ?",
      ["msg-1"],
    );
    expect(typeof inboxRow?.inbox_id).toBe("number");

    await db.run(
      `INSERT INTO channel_outbox (
         tenant_id,
         inbox_id,
         source,
         thread_id,
         dedupe_key,
         text,
         status,
         workspace_id,
         session_id,
         channel_thread_id
       ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        inboxRow!.inbox_id,
        "telegram:default",
        "chat-1",
        "dedupe-1",
        "queued",
        DEFAULT_WORKSPACE_ID,
        session.session_id,
        session.channel_thread_id,
      ],
    );

    await db.run(
      `INSERT INTO watchers (
         tenant_id,
         watcher_id,
         watcher_key,
         agent_id,
         workspace_id,
         trigger_type,
         trigger_config_json,
         active,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "watcher-1",
        "watcher-1",
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        "cron",
        "{}",
        nowIso,
        nowIso,
      ],
    );

    await db.run(
      `INSERT INTO watcher_firings (
         tenant_id,
         watcher_firing_id,
         watcher_id,
         scheduled_at_ms,
         status
       ) VALUES (?, ?, ?, ?, 'queued')`,
      [DEFAULT_TENANT_ID, "firing-1", "watcher-1", now],
    );

    const result = await executeCommand("/status", {
      runtime: {
        version: "test-version",
        instanceId: "test-instance",
        role: "all",
        dbKind: "sqlite",
        isExposed: false,
        otelEnabled: false,
        authEnabled: true,
        toolrunnerHardeningProfile: "hardened",
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
      } as unknown as import("@tyrum/runtime-policy").PolicyService,
    });

    expect(result.output).toContain("queue_depth");

    const payload = result.data as Record<string, unknown>;
    const catalog = payload["catalog_freshness"] as Record<string, unknown>;
    expect(catalog["source"]).toBe("cache");
    expect(catalog["last_refresh_status"]).toBe("ok");
    expect(catalog["provider_count"]).toBe(1);
    expect(catalog["model_count"]).toBe(1);

    const auth = payload["auth"] as Record<string, unknown>;
    expect(auth["enabled"]).toBe(true);

    const modelAuth = payload["model_auth"] as Record<string, unknown>;
    const authProfiles = modelAuth["auth_profiles"] as Record<string, unknown>;
    expect(authProfiles["total"]).toBe(2);
    expect(authProfiles["active"]).toBe(1);
    expect(authProfiles["disabled"]).toBe(1);
    expect(authProfiles["cooldown_active"]).toBe(0);
    expect(authProfiles["oauth_expiring_within_24h"]).toBe(0);
    expect((authProfiles["selected"] as Record<string, unknown>)["profile_id"]).toBe(
      activeProfileId,
    );

    const sessionLanes = payload["session_lanes"] as Array<Record<string, unknown>>;
    const mainLaneRow = sessionLanes.find(
      (lane) => lane["key"] === "agent:default:ui:main" && lane["lane"] === "main",
    );
    expect(mainLaneRow).toBeDefined();
    expect(mainLaneRow?.["latest_run_status"]).toBe("running");
    expect(mainLaneRow?.["queued_runs"]).toBe(1);
    expect(mainLaneRow?.["lease_active"]).toBe(true);

    const queueDepth = payload["queue_depth"] as Record<string, unknown>;
    const executionRuns = queueDepth["turns"] as Record<string, unknown>;
    expect(executionRuns["queued"]).toBe(2);
    expect(executionRuns["running"]).toBe(1);

    const channelOutbox = queueDepth["channel_outbox"] as Record<string, unknown>;
    expect(channelOutbox["queued"]).toBe(1);

    const sandbox = payload["sandbox"] as Record<string, unknown>;
    expect(sandbox["mode"]).toBe("enforce");
    expect(sandbox["elevated_execution_available"]).toBe(true);
    expect(sandbox["hardening_profile"]).toBe("hardened");
  });
});
