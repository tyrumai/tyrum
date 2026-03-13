import { afterEach, describe, expect, it, vi } from "vitest";
import { rm, mkdtemp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { pathExists } from "../helpers/path-exists.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

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

describe("tyrum check side effects", () => {
  const originalEnv = {
    GATEWAY_PORT: process.env["GATEWAY_PORT"],
    GATEWAY_TOKEN: process.env["GATEWAY_TOKEN"],
  };
  const originalLog = console.log;
  const originalError = console.error;

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    console.log = originalLog;
    console.error = originalError;
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("does not create .admin-token when missing", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-check-"));
    const tokenPath = join(home, ".admin-token");

    process.env["GATEWAY_PORT"] = "invalid";
    delete process.env["GATEWAY_TOKEN"];

    const logMock = vi.fn();
    const errorMock = vi.fn();
    console.log = logMock as unknown as typeof console.log;
    console.error = errorMock as unknown as typeof console.error;

    try {
      expect(await pathExists(tokenPath)).toBe(false);
      const { runCli } = await import("../../src/index.js");
      const exitCode = await runCli(["check", "--migrations-dir", migrationsDir]);
      if (exitCode !== 0) {
        const errors = errorMock.mock.calls.map((args) => args.join(" ")).join("\n");
        const logs = logMock.mock.calls.map((args) => args.join(" ")).join("\n");
        throw new Error(`check failed with ${exitCode}\nerrors:\n${errors}\nlogs:\n${logs}`);
      }
      expect(exitCode).toBe(0);
      expect(await pathExists(tokenPath)).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 15_000);
});
