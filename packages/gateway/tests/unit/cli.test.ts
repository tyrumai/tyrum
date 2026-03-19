import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { DeploymentConfig } from "@tyrum/contracts";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

const { mkdirSyncMock } = vi.hoisted(() => ({
  mkdirSyncMock: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: spawnMock,
  };
});

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    mkdirSync: mkdirSyncMock,
  };
});

import {
  applyStartCommandDeploymentOverrides,
  assertSplitRoleUsesPostgres,
  buildStartupDefaultDeploymentConfig,
  parseCliArgs,
  resolveGatewayLogLevel,
  resolveGatewayLogStackTraces,
  resolveSnapshotImportEnabled,
  resolveGatewayUpdateTarget,
  runCli,
} from "../../src/index.js";

function mockChildExit(exitCode: number): EventEmitter {
  const child = new EventEmitter();
  queueMicrotask(() => {
    child.emit("exit", exitCode, null);
  });
  return child;
}

describe("gateway CLI argument parsing", () => {
  it("defaults to start when no args are provided", () => {
    expect(parseCliArgs([])).toEqual({ kind: "start" });
  });

  it("parses update channel flag", () => {
    expect(parseCliArgs(["update", "--channel", "beta"])).toEqual({
      kind: "update",
      channel: "beta",
      version: undefined,
    });
  });

  it("normalizes update version values", () => {
    expect(parseCliArgs(["update", "--version", "v2026.2.18"])).toEqual({
      kind: "update",
      channel: "stable",
      version: "2026.2.18",
    });
  });

  it("rejects unknown commands", () => {
    expect(() => parseCliArgs(["nope"])).toThrow("unknown command 'nope'");
  });

  it("rejects unknown start flags", () => {
    expect(() => parseCliArgs(["--nope"])).toThrow("unknown argument '--nope'");
  });

  it("parses role subcommands", () => {
    expect(parseCliArgs(["edge"])).toEqual({ kind: "start", role: "edge" });
    expect(parseCliArgs(["worker"])).toEqual({ kind: "start", role: "worker" });
    expect(parseCliArgs(["scheduler"])).toEqual({ kind: "start", role: "scheduler" });
  });

  it("parses start flags without an explicit start subcommand", () => {
    expect(parseCliArgs(["--home", "/tmp/home", "--port", "8789"])).toEqual({
      kind: "start",
      home: "/tmp/home",
      port: 8789,
    });
  });

  it("parses boolean start flags", () => {
    expect(
      parseCliArgs([
        "all",
        "--debug",
        "--tls-ready",
        "--tls-self-signed",
        "--allow-insecure-http",
        "--enable-engine-api",
        "--enable-snapshot-import",
        "--trusted-proxies",
        "10.0.0.0/8,192.168.0.0/16",
      ]),
    ).toEqual({
      kind: "start",
      role: "all",
      debug: true,
      tlsReady: true,
      tlsSelfSigned: true,
      allowInsecureHttp: true,
      engineApiEnabled: true,
      snapshotImportEnabled: true,
      trustedProxies: "10.0.0.0/8,192.168.0.0/16",
    });
  });

  it("parses explicit log-level overrides", () => {
    expect(parseCliArgs(["start", "--log-level", "debug"])).toEqual({
      kind: "start",
      logLevel: "debug",
    });
    expect(parseCliArgs(["--log-level", "warn"])).toEqual({
      kind: "start",
      logLevel: "warn",
    });
  });

  it("parses common --home/--db/--migrations-dir flags across commands", () => {
    expect(
      parseCliArgs([
        "start",
        "--home",
        "/tmp/home",
        "--db",
        "/tmp/gateway.db",
        "--migrations-dir",
        "/tmp/migs",
      ]),
    ).toEqual({
      kind: "start",
      home: "/tmp/home",
      db: "/tmp/gateway.db",
      migrationsDir: "/tmp/migs",
    });

    expect(
      parseCliArgs([
        "check",
        "--home",
        "/tmp/home",
        "--db",
        "/tmp/gateway.db",
        "--migrations-dir",
        "/tmp/migs",
      ]),
    ).toEqual({
      kind: "check",
      home: "/tmp/home",
      db: "/tmp/gateway.db",
      migrationsDir: "/tmp/migs",
    });

    expect(
      parseCliArgs([
        "toolrunner",
        "--home",
        "/tmp/home",
        "--db",
        "/tmp/gateway.db",
        "--migrations-dir",
        "/tmp/migs",
        "--payload-b64",
        "aGVsbG8=",
      ]),
    ).toEqual({
      kind: "toolrunner",
      home: "/tmp/home",
      db: "/tmp/gateway.db",
      migrationsDir: "/tmp/migs",
      payloadB64: "aGVsbG8=",
    });
  });

  it("parses check command", () => {
    expect(parseCliArgs(["check"])).toEqual({ kind: "check" });
  });

  it.each([
    { argv: ["start", "--home", ""], message: "--home requires a non-empty value" },
    { argv: ["start", "--db", ""], message: "--db requires a non-empty value" },
    {
      argv: ["start", "--migrations-dir", ""],
      message: "--migrations-dir requires a non-empty value",
    },
    { argv: ["start", "--host", ""], message: "--host requires a non-empty value" },
    {
      argv: ["start", "--trusted-proxies", ""],
      message: "--trusted-proxies requires a non-empty value",
    },
    {
      argv: ["start", "--log-level", "verbose"],
      message: "--log-level must be one of debug|info|warn|error|silent",
    },
    {
      argv: ["toolrunner", "--payload-b64", ""],
      message: "--payload-b64 requires a non-empty value",
    },
    { argv: ["tls", "fingerprint", "--home", ""], message: "--home requires a non-empty value" },
  ])("rejects empty string values for $argv", ({ argv, message }) => {
    expect(() => parseCliArgs(argv)).toThrow(message);
  });

  it("parses default tenant admin token recovery command", () => {
    expect(
      parseCliArgs([
        "tokens",
        "issue-default-tenant-admin",
        "--home",
        "/tmp/home",
        "--db",
        "/tmp/gateway.db",
        "--migrations-dir",
        "/tmp/migs",
      ]),
    ).toEqual({
      kind: "issue_default_tenant_admin_token",
      home: "/tmp/home",
      db: "/tmp/gateway.db",
      migrationsDir: "/tmp/migs",
    });
  });
  it("parses TLS fingerprint command", () => {
    expect(parseCliArgs(["tls", "fingerprint"])).toEqual({ kind: "tls_fingerprint" });
  });
});

