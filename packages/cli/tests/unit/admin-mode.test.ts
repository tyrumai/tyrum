import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { httpCtorSpy, httpDeviceTokensIssueSpy, httpSecretsListSpy } = vi.hoisted(() => ({
  httpCtorSpy: vi.fn(),
  httpDeviceTokensIssueSpy: vi.fn(),
  httpSecretsListSpy: vi.fn(),
}));

async function createClientMock() {
  return {
    TyrumHttpClientError: class TyrumHttpClientError extends Error {
      code = "http_error";
      status?: number;
    },
    normalizeFingerprint256: (value: string) => value.trim().toUpperCase(),
    createNodeFileDeviceIdentityStorage: () => ({
      load: vi.fn(),
      save: vi.fn(),
    }),
    TyrumClient: function TyrumClient() {},
    createTyrumHttpClient: (options: unknown) => {
      httpCtorSpy(options);
      return {
        deviceTokens: {
          issue: httpDeviceTokensIssueSpy,
        },
        secrets: {
          list: httpSecretsListSpy,
        },
        policy: {},
        pairings: {},
        presence: {},
        status: {},
        usage: {},
        authProfiles: {},
        authPins: {},
        plugins: {},
        contracts: {},
        models: {},
        agentStatus: {},
        routingConfig: {},
        audit: {},
        context: {},
        artifacts: {},
        health: {},
      };
    },
  };
}

vi.mock("@tyrum/operator-app/node", async () => await createClientMock());
vi.mock("@tyrum/transport-sdk/node", async () => await createClientMock());

describe("@tyrum/cli elevated-mode", () => {
  const prevHome = process.env["TYRUM_HOME"];

  afterEach(() => {
    httpCtorSpy.mockReset();
    httpDeviceTokensIssueSpy.mockReset();
    httpSecretsListSpy.mockReset();

    if (prevHome === undefined) delete process.env["TYRUM_HOME"];
    else process.env["TYRUM_HOME"] = prevHome;
  });

  it("prints inactive status when no elevated mode state exists", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["elevated-mode", "status"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("inactive"));
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("mints an elevated device token and persists elevated mode state", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "base" }, null, 2),
      { mode: 0o600 },
    );

    httpDeviceTokensIssueSpy.mockResolvedValue({
      token_kind: "device",
      token: "elevated-token",
      token_id: "tkn-id",
      device_id: "operator-cli",
      role: "client",
      scopes: [
        "operator.read",
        "operator.write",
        "operator.approvals",
        "operator.pairing",
        "operator.admin",
      ],
      issued_at: "2026-02-27T00:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["elevated-mode", "enter", "--ttl-seconds", "42"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(httpCtorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: "http://127.0.0.1:8788",
          auth: { type: "bearer", token: "base" },
        }),
      );
      expect(httpDeviceTokensIssueSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          device_id: "operator-cli",
          role: "client",
          scopes: [
            "operator.read",
            "operator.write",
            "operator.approvals",
            "operator.pairing",
            "operator.admin",
          ],
          ttl_seconds: 42,
        }),
      );

      const raw = await readFile(join(operatorDir, "elevated-mode.json"), "utf8");
      expect(JSON.parse(raw)).toMatchObject({
        elevatedToken: "elevated-token",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("auto-expires elevated mode state when expired", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "elevated-mode.json"),
      JSON.stringify(
        {
          elevatedToken: "elevated-token",
          expiresAt: "1970-01-01T00:00:00.000Z",
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["elevated-mode", "status"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("inactive"));
      await expect(readFile(join(operatorDir, "elevated-mode.json"), "utf8")).rejects.toMatchObject(
        {
          code: "ENOENT",
        },
      );
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("prints active status with remaining time when elevated mode is active", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });

    const expiresAt = new Date(Date.now() + 90_000).toISOString();
    await writeFile(
      join(operatorDir, "elevated-mode.json"),
      JSON.stringify(
        {
          elevatedToken: "elevated-token",
          expiresAt,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["elevated-mode", "status"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();

      const lines = logSpy.mock.calls.map(([line]) => String(line));
      expect(lines.some((line) => line.includes(`expires_at=${expiresAt}`))).toBe(true);
      expect(lines.some((line) => /remaining=\d+:\d{2}/.test(line))).toBe(true);
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("removes elevated mode state on exit", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "elevated-mode.json"),
      JSON.stringify(
        {
          elevatedToken: "elevated-token",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["elevated-mode", "exit"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      await expect(readFile(join(operatorDir, "elevated-mode.json"), "utf8")).rejects.toMatchObject(
        {
          code: "ENOENT",
        },
      );
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("gates admin-only commands behind Elevated Mode", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "base" }, null, 2),
      { mode: 0o600 },
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["secrets", "list"]);

      expect(code).toBe(1);
      expect(logSpy).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Elevated Mode"));
      expect(httpCtorSpy).not.toHaveBeenCalled();
      expect(httpSecretsListSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("uses elevated token for admin-only commands when Elevated Mode is active", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "base" }, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      join(operatorDir, "elevated-mode.json"),
      JSON.stringify(
        {
          elevatedToken: "elevated-token",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );

    httpSecretsListSpy.mockResolvedValue({ secrets: [] });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["secrets", "list"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(httpCtorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: { type: "bearer", token: "elevated-token" },
        }),
      );
      expect(httpSecretsListSpy).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("supports an explicit --elevated-token escape hatch for admin-only commands", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "base" }, null, 2),
      { mode: 0o600 },
    );

    httpSecretsListSpy.mockResolvedValue({ secrets: [] });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["secrets", "list", "--elevated-token", "override-token"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(httpCtorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: { type: "bearer", token: "override-token" },
        }),
      );
      expect(httpSecretsListSpy).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });
});
