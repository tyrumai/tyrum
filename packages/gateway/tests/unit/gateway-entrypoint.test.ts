import { describe, expect, it } from "vitest";

describe("gateway entrypoint (src/index.ts)", () => {
  it("can be imported without auto-starting the server", async () => {
    const originalArgv1 = process.argv[1];
    process.argv[1] = "/vitest";
    try {
      const mod = await import("../../src/index.js");

      expect(mod.VERSION).toBeTypeOf("string");
      expect(mod.createApp).toBeTypeOf("function");
      expect(mod.createContainer).toBeTypeOf("function");
      expect(mod.ConnectionManager).toBeTypeOf("function");
    } finally {
      process.argv[1] = originalArgv1;
    }
  }, 15_000);
});

describe("parseCliArgs", () => {
  // Import lazily to avoid triggering the isMain guard
  const importMod = async () => {
    const originalArgv1 = process.argv[1];
    process.argv[1] = "/vitest";
    try {
      return await import("../../src/index.js");
    } finally {
      process.argv[1] = originalArgv1;
    }
  };

  it("returns start/all for empty argv", async () => {
    const { parseCliArgs } = await importMod();
    expect(parseCliArgs([])).toEqual({ kind: "start", role: "all" });
  });

  it("returns help for --help", async () => {
    const { parseCliArgs } = await importMod();
    expect(parseCliArgs(["--help"])).toEqual({ kind: "help" });
  });

  it("returns version for -v", async () => {
    const { parseCliArgs } = await importMod();
    expect(parseCliArgs(["-v"])).toEqual({ kind: "version" });
  });

  it("returns start/edge for 'edge'", async () => {
    const { parseCliArgs } = await importMod();
    expect(parseCliArgs(["edge"])).toEqual({ kind: "start", role: "edge" });
  });

  it("returns start/worker for 'worker'", async () => {
    const { parseCliArgs } = await importMod();
    expect(parseCliArgs(["worker"])).toEqual({ kind: "start", role: "worker" });
  });

  it("returns toolrunner for 'toolrunner'", async () => {
    const { parseCliArgs } = await importMod();
    expect(parseCliArgs(["toolrunner"])).toEqual({ kind: "toolrunner" });
  });

  it("returns update with defaults for 'update'", async () => {
    const { parseCliArgs } = await importMod();
    expect(parseCliArgs(["update"])).toEqual({
      kind: "update",
      channel: "stable",
      version: undefined,
    });
  });

  it("returns update with beta channel", async () => {
    const { parseCliArgs } = await importMod();
    expect(parseCliArgs(["update", "--channel", "beta"])).toEqual({
      kind: "update",
      channel: "beta",
      version: undefined,
    });
  });

  it("returns update with explicit version", async () => {
    const { parseCliArgs } = await importMod();
    const result = parseCliArgs(["update", "--version", "1.0.0"]);
    expect(result).toEqual({
      kind: "update",
      channel: "stable",
      version: "1.0.0",
    });
  });

  it("throws for unknown command", async () => {
    const { parseCliArgs } = await importMod();
    expect(() => parseCliArgs(["unknown"])).toThrow("unknown command");
  });
});

describe("assertSplitRoleUsesPostgres", () => {
  const importMod = async () => {
    const originalArgv1 = process.argv[1];
    process.argv[1] = "/vitest";
    try {
      return await import("../../src/index.js");
    } finally {
      process.argv[1] = originalArgv1;
    }
  };

  it("does not throw for role 'all' with SQLite", async () => {
    const { assertSplitRoleUsesPostgres } = await importMod();
    expect(() => assertSplitRoleUsesPostgres("all", "test.db")).not.toThrow();
  });

  it("throws for role 'edge' with non-postgres path", async () => {
    const { assertSplitRoleUsesPostgres } = await importMod();
    expect(() => assertSplitRoleUsesPostgres("edge", "test.db")).toThrow(
      "requires Postgres",
    );
  });

  it("does not throw for role 'edge' with postgres URI", async () => {
    const { assertSplitRoleUsesPostgres } = await importMod();
    expect(() =>
      assertSplitRoleUsesPostgres("edge", "postgres://localhost/db"),
    ).not.toThrow();
  });
});

describe("ensureDatabaseDirectory", () => {
  const importMod = async () => {
    const originalArgv1 = process.argv[1];
    process.argv[1] = "/vitest";
    try {
      return await import("../../src/index.js");
    } finally {
      process.argv[1] = originalArgv1;
    }
  };

  it("does not throw for :memory:", async () => {
    const { ensureDatabaseDirectory } = await importMod();
    expect(() => ensureDatabaseDirectory(":memory:")).not.toThrow();
  });

  it("does not throw for empty string", async () => {
    const { ensureDatabaseDirectory } = await importMod();
    expect(() => ensureDatabaseDirectory("")).not.toThrow();
  });
});

describe("resolveGatewayUpdateTarget", () => {
  const importMod = async () => {
    const originalArgv1 = process.argv[1];
    process.argv[1] = "/vitest";
    try {
      return await import("../../src/index.js");
    } finally {
      process.argv[1] = originalArgv1;
    }
  };

  it("returns 'latest' for stable channel", async () => {
    const { resolveGatewayUpdateTarget } = await importMod();
    expect(resolveGatewayUpdateTarget("stable")).toBe("latest");
  });

  it("returns 'next' for beta channel", async () => {
    const { resolveGatewayUpdateTarget } = await importMod();
    expect(resolveGatewayUpdateTarget("beta")).toBe("next");
  });

  it("returns explicit version when provided", async () => {
    const { resolveGatewayUpdateTarget } = await importMod();
    expect(resolveGatewayUpdateTarget("stable", "1.0.0")).toBe("1.0.0");
  });
});

describe("runShutdownCleanup", () => {
  const importMod = async () => {
    const originalArgv1 = process.argv[1];
    process.argv[1] = "/vitest";
    try {
      return await import("../../src/index.js");
    } finally {
      process.argv[1] = originalArgv1;
    }
  };

  it("resolves with empty tasks", async () => {
    const { runShutdownCleanup } = await importMod();
    await expect(
      runShutdownCleanup([], async () => {}),
    ).resolves.toBeUndefined();
  });
});
