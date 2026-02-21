import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { createUsageRoutes } from "../../src/routes/usage.js";

describe("usage route: provider polling", () => {
  let db: SqliteDb | undefined;
  let dir: string | undefined;
  let originalFetch: typeof globalThis.fetch;
  const originalPollingEnv = process.env["TYRUM_PROVIDER_USAGE_POLLING"];
  const originalKeyEnv = process.env["TEST_USAGE_KEY"];

  beforeEach(() => {
    db = openTestSqliteDb();
    dir = mkdtempSync(join(tmpdir(), "usage-route-test-"));
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    await db?.close();
    db = undefined;
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
    globalThis.fetch = originalFetch;

    if (originalPollingEnv === undefined) {
      delete process.env["TYRUM_PROVIDER_USAGE_POLLING"];
    } else {
      process.env["TYRUM_PROVIDER_USAGE_POLLING"] = originalPollingEnv;
    }

    if (originalKeyEnv === undefined) {
      delete process.env["TEST_USAGE_KEY"];
    } else {
      process.env["TEST_USAGE_KEY"] = originalKeyEnv;
    }
  });

  it("polls provider usage when enabled and caches results", async () => {
    process.env["TYRUM_PROVIDER_USAGE_POLLING"] = "1";
    process.env["TEST_USAGE_KEY"] = "sk-usage";

    const configPath = join(dir!, "model_gateway.yml");
    writeFileSync(
      configPath,
      `
auth_profiles:
  openai:
    type: bearer
    env: TEST_USAGE_KEY
    usage:
      endpoint: https://usage.example.test/quota
      method: GET
      timeout_ms: 1000
models:
  gpt-4:
    target: openai
    endpoint: https://api.example.test/v1
    auth_profile: openai
`,
    );

    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ remaining: 123 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const app = createUsageRoutes({ db: db!, modelGatewayConfigPath: configPath });

    const first = await app.request("/usage?provider=openai");
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as unknown as {
      provider: { status: string; data?: unknown; cached_at?: string };
    };
    expect(firstBody.provider.status).toBe("ok");
    expect(firstBody.provider.data).toEqual({ remaining: 123 });
    expect(typeof firstBody.provider.cached_at).toBe("string");

    const second = await app.request("/usage?provider=openai");
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as unknown as {
      provider: { status: string; cached_at?: string };
    };
    expect(secondBody.provider.status).toBe("ok");
    expect(secondBody.provider.cached_at).toBe(firstBody.provider.cached_at);

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const init = fetchCall[1] as RequestInit;
    expect(init.method).toBe("GET");
    const headers = init.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer sk-usage");
  });

  it("returns provider status=error on fetch failure (non-fatal)", async () => {
    process.env["TYRUM_PROVIDER_USAGE_POLLING"] = "1";
    process.env["TEST_USAGE_KEY"] = "sk-usage";

    const configPath = join(dir!, "model_gateway.yml");
    writeFileSync(
      configPath,
      `
auth_profiles:
  openai:
    type: bearer
    env: TEST_USAGE_KEY
    usage_endpoint: https://usage.example.test/quota
models:
  gpt-4:
    target: openai
    endpoint: https://api.example.test/v1
    auth_profile: openai
`,
    );

    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const app = createUsageRoutes({ db: db!, modelGatewayConfigPath: configPath });
    const res = await app.request("/usage?provider=openai");
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown as {
      provider: { status: string; error?: string };
    };
    expect(body.provider.status).toBe("error");
    expect(String(body.provider.error)).toContain("network down");
  });
});
