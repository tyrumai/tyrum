import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import {
  createTestApp,
  createTestAuthAndSecrets,
  createTestContainer,
  decorateAppWithDefaultAuth,
} from "./helpers.js";

type UsageApp = Awaited<ReturnType<typeof createTestApp>>;
type UsageContainer = UsageApp["container"];
type AttemptSeed = {
  jobId: string;
  runId: string;
  stepId: string;
  attemptId: string;
  key: string;
  lane: string;
  totalTokens: number;
};
type PinnedProviderUsageApp = {
  app: UsageApp["app"];
  authProfileKey: string;
  close: () => Promise<void>;
};

async function insertAttempt(container: UsageContainer, input: AttemptSeed): Promise<void> {
  await container.db.run(
    `INSERT INTO execution_jobs (
       tenant_id,
       job_id,
       agent_id,
       workspace_id,
       key,
       lane,
       status,
       trigger_json,
       input_json,
       latest_run_id
     )
     VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
    [
      DEFAULT_TENANT_ID,
      input.jobId,
      DEFAULT_AGENT_ID,
      DEFAULT_WORKSPACE_ID,
      input.key,
      input.lane,
      "{}",
      "{}",
      input.runId,
    ],
  );
  await container.db.run(
    `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt)
     VALUES (?, ?, ?, ?, ?, 'succeeded', 1)`,
    [DEFAULT_TENANT_ID, input.runId, input.jobId, input.key, input.lane],
  );
  await container.db.run(
    `INSERT INTO execution_steps (tenant_id, step_id, run_id, step_index, status, action_json)
     VALUES (?, ?, ?, 0, 'succeeded', ?)`,
    [DEFAULT_TENANT_ID, input.stepId, input.runId, "{}"],
  );

  const costJson = JSON.stringify({
    duration_ms: 1000,
    total_tokens: input.totalTokens,
    usd_micros: input.totalTokens,
  });

  await container.db.run(
    `INSERT INTO execution_attempts (
       tenant_id,
       attempt_id,
       step_id,
       attempt,
       status,
       started_at,
       finished_at,
       artifacts_json,
       cost_json
     ) VALUES (?, ?, ?, 1, 'succeeded', ?, ?, '[]', ?)`,
    [
      DEFAULT_TENANT_ID,
      input.attemptId,
      input.stepId,
      new Date().toISOString(),
      new Date().toISOString(),
      costJson,
    ],
  );
}

async function createPinnedProviderUsageApp(input: {
  authProfileId: string;
  authProfileKey: string;
  sessionId: string;
}): Promise<PinnedProviderUsageApp> {
  const container = await createTestContainer();
  const { authTokens, tenantAdminToken, secretProviderForTenant } =
    await createTestAuthAndSecrets(container);
  const secretProvider = secretProviderForTenant(DEFAULT_TENANT_ID);
  const app = createApp(container, { authTokens, secretProviderForTenant });
  decorateAppWithDefaultAuth(app, tenantAdminToken);
  const handle = await secretProvider.store("OPENROUTER_API_KEY", "ignored-by-env-provider");

  await container.db.run(
    `INSERT INTO auth_profiles (
       tenant_id,
       auth_profile_id,
       auth_profile_key,
       provider_key,
       type,
       status
     ) VALUES (?, ?, ?, 'openrouter', 'api_key', 'active')`,
    [DEFAULT_TENANT_ID, input.authProfileId, input.authProfileKey],
  );
  const secret = await container.db.get<{ secret_id: string }>(
    "SELECT secret_id FROM secrets WHERE tenant_id = ? AND secret_key = ? LIMIT 1",
    [DEFAULT_TENANT_ID, handle.handle_id],
  );
  expect(secret?.secret_id).toBeTruthy();
  await container.db.run(
    `INSERT INTO auth_profile_secrets (tenant_id, auth_profile_id, slot_key, secret_id)
     VALUES (?, ?, 'api_key', ?)`,
    [DEFAULT_TENANT_ID, input.authProfileId, secret!.secret_id],
  );

  const channelAccountId = `channel-account-${input.sessionId}`;
  const channelThreadId = `channel-thread-${input.sessionId}`;
  await container.db.run(
    `INSERT INTO channel_accounts (
       tenant_id,
       workspace_id,
       channel_account_id,
       connector_key,
       account_key
     ) VALUES (?, ?, ?, 'test', ?)`,
    [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, channelAccountId, `account:${input.sessionId}`],
  );
  await container.db.run(
    `INSERT INTO channel_threads (
       tenant_id,
       workspace_id,
       channel_thread_id,
       channel_account_id,
       provider_thread_id,
       container_kind
     ) VALUES (?, ?, ?, ?, ?, 'dm')`,
    [
      DEFAULT_TENANT_ID,
      DEFAULT_WORKSPACE_ID,
      channelThreadId,
      channelAccountId,
      `thread:${input.sessionId}`,
    ],
  );
  await container.db.run(
    `INSERT INTO sessions (
       tenant_id,
       session_id,
       session_key,
       agent_id,
       workspace_id,
       channel_thread_id,
       summary,
       transcript_json
     ) VALUES (?, ?, ?, ?, ?, ?, '', '[]')`,
    [
      DEFAULT_TENANT_ID,
      input.sessionId,
      `agent:default:test:${input.sessionId}`,
      DEFAULT_AGENT_ID,
      DEFAULT_WORKSPACE_ID,
      channelThreadId,
    ],
  );
  await container.db.run(
    `INSERT INTO session_provider_pins (tenant_id, session_id, provider_key, auth_profile_id)
     VALUES (?, ?, 'openrouter', ?)`,
    [DEFAULT_TENANT_ID, input.sessionId, input.authProfileId],
  );

  return {
    app,
    authProfileKey: input.authProfileKey,
    close: async () => {
      await container.db.close();
    },
  };
}

describe("usage routes", () => {
  it("rolls up attempt costs across execution attempts", async () => {
    const { app, container } = await createTestApp();

    const jobId = "job-usage-1";
    const runId = "run-usage-1";
    const stepId = "step-usage-1";
    const attemptId = "attempt-usage-1";

    await container.db.run(
      `INSERT INTO execution_jobs (
         tenant_id,
         job_id,
         agent_id,
         workspace_id,
         key,
         lane,
         status,
         trigger_json,
         input_json,
         latest_run_id
       )
       VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        jobId,
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        "key-1",
        "lane-1",
        "{}",
        "{}",
        runId,
      ],
    );
    await container.db.run(
      `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt)
       VALUES (?, ?, ?, ?, ?, 'succeeded', 1)`,
      [DEFAULT_TENANT_ID, runId, jobId, "key-1", "lane-1"],
    );
    await container.db.run(
      `INSERT INTO execution_steps (tenant_id, step_id, run_id, step_index, status, action_json)
       VALUES (?, ?, ?, 0, 'succeeded', ?)`,
      [DEFAULT_TENANT_ID, stepId, runId, "{}"],
    );

    const costJson = JSON.stringify({
      duration_ms: 1234,
      total_tokens: 50,
      usd_micros: 987,
    });

    await container.db.run(
      `INSERT INTO execution_attempts (
         tenant_id,
         attempt_id,
         step_id,
         attempt,
         status,
         started_at,
         finished_at,
         artifacts_json,
         cost_json
       ) VALUES (?, ?, ?, 1, 'succeeded', ?, ?, '[]', ?)`,
      [
        DEFAULT_TENANT_ID,
        attemptId,
        stepId,
        new Date().toISOString(),
        new Date().toISOString(),
        costJson,
      ],
    );

    const res = await app.request("/usage");
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      local: {
        attempts: { total_with_cost: number; parsed: number; invalid: number };
        totals: { duration_ms: number; total_tokens: number; usd_micros: number };
      };
    };

    expect(payload.local.attempts).toEqual({
      total_with_cost: 1,
      parsed: 1,
      invalid: 0,
    });
    expect(payload.local.totals.total_tokens).toBe(50);
    expect(payload.local.totals.duration_ms).toBe(1234);
    expect(payload.local.totals.usd_micros).toBe(987);

    const filtered = await app.request(`/usage?run_id=${encodeURIComponent(runId)}`);
    expect(filtered.status).toBe(200);
    const filteredPayload = (await filtered.json()) as typeof payload;
    expect(filteredPayload.local.attempts.total_with_cost).toBe(1);
    expect(filteredPayload.local.totals.total_tokens).toBe(50);

    const empty = await app.request(`/usage?run_id=missing`);
    expect(empty.status).toBe(200);
    const emptyPayload = (await empty.json()) as typeof payload;
    expect(emptyPayload.local.attempts.total_with_cost).toBe(0);
    expect(emptyPayload.local.totals.total_tokens).toBe(0);

    await container.db.close();
  });

  it("rolls up usage by session key and agent id", async () => {
    const { app, container } = await createTestApp();

    const alphaKey = "agent:alpha:main";
    const alphaSecondaryKey = "agent:alpha:dm:peer-alpha";
    const betaKey = "agent:beta:main";

    await insertAttempt(container, {
      jobId: "job-alpha-1",
      runId: "run-alpha-1",
      stepId: "step-alpha-1",
      attemptId: "attempt-alpha-1",
      key: alphaKey,
      lane: "main",
      totalTokens: 10,
    });

    await insertAttempt(container, {
      jobId: "job-alpha-2",
      runId: "run-alpha-2",
      stepId: "step-alpha-2",
      attemptId: "attempt-alpha-2",
      key: alphaKey,
      lane: "subagent",
      totalTokens: 5,
    });

    await insertAttempt(container, {
      jobId: "job-alpha-3",
      runId: "run-alpha-3",
      stepId: "step-alpha-3",
      attemptId: "attempt-alpha-3",
      key: alphaSecondaryKey,
      lane: "main",
      totalTokens: 7,
    });

    await insertAttempt(container, {
      jobId: "job-beta-1",
      runId: "run-beta-1",
      stepId: "step-beta-1",
      attemptId: "attempt-beta-1",
      key: betaKey,
      lane: "main",
      totalTokens: 3,
    });

    const sessionAlpha = await app.request(`/usage?key=${encodeURIComponent(alphaKey)}`);
    expect(sessionAlpha.status).toBe(200);
    const sessionAlphaPayload = (await sessionAlpha.json()) as {
      scope: { kind: string };
      local: { totals: { total_tokens: number } };
    };
    expect(sessionAlphaPayload.scope.kind).toBe("session");
    expect(sessionAlphaPayload.local.totals.total_tokens).toBe(15);

    const agentAlpha = await app.request(`/usage?agent_key=${encodeURIComponent("alpha")}`);
    expect(agentAlpha.status).toBe(200);
    const agentAlphaPayload = (await agentAlpha.json()) as {
      scope: { kind: string };
      local: { totals: { total_tokens: number } };
    };
    expect(agentAlphaPayload.scope.kind).toBe("agent");
    expect(agentAlphaPayload.local.totals.total_tokens).toBe(22);

    const deployment = await app.request("/usage");
    expect(deployment.status).toBe(200);
    const deploymentPayload = (await deployment.json()) as {
      scope: { kind: string };
      local: { totals: { total_tokens: number } };
    };
    expect(deploymentPayload.scope.kind).toBe("deployment");
    expect(deploymentPayload.local.totals.total_tokens).toBe(25);

    await container.db.close();
  });

  it("treats agent_key rollups as case-sensitive", async () => {
    const { app, container } = await createTestApp();

    await insertAttempt(container, {
      jobId: "job-alpha-lower-1",
      runId: "run-alpha-lower-1",
      stepId: "step-alpha-lower-1",
      attemptId: "attempt-alpha-lower-1",
      key: "agent:alpha:main",
      lane: "main",
      totalTokens: 10,
    });

    await insertAttempt(container, {
      jobId: "job-alpha-upper-1",
      runId: "run-alpha-upper-1",
      stepId: "step-alpha-upper-1",
      attemptId: "attempt-alpha-upper-1",
      key: "agent:Alpha:main",
      lane: "main",
      totalTokens: 100,
    });

    const lower = await app.request(`/usage?agent_key=${encodeURIComponent("alpha")}`);
    expect(lower.status).toBe(200);
    const lowerPayload = (await lower.json()) as { local: { totals: { total_tokens: number } } };
    expect(lowerPayload.local.totals.total_tokens).toBe(10);

    const upper = await app.request(`/usage?agent_key=${encodeURIComponent("Alpha")}`);
    expect(upper.status).toBe(200);
    const upperPayload = (await upper.json()) as { local: { totals: { total_tokens: number } } };
    expect(upperPayload.local.totals.total_tokens).toBe(100);

    await container.db.close();
  });

  it("includes cached provider usage when auth profiles are enabled and a profile is pinned", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ data: { label: "test-key", usage: 123, limit: 456 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    try {
      const { app, authProfileKey, close } = await createPinnedProviderUsageApp({
        authProfileId: "auth-profile-openrouter-1",
        authProfileKey: "profile-openrouter-1",
        sessionId: "session-usage-provider-1",
      });

      const first = await app.request("/usage");
      expect(first.status).toBe(200);
      const firstPayload = (await first.json()) as { provider: unknown };
      expect(firstPayload.provider).toMatchObject({
        status: "ok",
        provider_key: "openrouter",
        auth_profile_key: authProfileKey,
        cached: false,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const second = await app.request("/usage");
      expect(second.status).toBe(200);
      const secondPayload = (await second.json()) as { provider: unknown };
      expect(secondPayload.provider).toMatchObject({
        status: "ok",
        provider_key: "openrouter",
        auth_profile_key: authProfileKey,
        cached: true,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await close();
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it("returns structured provider errors and caches failures", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response("rate limited", {
        status: 429,
        headers: { "content-type": "text/plain" },
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    try {
      const { app, authProfileKey, close } = await createPinnedProviderUsageApp({
        authProfileId: "auth-profile-openrouter-error-1",
        authProfileKey: "profile-openrouter-error-1",
        sessionId: "session-usage-provider-error-1",
      });

      const first = await app.request("/usage");
      expect(first.status).toBe(200);
      const firstPayload = (await first.json()) as { provider: unknown };
      expect(firstPayload.provider).toMatchObject({
        status: "error",
        provider_key: "openrouter",
        auth_profile_key: authProfileKey,
        cached: false,
        error: { code: "provider_http_error" },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const second = await app.request("/usage");
      expect(second.status).toBe(200);
      const secondPayload = (await second.json()) as { provider: unknown };
      expect(secondPayload.provider).toMatchObject({
        status: "error",
        provider_key: "openrouter",
        auth_profile_key: authProfileKey,
        cached: true,
        error: { code: "provider_http_error" },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await close();
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
