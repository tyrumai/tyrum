import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { DeploymentConfig } from "@tyrum/schemas";

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
    expect(() => parseCliArgs(["nope"])).toThrow("unknown command");
  });

  it("parses role subcommands", () => {
    expect(parseCliArgs(["edge"])).toEqual({ kind: "start", role: "edge" });
    expect(parseCliArgs(["worker"])).toEqual({ kind: "start", role: "worker" });
    expect(parseCliArgs(["scheduler"])).toEqual({ kind: "start", role: "scheduler" });
  });

  it("parses boolean start flags", () => {
    expect(
      parseCliArgs([
        "all",
        "--allow-insecure-http",
        "--enable-engine-api",
        "--enable-snapshot-import",
      ]),
    ).toEqual({
      kind: "start",
      role: "all",
      allowInsecureHttp: true,
      engineApiEnabled: true,
      snapshotImportEnabled: true,
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

  it("parses TLS fingerprint command", () => {
    expect(parseCliArgs(["tls", "fingerprint"])).toEqual({ kind: "tls_fingerprint" });
  });

  it("parses import-home command", () => {
    expect(
      parseCliArgs([
        "import-home",
        "/tmp/source-home",
        "--tenant-id",
        "tenant-1",
        "--home",
        "/tmp/target-home",
        "--db",
        "/tmp/gateway.db",
        "--migrations-dir",
        "/tmp/migrations",
      ]),
    ).toEqual({
      kind: "import_home",
      source_home: "/tmp/source-home",
      tenantId: "tenant-1",
      home: "/tmp/target-home",
      db: "/tmp/gateway.db",
      migrationsDir: "/tmp/migrations",
    });
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
