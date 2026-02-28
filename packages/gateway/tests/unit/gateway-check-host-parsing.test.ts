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

describe("tyrum check host parsing", () => {
  const originalEnv = {
    TYRUM_HOME: process.env["TYRUM_HOME"],
    TYRUM_USER_HOME: process.env["TYRUM_USER_HOME"],
    GATEWAY_DB_PATH: process.env["GATEWAY_DB_PATH"],
    GATEWAY_HOST: process.env["GATEWAY_HOST"],
    GATEWAY_PORT: process.env["GATEWAY_PORT"],
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("detects unbracketed IPv6 host:port and skips live probe", { timeout: 15_000 }, async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-check-host-"));

    process.env["TYRUM_HOME"] = home;
    process.env["TYRUM_USER_HOME"] = home;
    process.env["GATEWAY_DB_PATH"] = ":memory:";
    process.env["GATEWAY_HOST"] = "::1:8788";
    process.env["GATEWAY_PORT"] = "8788";

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

      const logs = logMock.mock.calls.map((args) => args.join(" "));
      const staticExposure = logs.find((line) => line.startsWith("static.exposure:"));
      expect(staticExposure).toContain("is_exposed=false");

      const liveHttp = logs.find((line) => line.startsWith("live.http:"));
      expect(liveHttp).toContain("skipped=host_includes_port");
    } finally {
      console.log = originalLog;
      console.error = originalError;
      await rm(home, { recursive: true, force: true });
    }
  });
});
