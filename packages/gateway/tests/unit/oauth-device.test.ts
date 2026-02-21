import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { createOAuthRoutes } from "../../src/routes/oauth.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import type { SecretHandle } from "@tyrum/schemas";

function stubSecretProvider(): SecretProvider {
  const values = new Map<string, string>();
  let nextId = 0;
  return {
    resolve: vi.fn(async (handle: SecretHandle) => values.get(handle.handle_id) ?? null),
    store: vi.fn(async (scope: string, value: string) => {
      const handle: SecretHandle = {
        handle_id: `h-${String(++nextId)}`,
        provider: "file",
        scope,
        created_at: new Date().toISOString(),
      };
      values.set(handle.handle_id, value);
      return handle;
    }),
    revoke: vi.fn(async (handleId: string) => values.delete(handleId)),
    list: vi.fn(async () => []),
  };
}

describe("OAuth device-code routes", () => {
  let db: SqliteDb | undefined;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await db?.close();
    db = undefined;
  });

  it("starts and completes a device-code login without returning raw tokens", async () => {
    db = openTestSqliteDb();
    const secretProvider = stubSecretProvider();
    const app = createOAuthRoutes({ db, secretProvider });

    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes("/device")) {
        return new Response(
          JSON.stringify({
            device_code: "dev-code",
            user_code: "user-code",
            verification_uri: "https://example.com/verify",
            expires_in: 600,
            interval: 1,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          access_token: "at-secret",
          refresh_token: "rt-secret",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const startRes = await app.request("/auth/oauth/device/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_authorization_url: "https://oauth.example.com/device",
        token_url: "https://oauth.example.com/token",
        client_id: "client-123",
        scope: "offline_access",
      }),
    });
    expect(startRes.status).toBe(200);

    const startBody = (await startRes.json()) as Record<string, unknown>;
    expect(startBody["ok"]).toBe(true);
    expect(startBody["device_code"]).toBe("dev-code");

    const completeRes = await app.request("/auth/oauth/device/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: "default",
        provider: "openai",
        token_url: "https://oauth.example.com/token",
        client_id: "client-123",
        device_code: "dev-code",
      }),
    });
    expect(completeRes.status).toBe(201);
    const completeText = await completeRes.text();

    expect(completeText).not.toContain("at-secret");
    expect(completeText).not.toContain("rt-secret");
  });
});

