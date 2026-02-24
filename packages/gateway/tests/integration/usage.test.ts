import { describe, expect, it, vi } from "vitest";
import { createTestApp } from "./helpers.js";

describe("usage routes", () => {
  it("rolls up attempt costs across execution attempts", async () => {
    const { app, container } = await createTestApp();

    const jobId = "job-usage-1";
    const runId = "run-usage-1";
    const stepId = "step-usage-1";
    const attemptId = "attempt-usage-1";

    await container.db.run(
      `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json, input_json, latest_run_id)
       VALUES (?, ?, ?, 'completed', ?, ?, ?)`,
      [jobId, "key-1", "lane-1", "{}", "{}", runId],
    );
    await container.db.run(
      `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt)
       VALUES (?, ?, ?, ?, 'succeeded', 1)`,
      [runId, jobId, "key-1", "lane-1"],
    );
    await container.db.run(
      `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json)
       VALUES (?, ?, 0, 'succeeded', ?)`,
      [stepId, runId, "{}"],
    );

    const costJson = JSON.stringify({
      duration_ms: 1234,
      total_tokens: 50,
      usd_micros: 987,
    });

    await container.db.run(
      `INSERT INTO execution_attempts (
         attempt_id,
         step_id,
         attempt,
         status,
         started_at,
         finished_at,
         artifacts_json,
         cost_json
       ) VALUES (?, ?, 1, 'succeeded', ?, ?, '[]', ?)`,
      [attemptId, stepId, new Date().toISOString(), new Date().toISOString(), costJson],
    );

    const res = await app.request("/usage");
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      local: { attempts: { total_with_cost: number; parsed: number; invalid: number }; totals: { duration_ms: number; total_tokens: number; usd_micros: number } };
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

    const insertAttempt = async (input: {
      jobId: string;
      runId: string;
      stepId: string;
      attemptId: string;
      key: string;
      lane: string;
      totalTokens: number;
    }): Promise<void> => {
      await container.db.run(
        `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json, input_json, latest_run_id)
         VALUES (?, ?, ?, 'completed', ?, ?, ?)`,
        [input.jobId, input.key, input.lane, "{}", "{}", input.runId],
      );
      await container.db.run(
        `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt)
         VALUES (?, ?, ?, ?, 'succeeded', 1)`,
        [input.runId, input.jobId, input.key, input.lane],
      );
      await container.db.run(
        `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json)
         VALUES (?, ?, 0, 'succeeded', ?)`,
        [input.stepId, input.runId, "{}"],
      );

      const costJson = JSON.stringify({
        duration_ms: 1000,
        total_tokens: input.totalTokens,
        usd_micros: input.totalTokens,
      });

      await container.db.run(
        `INSERT INTO execution_attempts (
           attempt_id,
           step_id,
           attempt,
           status,
           started_at,
           finished_at,
           artifacts_json,
           cost_json
         ) VALUES (?, ?, 1, 'succeeded', ?, ?, '[]', ?)`,
        [input.attemptId, input.stepId, new Date().toISOString(), new Date().toISOString(), costJson],
      );
    };

    await insertAttempt({
      jobId: "job-alpha-1",
      runId: "run-alpha-1",
      stepId: "step-alpha-1",
      attemptId: "attempt-alpha-1",
      key: alphaKey,
      lane: "main",
      totalTokens: 10,
    });

    await insertAttempt({
      jobId: "job-alpha-2",
      runId: "run-alpha-2",
      stepId: "step-alpha-2",
      attemptId: "attempt-alpha-2",
      key: alphaKey,
      lane: "subagent",
      totalTokens: 5,
    });

    await insertAttempt({
      jobId: "job-alpha-3",
      runId: "run-alpha-3",
      stepId: "step-alpha-3",
      attemptId: "attempt-alpha-3",
      key: alphaSecondaryKey,
      lane: "main",
      totalTokens: 7,
    });

    await insertAttempt({
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
    const sessionAlphaPayload = (await sessionAlpha.json()) as { scope: { kind: string }; local: { totals: { total_tokens: number } } };
    expect(sessionAlphaPayload.scope.kind).toBe("session");
    expect(sessionAlphaPayload.local.totals.total_tokens).toBe(15);

    const agentAlpha = await app.request(`/usage?agent_id=${encodeURIComponent("alpha")}`);
    expect(agentAlpha.status).toBe(200);
    const agentAlphaPayload = (await agentAlpha.json()) as { scope: { kind: string }; local: { totals: { total_tokens: number } } };
    expect(agentAlphaPayload.scope.kind).toBe("agent");
    expect(agentAlphaPayload.local.totals.total_tokens).toBe(22);

    const deployment = await app.request("/usage");
    expect(deployment.status).toBe(200);
    const deploymentPayload = (await deployment.json()) as { scope: { kind: string }; local: { totals: { total_tokens: number } } };
    expect(deploymentPayload.scope.kind).toBe("deployment");
    expect(deploymentPayload.local.totals.total_tokens).toBe(25);

    await container.db.close();
  });

  it("includes cached provider usage when auth profiles are enabled and a profile is pinned", async () => {
    const prevAuthProfilesEnabled = process.env["TYRUM_AUTH_PROFILES_ENABLED"];
    const prevOpenRouterKey = process.env["OPENROUTER_API_KEY"];
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "1";
    process.env["OPENROUTER_API_KEY"] = "test-openrouter-key";

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ data: { label: "test-key", usage: 123, limit: 456 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    try {
      const { app, container, agents } = await createTestApp();
      expect(agents).toBeDefined();

      const secretProvider = await agents!.getSecretProvider("default");
      const handle = await secretProvider.store("OPENROUTER_API_KEY", "ignored-by-env-provider");

      const profileId = "profile-openrouter-1";
      await container.db.run(
        `INSERT INTO auth_profiles (profile_id, agent_id, provider, type, secret_handles_json)
         VALUES (?, 'default', 'openrouter', 'api_key', ?)`,
        [profileId, JSON.stringify({ api_key_handle: handle.handle_id })],
      );

      const sessionId = "session-usage-provider-1";
      await container.db.run(
        `INSERT INTO sessions (session_id, channel, thread_id)
         VALUES (?, 'test', 'thread-usage-provider-1')`,
        [sessionId],
      );
      await container.db.run(
        `INSERT INTO session_provider_pins (agent_id, session_id, provider, profile_id)
         VALUES ('default', ?, 'openrouter', ?)`,
        [sessionId, profileId],
      );

      const first = await app.request("/usage");
      expect(first.status).toBe(200);
      const firstPayload = (await first.json()) as { provider: unknown };
      expect(firstPayload.provider).toMatchObject({
        status: "ok",
        provider: "openrouter",
        profile_id: profileId,
        cached: false,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const second = await app.request("/usage");
      expect(second.status).toBe(200);
      const secondPayload = (await second.json()) as { provider: unknown };
      expect(secondPayload.provider).toMatchObject({
        status: "ok",
        provider: "openrouter",
        profile_id: profileId,
        cached: true,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await container.db.close();
    } finally {
      process.env["TYRUM_AUTH_PROFILES_ENABLED"] = prevAuthProfilesEnabled;
      process.env["OPENROUTER_API_KEY"] = prevOpenRouterKey;
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it("returns structured provider errors and caches failures", async () => {
    const prevAuthProfilesEnabled = process.env["TYRUM_AUTH_PROFILES_ENABLED"];
    const prevOpenRouterKey = process.env["OPENROUTER_API_KEY"];
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "1";
    process.env["OPENROUTER_API_KEY"] = "test-openrouter-key";

    const fetchMock = vi.fn(async () => {
      return new Response("rate limited", { status: 429, headers: { "content-type": "text/plain" } });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    try {
      const { app, container, agents } = await createTestApp();
      expect(agents).toBeDefined();

      const secretProvider = await agents!.getSecretProvider("default");
      const handle = await secretProvider.store("OPENROUTER_API_KEY", "ignored-by-env-provider");

      const profileId = "profile-openrouter-error-1";
      await container.db.run(
        `INSERT INTO auth_profiles (profile_id, agent_id, provider, type, secret_handles_json)
         VALUES (?, 'default', 'openrouter', 'api_key', ?)`,
        [profileId, JSON.stringify({ api_key_handle: handle.handle_id })],
      );

      const sessionId = "session-usage-provider-error-1";
      await container.db.run(
        `INSERT INTO sessions (session_id, channel, thread_id)
         VALUES (?, 'test', 'thread-usage-provider-error-1')`,
        [sessionId],
      );
      await container.db.run(
        `INSERT INTO session_provider_pins (agent_id, session_id, provider, profile_id)
         VALUES ('default', ?, 'openrouter', ?)`,
        [sessionId, profileId],
      );

      const first = await app.request("/usage");
      expect(first.status).toBe(200);
      const firstPayload = (await first.json()) as { provider: unknown };
      expect(firstPayload.provider).toMatchObject({
        status: "error",
        provider: "openrouter",
        profile_id: profileId,
        cached: false,
        error: { code: "provider_http_error" },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const second = await app.request("/usage");
      expect(second.status).toBe(200);
      const secondPayload = (await second.json()) as { provider: unknown };
      expect(secondPayload.provider).toMatchObject({
        status: "error",
        provider: "openrouter",
        profile_id: profileId,
        cached: true,
        error: { code: "provider_http_error" },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await container.db.close();
    } finally {
      process.env["TYRUM_AUTH_PROFILES_ENABLED"] = prevAuthProfilesEnabled;
      process.env["OPENROUTER_API_KEY"] = prevOpenRouterKey;
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
