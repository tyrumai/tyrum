import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "../../src/index.js";

describe("@tyrum/cli runCli", () => {
  it("prints help and exits cleanly", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runCli(["--help"]);

    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("mentions Admin Mode requirements for admin-only commands", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runCli(["--help"]);

    expect(code).toBe(0);
    expect(errSpy).not.toHaveBeenCalled();

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("Admin Mode");
    expect(output).toContain("secrets");
    expect(output).toContain("policy");

    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("ignores a leading '--' argument (pnpm passthrough)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runCli(["--", "--help"]);

    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    errSpy.mockRestore();
  });
});

describe("@tyrum/cli config storage", () => {
  const prevHome = process.env["TYRUM_HOME"];

  afterEach(() => {
    if (prevHome === undefined) delete process.env["TYRUM_HOME"];
    else process.env["TYRUM_HOME"] = prevHome;
  });

  it("prints help for `config show --help`", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runCli(["config", "show", "--help"]);

    expect(code).toBe(0);
    expect(errSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Usage:"));

    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("persists gateway URL + auth token under TYRUM_HOME", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const code = await runCli([
        "config",
        "set",
        "--gateway-url",
        "http://127.0.0.1:8788",
        "--token",
        "super-secret-token",
      ]);
      expect(code).toBe(0);

      const raw = await readFile(join(home, "operator", "config.json"), "utf8");
      expect(JSON.parse(raw)).toEqual({
        gateway_url: "http://127.0.0.1:8788",
        auth_token: "super-secret-token",
      });
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("@tyrum/cli device identity storage", () => {
  const prevHome = process.env["TYRUM_HOME"];

  afterEach(() => {
    if (prevHome === undefined) delete process.env["TYRUM_HOME"];
    else process.env["TYRUM_HOME"] = prevHome;
  });

  it("does not create a device identity for `identity show` when missing", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const code = await runCli(["identity", "show"]);
      expect(code).toBe(1);
      expect(errSpy).toHaveBeenCalled();
      await expect(
        readFile(join(home, "operator", "device-identity.json"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("creates a device identity file under TYRUM_HOME", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const code = await runCli(["identity", "init"]);
      expect(code).toBe(0);

      const raw = await readFile(join(home, "operator", "device-identity.json"), "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(typeof parsed.deviceId).toBe("string");
      expect(typeof parsed.publicKey).toBe("string");
      expect(typeof parsed.privateKey).toBe("string");
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });
});
