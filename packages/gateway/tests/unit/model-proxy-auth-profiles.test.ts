import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModelProxyRoutesFromState } from "../../src/routes/model-proxy.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";
import { SessionProviderPinDal } from "../../src/modules/models/session-pin-dal.js";
import { EnvSecretProvider } from "../../src/modules/secret/provider.js";

describe("model proxy auth profiles", () => {
  let db: SqliteDb;
  let authProfileDal: AuthProfileDal;
  let pinDal: SessionProviderPinDal;
  let secretProvider: EnvSecretProvider;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    db = openTestSqliteDb();
    authProfileDal = new AuthProfileDal(db);
    pinDal = new SessionProviderPinDal(db);
    secretProvider = new EnvSecretProvider();
    originalFetch = globalThis.fetch;
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "1";
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    delete process.env["TYRUM_AUTH_PROFILES_ENABLED"];
    delete process.env["TEST_KEY_1"];
    delete process.env["TEST_KEY_2"];
    await db.close();
  });

  function makeState() {
    const routes = new Map();
    routes.set("test-model", {
      target: "openai",
      baseUrl: "https://upstream.example.com/v1/",
      auth: { kind: "none" as const },
      capabilities: ["chat"],
    });
    return { routes, timeoutMs: 20_000 };
  }

  it("pins and rotates auth profiles on transient failures", async () => {
    process.env["TEST_KEY_1"] = "token-1";
    process.env["TEST_KEY_2"] = "token-2";

    const h1 = await secretProvider.store("TEST_KEY_1", "ignored");
    const h2 = await secretProvider.store("TEST_KEY_2", "ignored");

    const p1 = await authProfileDal.create({
      profileId: "00000000-0000-0000-0000-000000000001",
      agentId: "default",
      provider: "openai",
      type: "api_key",
      secretHandles: { api_key_handle: h1.handle_id },
    });
    const p2 = await authProfileDal.create({
      profileId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      agentId: "default",
      provider: "openai",
      type: "api_key",
      secretHandles: { api_key_handle: h2.handle_id },
    });

    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Headers | undefined;
      const auth = headers?.get("authorization");
      if (auth === "Bearer token-1") {
        return new Response(JSON.stringify({ error: "rate limit" }), {
          status: 429,
          headers: { "content-type": "application/json" },
        });
      }
      if (auth === "Bearer token-2") {
        return new Response(JSON.stringify({ choices: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    const app = createModelProxyRoutesFromState(makeState(), {
      auth: { authProfileDal, pinDal, secretProviderForAgent: async () => secretProvider },
    });

    await db.run(
      "INSERT INTO sessions (session_id, channel, thread_id) VALUES (?, ?, ?)",
      ["session-1", "test", "thread-1"],
    );

    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tyrum-session-id": "session-1",
      },
      body: JSON.stringify({ model: "test-model", messages: [] }),
    });
    expect(res.status).toBe(200);

    const pin = await pinDal.get({ agentId: "default", sessionId: "session-1", provider: "openai" });
    expect(pin?.profile_id).toBe(p2.profile_id);

    const refreshed = await authProfileDal.getById(p1.profile_id);
    expect(typeof refreshed?.cooldown_until_ms).toBe("number");
  });

  it("disables auth profiles on auth errors", async () => {
    process.env["TEST_KEY_1"] = "token-1";
    process.env["TEST_KEY_2"] = "token-2";

    const h1 = await secretProvider.store("TEST_KEY_1", "ignored");
    const h2 = await secretProvider.store("TEST_KEY_2", "ignored");

    const p1 = await authProfileDal.create({
      profileId: "00000000-0000-0000-0000-000000000001",
      agentId: "default",
      provider: "openai",
      type: "api_key",
      secretHandles: { api_key_handle: h1.handle_id },
    });
    const p2 = await authProfileDal.create({
      profileId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      agentId: "default",
      provider: "openai",
      type: "api_key",
      secretHandles: { api_key_handle: h2.handle_id },
    });

    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Headers | undefined;
      const auth = headers?.get("authorization");
      if (auth === "Bearer token-1") {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      if (auth === "Bearer token-2") {
        return new Response(JSON.stringify({ choices: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    const app = createModelProxyRoutesFromState(makeState(), {
      auth: { authProfileDal, pinDal, secretProviderForAgent: async () => secretProvider },
    });

    await db.run(
      "INSERT INTO sessions (session_id, channel, thread_id) VALUES (?, ?, ?)",
      ["session-1", "test", "thread-1"],
    );

    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tyrum-session-id": "session-1",
      },
      body: JSON.stringify({ model: "test-model", messages: [] }),
    });
    expect(res.status).toBe(200);

    const disabled = await authProfileDal.getById(p1.profile_id);
    expect(disabled?.status).toBe("disabled");

    const pin = await pinDal.get({ agentId: "default", sessionId: "session-1", provider: "openai" });
    expect(pin?.profile_id).toBe(p2.profile_id);
  });
});
