import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("../../src/container.js", () => {
  const mockContainer = {
    db: {
      close: async () => {},
    },
    modelsDev: {
      ensureLoaded: async () => ({
        catalog: {},
        status: {
          source: "bundled",
          provider_count: 0,
          model_count: 0,
          last_error: null,
        },
      }),
    },
    oauthProviderRegistry: {
      list: async () => [],
    },
    policyService: {
      getStatus: async () => null,
    },
  };

  return {
    createContainer: () => mockContainer,
    createContainerAsync: async () => mockContainer,
  };
});

describe("tyrum check fetch options", () => {
  const originalEnv = {
    TYRUM_HOME: process.env["TYRUM_HOME"],
    TYRUM_USER_HOME: process.env["TYRUM_USER_HOME"],
    GATEWAY_DB_PATH: process.env["GATEWAY_DB_PATH"],
    GATEWAY_HOST: process.env["GATEWAY_HOST"],
    GATEWAY_PORT: process.env["GATEWAY_PORT"],
    GATEWAY_TOKEN: process.env["GATEWAY_TOKEN"],
  };

  const originalFetch = globalThis.fetch;

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    globalThis.fetch = originalFetch;
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("does not forward timeoutMs into fetch init", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-check-fetch-"));

    process.env["TYRUM_HOME"] = home;
    process.env["TYRUM_USER_HOME"] = home;
    process.env["GATEWAY_DB_PATH"] = ":memory:";
    process.env["GATEWAY_HOST"] = "127.0.0.1";
    process.env["GATEWAY_PORT"] = "8788";
    process.env["GATEWAY_TOKEN"] = "test-token";

    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect((init as Record<string, unknown> | undefined)?.["timeoutMs"]).toBeUndefined();
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const logMock = vi.fn();
    const errorMock = vi.fn();
    const originalLog = console.log;
    const originalError = console.error;
    console.log = logMock as unknown as typeof console.log;
    console.error = errorMock as unknown as typeof console.error;

    try {
      const { runCli } = await import("../../src/index.js");
      const exitCode = await runCli(["check"]);
      expect(exitCode).toBe(0);
      expect(errorMock).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      console.log = originalLog;
      console.error = originalError;
      await rm(home, { recursive: true, force: true });
    }
  });
});
