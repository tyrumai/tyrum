import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProfileService } from "../../src/modules/auth-profiles/service.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import type { SecretHandle } from "@tyrum/schemas";
import { createModelProxyRoutesFromState } from "../../src/routes/model-proxy.js";

function stubSecretProvider(): SecretProvider & { storeCalls: unknown[] } {
  const values = new Map<string, string>();
  const storeCalls: unknown[] = [];
  let nextId = 0;
  return {
    storeCalls,
    resolve: vi.fn(async (handle: SecretHandle) => values.get(handle.handle_id) ?? null),
    store: vi.fn(async (scope: string, value: string) => {
      const handle: SecretHandle = {
        handle_id: `h-${String(++nextId)}`,
        provider: "file",
        scope,
        created_at: new Date().toISOString(),
      };
      storeCalls.push({ scope, value });
      values.set(handle.handle_id, value);
      return handle;
    }),
    revoke: vi.fn(async (handleId: string) => values.delete(handleId)),
    list: vi.fn(async () => []),
  };
}

describe("AuthProfileService", () => {
  let db: SqliteDb | undefined;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    await db?.close();
    db = undefined;
    globalThis.fetch = originalFetch;
  });

  it("pins a deterministic profile per session and resolves bearer tokens", async () => {
    db = openTestSqliteDb();
    const secrets = stubSecretProvider();
    const service = new AuthProfileService(db, secrets);

    const p1 = await service.create({
      agent_id: "default",
      provider: "openai",
      type: "api_key",
      scope: "OPENAI_KEY_1",
      value: "sk-1",
    });

    const p2 = await service.create({
      agent_id: "default",
      provider: "openai",
      type: "api_key",
      scope: "OPENAI_KEY_2",
      value: "sk-2",
    });

    expect(p1.profile_id).not.toBe(p2.profile_id);

    const first = await service.resolveBearerToken({
      agentId: "default",
      provider: "openai",
      sessionId: "sess-1",
    });
    expect(first?.token).toBe("sk-1");
    expect(first?.profileId).toBe(p1.profile_id);

    const again = await service.resolveBearerToken({
      agentId: "default",
      provider: "openai",
      sessionId: "sess-1",
    });
    expect(again?.token).toBe("sk-1");
    expect(again?.profileId).toBe(p1.profile_id);
  });

  it("integrates with model proxy to apply bearer auth", async () => {
    db = openTestSqliteDb();
    const secrets = stubSecretProvider();
    const service = new AuthProfileService(db, secrets);

    await service.create({
      agent_id: "default",
      provider: "openai",
      type: "api_key",
      scope: "OPENAI_KEY_1",
      value: "sk-test",
    });

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const routes = new Map();
    routes.set("test-model", {
      target: "openai",
      baseUrl: "https://upstream.example.com/v1/",
      auth: { kind: "none" as const },
      capabilities: ["chat"],
      fallbackChain: [],
    });

    const app = createModelProxyRoutesFromState({ routes, timeoutMs: 20_000 }, { authProfileService: service });
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "test-model", messages: [] }),
      headers: {
        "Content-Type": "application/json",
        "x-tyrum-session-id": "sess-2",
        "x-tyrum-agent-id": "default",
      },
    });

    expect(res.status).toBe(200);

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const headers = fetchCall[1].headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer sk-test");
  });

  it("refreshes OAuth access tokens under a lock when expired", async () => {
    db = openTestSqliteDb();
    const secrets = stubSecretProvider();
    const service = new AuthProfileService(db, secrets);

    await service.create({
      agent_id: "default",
      provider: "openai",
      type: "oauth",
      token_url: "https://oauth.example.com/token",
      client_id: "client-123",
      access_token: "at-old",
      refresh_token: "rt-old",
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "at-new", refresh_token: "rt-new", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const selected = await service.resolveBearerToken({
      agentId: "default",
      provider: "openai",
      sessionId: "sess-oauth-1",
    });

    expect(selected?.token).toBe("at-new");
  });
});
