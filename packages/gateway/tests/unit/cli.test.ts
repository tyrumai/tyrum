import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return {
    ...actual,
    spawn: spawnMock,
  };
});

import {
  assertSplitRoleUsesPostgres,
  parseCliArgs,
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
    const prev = process.env["TYRUM_ROLE"];
    delete process.env["TYRUM_ROLE"];
    expect(parseCliArgs([])).toEqual({ kind: "start", role: "all" });
    if (typeof prev === "string") {
      process.env["TYRUM_ROLE"] = prev;
    }
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
});

describe("gateway split role DB guard", () => {
  it("allows SQLite when running as single-process 'all'", () => {
    expect(() => assertSplitRoleUsesPostgres("all", "gateway.db")).not.toThrow();
  });

  it("rejects SQLite when running as a split role", () => {
    expect(() => assertSplitRoleUsesPostgres("edge", "gateway.db")).toThrow(
      /requires Postgres/i,
    );
  });

  it("allows Postgres when running as a split role", () => {
    expect(() =>
      assertSplitRoleUsesPostgres("worker", "postgres://user:pass@localhost:5432/db"),
    ).not.toThrow();
  });
});
