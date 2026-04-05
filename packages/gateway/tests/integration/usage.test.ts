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
  turnId: string;
  key: string;
  totalTokens: number;
  durationMs?: number;
  usdMicros?: number;
};
type WorkflowRunUsageSeed = {
  workflowRunId: string;
  workflowRunStepId: string;
  key: string;
  totalTokens: number;
  durationMs?: number;
  usdMicros?: number;
};
type PinnedProviderUsageApp = {
  app: UsageApp["app"];
  authProfileKey: string;
  close: () => Promise<void>;
};

function buildCost(input: { totalTokens: number; durationMs?: number; usdMicros?: number }): {
  duration_ms: number;
  total_tokens: number;
  usd_micros: number;
} {
  return {
    duration_ms: input.durationMs ?? 1000,
    total_tokens: input.totalTokens,
    usd_micros: input.usdMicros ?? input.totalTokens,
  };
}

async function insertTurnUsage(container: UsageContainer, input: AttemptSeed): Promise<void> {
  await container.db.run(
    `INSERT INTO turn_jobs (
       tenant_id,
       job_id,
       agent_id,
       workspace_id,
       conversation_key,
       status,
       trigger_json,
       input_json,
       latest_turn_id
     )
     VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
    [
      DEFAULT_TENANT_ID,
      input.jobId,
      DEFAULT_AGENT_ID,
      DEFAULT_WORKSPACE_ID,
      input.key,
      "{}",
      "{}",
      input.turnId,
    ],
  );
  await container.db.run(
    `INSERT INTO turns (tenant_id, turn_id, job_id, conversation_key, status, attempt)
     VALUES (?, ?, ?, ?, 'succeeded', 1)`,
    [DEFAULT_TENANT_ID, input.turnId, input.jobId, input.key],
  );

  const createdAt = new Date().toISOString();
  const payloadJson = JSON.stringify({
    message: {
      id: `assistant-${input.turnId}`,
      role: "assistant",
      parts: [{ type: "text", text: `usage for ${input.turnId}` }],
      metadata: {
        created_at: createdAt,
        tyrum_usage: buildCost(input),
      },
    },
  });

  await container.db.run(
    `INSERT INTO turn_items (
       tenant_id,
       turn_item_id,
       turn_id,
       item_index,
       item_key,
       kind,
       payload_json,
       created_at
     ) VALUES (?, ?, ?, 0, ?, 'message', ?, ?)`,
    [
      DEFAULT_TENANT_ID,
      `turn-item-${input.turnId}`,
      input.turnId,
      `message:${input.turnId}`,
      payloadJson,
      createdAt,
    ],
  );
}

async function insertWorkflowRunUsage(
  container: UsageContainer,
  input: WorkflowRunUsageSeed,
): Promise<void> {
  const createdAt = new Date().toISOString();

  await container.db.run(
    `INSERT INTO workflow_runs (
       workflow_run_id,
       tenant_id,
       agent_id,
       workspace_id,
       run_key,
       conversation_key,
       status,
       trigger_json,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'succeeded', ?, ?, ?)`,
    [
      input.workflowRunId,
      DEFAULT_TENANT_ID,
      DEFAULT_AGENT_ID,
      DEFAULT_WORKSPACE_ID,
      input.key,
      input.key,
      "{}",
      createdAt,
      createdAt,
    ],
  );

  await container.db.run(
    `INSERT INTO workflow_run_steps (
       tenant_id,
       workflow_run_step_id,
       workflow_run_id,
       step_index,
       status,
       action_json,
       created_at,
       updated_at,
       cost_json
     ) VALUES (?, ?, ?, 0, 'succeeded', ?, ?, ?, ?)`,
    [
      DEFAULT_TENANT_ID,
      input.workflowRunStepId,
      input.workflowRunId,
      "{}",
      createdAt,
      createdAt,
      JSON.stringify(buildCost(input)),
    ],
  );
}

async function createPinnedProviderUsageApp(input: {
  authProfileId: string;
  authProfileKey: string;
  conversationId: string;
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

  const channelAccountId = `channel-account-${input.conversationId}`;
  const channelThreadId = `channel-thread-${input.conversationId}`;
  await container.db.run(
    `INSERT INTO channel_accounts (
       tenant_id,
       workspace_id,
       channel_account_id,
       connector_key,
       account_key
     ) VALUES (?, ?, ?, 'test', ?)`,
    [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, channelAccountId, `account:${input.conversationId}`],
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
      `thread:${input.conversationId}`,
    ],
  );
  await container.db.run(
    `INSERT INTO conversations (
       tenant_id,
       conversation_id,
       conversation_key,
       agent_id,
       workspace_id,
       channel_thread_id,
       title,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)`,
    [
      DEFAULT_TENANT_ID,
      input.conversationId,
      `agent:default:test:${input.conversationId}`,
      DEFAULT_AGENT_ID,
      DEFAULT_WORKSPACE_ID,
      channelThreadId,
      "2026-03-08T00:00:00.000Z",
      "2026-03-08T00:00:00.000Z",
    ],
  );
  await container.db.run(
    `INSERT INTO conversation_provider_pins (tenant_id, conversation_id, provider_key, auth_profile_id)
     VALUES (?, ?, 'openrouter', ?)`,
    [DEFAULT_TENANT_ID, input.conversationId, input.authProfileId],
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
  it("rolls up conversational turn usage from turn_items", async () => {
    const { app, container } = await createTestApp();

    const turnId = "run-usage-1";
    await insertTurnUsage(container, {
      jobId: "job-usage-1",
      turnId,
      key: "key-1",
      totalTokens: 50,
      durationMs: 1234,
      usdMicros: 987,
    });

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

    const filtered = await app.request(`/usage?turn_id=${encodeURIComponent(turnId)}`);
    expect(filtered.status).toBe(200);
    const filteredPayload = (await filtered.json()) as typeof payload & {
      scope: { kind: string; turn_id: string | null };
    };
    expect(filteredPayload.local.attempts.total_with_cost).toBe(1);
    expect(filteredPayload.local.totals.total_tokens).toBe(50);
    expect(filteredPayload.scope.kind).toBe("turn");
    expect(filteredPayload.scope.turn_id).toBe(turnId);

    const empty = await app.request(`/usage?turn_id=missing`);
    expect(empty.status).toBe(200);
    const emptyPayload = (await empty.json()) as typeof payload & {
      scope: { kind: string; turn_id: string | null };
    };
    expect(emptyPayload.local.attempts.total_with_cost).toBe(0);
    expect(emptyPayload.local.totals.total_tokens).toBe(0);
    expect(emptyPayload.scope.kind).toBe("turn");
    expect(emptyPayload.scope.turn_id).toBe("missing");

    await container.db.close();
  });

  it("rolls up usage by conversation key and agent id", async () => {
    const { app, container } = await createTestApp();

    const alphaKey = "agent:alpha:main";
    const alphaSecondaryKey = "agent:alpha:dm:peer-alpha";
    const betaKey = "agent:beta:main";

    await insertTurnUsage(container, {
      jobId: "job-alpha-1",
      turnId: "run-alpha-1",
      key: alphaKey,
      totalTokens: 10,
    });

    await insertTurnUsage(container, {
      jobId: "job-alpha-2",
      turnId: "run-alpha-2",
      key: alphaKey,
      totalTokens: 5,
    });

    await insertWorkflowRunUsage(container, {
      workflowRunId: "workflow-alpha-3",
      workflowRunStepId: "workflow-step-alpha-3",
      key: alphaSecondaryKey,
      totalTokens: 7,
    });

    await insertWorkflowRunUsage(container, {
      workflowRunId: "workflow-beta-1",
      workflowRunStepId: "workflow-step-beta-1",
      key: betaKey,
      totalTokens: 3,
    });

    const conversationAlpha = await app.request(`/usage?key=${encodeURIComponent(alphaKey)}`);
    expect(conversationAlpha.status).toBe(200);
    const conversationAlphaPayload = (await conversationAlpha.json()) as {
      scope: { kind: string };
      local: { totals: { total_tokens: number } };
    };
    expect(conversationAlphaPayload.scope.kind).toBe("conversation");
    expect(conversationAlphaPayload.local.totals.total_tokens).toBe(15);

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

    await insertTurnUsage(container, {
      jobId: "job-alpha-lower-1",
      turnId: "run-alpha-lower-1",
      key: "agent:alpha:main",
      totalTokens: 10,
    });

    await insertWorkflowRunUsage(container, {
      workflowRunId: "workflow-alpha-upper-1",
      workflowRunStepId: "workflow-step-alpha-upper-1",
      key: "agent:Alpha:main",
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
        conversationId: "conversation-usage-provider-1",
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
        conversationId: "conversation-usage-provider-error-1",
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