describe("snapshot import enablement", () => {
  it("allows explicit env-based opt-in for restore workflows", () => {
    const previous = process.env["TYRUM_SNAPSHOT_IMPORT_ENABLED"];
    process.env["TYRUM_SNAPSHOT_IMPORT_ENABLED"] = "1";

    try {
      expect(resolveSnapshotImportEnabled(undefined)).toBe(true);
      expect(resolveSnapshotImportEnabled(true)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env["TYRUM_SNAPSHOT_IMPORT_ENABLED"];
      else process.env["TYRUM_SNAPSHOT_IMPORT_ENABLED"] = previous;
    }
  });

  it("uses TYRUM_SNAPSHOT_IMPORT_ENABLED only when seeding startup defaults", () => {
    const previous = process.env["TYRUM_SNAPSHOT_IMPORT_ENABLED"];
    process.env["TYRUM_SNAPSHOT_IMPORT_ENABLED"] = "1";

    try {
      expect(buildStartupDefaultDeploymentConfig({}).snapshots.importEnabled).toBe(true);

      const persisted = applyStartCommandDeploymentOverrides(
        DeploymentConfig.parse({ snapshots: { importEnabled: false } }),
        {},
      );
      expect(persisted.snapshots.importEnabled).toBe(false);

      const explicitCli = applyStartCommandDeploymentOverrides(
        DeploymentConfig.parse({ snapshots: { importEnabled: false } }),
        { snapshotImportEnabled: true },
      );
      expect(explicitCli.snapshots.importEnabled).toBe(true);
    } finally {
      if (previous === undefined) delete process.env["TYRUM_SNAPSHOT_IMPORT_ENABLED"];
      else process.env["TYRUM_SNAPSHOT_IMPORT_ENABLED"] = previous;
    }
  });
});

describe("gateway log-level resolution", () => {
  it("prefers explicit CLI log-level overrides", () => {
    expect(resolveGatewayLogLevel({ logLevelOverride: "warn", debugOverride: true })).toBe("warn");
    expect(resolveGatewayLogStackTraces({ logLevelOverride: "warn", debugOverride: true })).toBe(
      undefined,
    );
  });

  it("treats debug mode as a runtime debug logger override", () => {
    expect(resolveGatewayLogLevel({ debugOverride: true })).toBe("debug");
    expect(resolveGatewayLogStackTraces({ debugOverride: true })).toBe(true);
  });

  it("supports env-driven debug logging for embedded launches", () => {
    const previousLevel = process.env["TYRUM_LOG_LEVEL"];
    const previousDebug = process.env["TYRUM_DEBUG"];

    process.env["TYRUM_LOG_LEVEL"] = "error";
    process.env["TYRUM_DEBUG"] = "1";

    try {
      expect(resolveGatewayLogLevel({})).toBe("error");
      expect(resolveGatewayLogStackTraces({})).toBe(undefined);
    } finally {
      if (previousLevel === undefined) delete process.env["TYRUM_LOG_LEVEL"];
      else process.env["TYRUM_LOG_LEVEL"] = previousLevel;

      if (previousDebug === undefined) delete process.env["TYRUM_DEBUG"];
      else process.env["TYRUM_DEBUG"] = previousDebug;
    }
  });
});

describe("startup deployment-config overrides", () => {
  it("seeds remote bootstrap flags into the initial deployment config", () => {
    const config = buildStartupDefaultDeploymentConfig({
      trustedProxies: "10.0.0.0/8,192.168.0.0/16",
      tlsReady: true,
      tlsSelfSigned: true,
      allowInsecureHttp: true,
      engineApiEnabled: true,
    });

    expect(config.server.trustedProxies).toBe("10.0.0.0/8,192.168.0.0/16");
    expect(config.server.tlsReady).toBe(true);
    expect(config.server.tlsSelfSigned).toBe(true);
    expect(config.server.allowInsecureHttp).toBe(true);
    expect(config.execution.engineApiEnabled).toBe(true);
  });

  it("does not overwrite persisted trusted proxies on restart", () => {
    const persisted = applyStartCommandDeploymentOverrides(
      DeploymentConfig.parse({
        server: { trustedProxies: "203.0.113.0/24" },
      }),
      { trustedProxies: "10.0.0.0/8" },
    );
    expect(persisted.server.trustedProxies).toBe("203.0.113.0/24");
  });

  it("fills trusted proxies when the stored deployment config is empty", () => {
    const persisted = applyStartCommandDeploymentOverrides(DeploymentConfig.parse({}), {
      trustedProxies: "10.0.0.0/8",
    });
    expect(persisted.server.trustedProxies).toBe("10.0.0.0/8");
  });

  it("allows tls bootstrap flags to raise persisted server settings", () => {
    const persisted = applyStartCommandDeploymentOverrides(
      DeploymentConfig.parse({
        server: {
          tlsReady: false,
          tlsSelfSigned: false,
          allowInsecureHttp: false,
        },
      }),
      {
        tlsReady: true,
        tlsSelfSigned: true,
        allowInsecureHttp: true,
      },
    );

    expect(persisted.server.tlsReady).toBe(true);
    expect(persisted.server.tlsSelfSigned).toBe(true);
    expect(persisted.server.allowInsecureHttp).toBe(true);
  });
});

describe("gateway CLI update target resolution", () => {
  it("maps channels to npm dist-tags", () => {
    expect(resolveGatewayUpdateTarget("stable")).toBe("latest");
    expect(resolveGatewayUpdateTarget("beta")).toBe("next");
    expect(resolveGatewayUpdateTarget("dev")).toBe("dev");
  });

  it("prefers explicit versions", () => {
    expect(resolveGatewayUpdateTarget("stable", "2026.2.18")).toBe("2026.2.18");
  });
});

describe("gateway CLI runCli", () => {
  it("prints version and exits cleanly", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runCli(["--version"]);
    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("runs npm global install for update command", async () => {
    spawnMock.mockReturnValue(mockChildExit(0));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runCli(["update", "--channel", "beta"]);

    expect(code).toBe(0);
    expect(spawnMock).toHaveBeenCalledWith(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["install", "-g", "@tyrum/gateway@next"],
      { stdio: "inherit" },
    );
    expect(errSpy).not.toHaveBeenCalledWith(expect.stringContaining("failed"));

    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("prints a check failure when database directory creation fails", async () => {
    const prevDbPath = process.env["GATEWAY_DB_PATH"];
    process.env["GATEWAY_DB_PATH"] = "forbidden/gateway.db";

    mkdirSyncMock.mockImplementationOnce(() => {
      throw new Error("permission denied");
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const code = await runCli(["check"]);
      expect(code).toBe(1);
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("check: failed:"));
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unable to create database directory"),
      );
    } finally {
      if (prevDbPath === undefined) delete process.env["GATEWAY_DB_PATH"];
      else process.env["GATEWAY_DB_PATH"] = prevDbPath;

      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it("issues a fresh default tenant admin token", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const code = await runCli(["tokens", "issue-default-tenant-admin", "--db", ":memory:"]);
      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();

      const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("tokens.issue-default-tenant-admin: ok");
      expect(output).toContain("default-tenant-admin: tyrum-token.v1.");
      expect(output).toContain("Keep this token secure.");
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});

describe("gateway split role DB guard", () => {
  it("allows SQLite when running as single-process 'all'", () => {
    expect(() => assertSplitRoleUsesPostgres("all", "gateway.db")).not.toThrow();
  });

  it("rejects SQLite when running as a split role", () => {
    expect(() => assertSplitRoleUsesPostgres("edge", "gateway.db")).toThrow(/requires Postgres/i);
  });

  it("allows Postgres when running as a split role", () => {
    expect(() =>
      assertSplitRoleUsesPostgres("worker", "postgres://user:pass@localhost:5432/db"),
    ).not.toThrow();
  });
});
