import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const {
  clientCtorSpy,
  clientConnectSpy,
  clientDisconnectSpy,
  autoExecuteSpy,
  createStorageSpy,
  loadOrCreateSpy,
  formatDeviceIdentityErrorSpy,
  providerCtorSpy,
  backendCtorSpy,
} = vi.hoisted(() => ({
  clientCtorSpy: vi.fn(),
  clientConnectSpy: vi.fn(),
  clientDisconnectSpy: vi.fn(),
  autoExecuteSpy: vi.fn(),
  createStorageSpy: vi.fn((identityPath: string) => ({ identityPath })),
  loadOrCreateSpy: vi.fn(async () => ({
    publicKey: "test-public-key",
    privateKey: "test-private-key",
    deviceId: "device-123",
  })),
  formatDeviceIdentityErrorSpy: vi.fn(() => "mock identity error"),
  providerCtorSpy: vi.fn(),
  backendCtorSpy: vi.fn(),
}));

vi.mock("@tyrum/client/node", () => {
  class TyrumClient {
    private readonly handlers = new Map<string, Set<(data: unknown) => void>>();

    constructor(opts: unknown) {
      clientCtorSpy(opts);
    }

    on(event: string, handler: (data: unknown) => void): void {
      const set = this.handlers.get(event) ?? new Set();
      set.add(handler);
      this.handlers.set(event, set);
    }

    private emit(event: string, data: unknown): void {
      for (const handler of this.handlers.get(event) ?? []) {
        handler(data);
      }
    }

    connect(): void {
      clientConnectSpy();
      queueMicrotask(() => this.emit("connected", {}));
      queueMicrotask(() =>
        this.emit("pairing.approved", { payload: { scoped_token: "scoped-1" } }),
      );
      queueMicrotask(() => this.emit("pairing.approved", { payload: {} }));
      queueMicrotask(() => this.emit("transport_error", { message: "mock transport error" }));
      queueMicrotask(() => this.emit("error", { payload: { message: "mock gateway error" } }));
      queueMicrotask(() => this.emit("disconnected", { code: 1006, reason: "mock disconnect" }));
    }

    disconnect(): void {
      clientDisconnectSpy();
    }
  }

  return {
    TyrumClient,
    autoExecute: (...args: unknown[]) => autoExecuteSpy(...args),
    createNodeFileDeviceIdentityStorage: (identityPath: string) => createStorageSpy(identityPath),
    loadOrCreateDeviceIdentity: (...args: unknown[]) => loadOrCreateSpy(...args),
    formatDeviceIdentityError: (...args: unknown[]) => formatDeviceIdentityErrorSpy(...args),
  };
});

vi.mock("../src/providers/desktop-provider.js", () => ({
  DesktopProvider: class DesktopProvider {
    constructor(...args: unknown[]) {
      providerCtorSpy(...args);
    }
  },
}));

vi.mock("../src/providers/backends/nutjs-desktop-backend.js", () => ({
  NutJsDesktopBackend: class NutJsDesktopBackend {
    constructor() {
      backendCtorSpy();
    }
  },
}));

describe("runCli", () => {
  async function runWithSigterm(promise: Promise<number>): Promise<number> {
    const interval = setInterval(() => process.emit("SIGTERM"), 10);
    try {
      return await promise;
    } finally {
      clearInterval(interval);
    }
  }

  const prevEnv = {
    TYRUM_HOME: process.env["TYRUM_HOME"],
    TYRUM_GATEWAY_WS_URL: process.env["TYRUM_GATEWAY_WS_URL"],
    TYRUM_GATEWAY_TOKEN: process.env["TYRUM_GATEWAY_TOKEN"],
    GATEWAY_TOKEN: process.env["GATEWAY_TOKEN"],
    TYRUM_GATEWAY_TOKEN_PATH: process.env["TYRUM_GATEWAY_TOKEN_PATH"],
    GATEWAY_TOKEN_PATH: process.env["GATEWAY_TOKEN_PATH"],
    TYRUM_NODE_LABEL: process.env["TYRUM_NODE_LABEL"],
    TYRUM_NODE_MODE: process.env["TYRUM_NODE_MODE"],
    TYRUM_TAKEOVER_URL: process.env["TYRUM_TAKEOVER_URL"],
    TYRUM_DESKTOP_SANDBOX_TAKEOVER_URL: process.env["TYRUM_DESKTOP_SANDBOX_TAKEOVER_URL"],
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(prevEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("prints help and returns 0 for --help", async () => {
    vi.resetModules();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { runCli } = await import("../src/cli/run-cli.js");
    const code = await runCli(["--help"]);

    expect(code).toBe(0);
    expect(String(logSpy.mock.calls[0]?.[0] ?? "")).toContain("tyrum-desktop-node");
  });

  it("prints version and returns 0 for --version", async () => {
    vi.resetModules();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { runCli, VERSION } = await import("../src/cli/run-cli.js");
    const code = await runCli(["--version"]);

    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(VERSION);
  });

  it("prints error + help and returns 1 for invalid argv", async () => {
    vi.resetModules();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { runCli } = await import("../src/cli/run-cli.js");
    const code = await runCli(["--nope"]);

    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith("error: unknown argument: --nope");
    expect(String(logSpy.mock.calls[0]?.[0] ?? "")).toContain("tyrum-desktop-node");
  });

  it("resolves defaults and exits cleanly on SIGTERM", async () => {
    vi.resetModules();
    delete process.env["TYRUM_HOME"];
    delete process.env["TYRUM_GATEWAY_WS_URL"];

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { runCli, VERSION } = await import("../src/cli/run-cli.js");

    const code = await runWithSigterm(
      runCli([
        "--token",
        " test-token ",
        "--label",
        "my takeover: label",
        "--takeover-url",
        "http://localhost:6080/vnc.html?autoconnect=true",
        "--mode",
        " desktop-sandbox ",
      ]),
    );

    expect(code).toBe(0);
    expect(clientCtorSpy).toHaveBeenCalledTimes(1);
    expect(clientConnectSpy).toHaveBeenCalledTimes(1);
    expect(clientDisconnectSpy).toHaveBeenCalledTimes(1);
    expect(autoExecuteSpy).toHaveBeenCalledTimes(1);
    expect(backendCtorSpy).toHaveBeenCalledTimes(1);
    expect(providerCtorSpy).toHaveBeenCalledTimes(1);

    const providerArgs = providerCtorSpy.mock.calls[0] ?? [];
    expect(typeof (providerArgs[3] as any)?.recognize).toBe("function");

    const opts = clientCtorSpy.mock.calls[0]?.[0] as any;
    expect(opts.url).toBe("ws://127.0.0.1:8788/ws");
    expect(opts.token).toBe("test-token");
    expect(opts.device.label).toBe(
      "my takeover: label (takeover: http://localhost:6080/vnc.html?autoconnect=true)",
    );
    expect(opts.device.mode).toBe("desktop-sandbox");
    expect(opts.device.version).toBe(VERSION);

    expect(createStorageSpy).toHaveBeenCalledWith(
      join(homedir(), ".tyrum", "desktop-node", "device-identity.json"),
    );

    expect(logSpy.mock.calls.map((call) => String(call[0]))).toContain(
      "desktop-node: pairing approved (scoped token issued)",
    );
    expect(logSpy.mock.calls.map((call) => String(call[0]))).toContain(
      "desktop-node: pairing approved",
    );
    expect(logSpy.mock.calls.map((call) => String(call[0]))).toContain(
      "desktop-node: connected device_id=device-123 takeover=http://localhost:6080/vnc.html?autoconnect=true",
    );

    expect(errorSpy.mock.calls.map((call) => String(call[0]))).toContain(
      "desktop-node: transport_error: mock transport error",
    );
    expect(errorSpy.mock.calls.map((call) => String(call[0]))).toContain(
      "desktop-node: gateway_error: mock gateway error",
    );
  });

  it("resolves home/ws/token/label/mode from env", async () => {
    vi.resetModules();
    const tempHome = await mkdtemp(join(tmpdir(), "tyrum-desktop-node-"));
    process.env["TYRUM_HOME"] = tempHome;
    process.env["TYRUM_GATEWAY_WS_URL"] = " ws://example.com/ws ";
    process.env["GATEWAY_TOKEN"] = " env-token ";
    process.env["TYRUM_NODE_LABEL"] = " env label ";
    process.env["TYRUM_NODE_MODE"] = " env-mode ";

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const { runCli } = await import("../src/cli/run-cli.js");
      const code = await runWithSigterm(runCli([]));

      expect(code).toBe(0);
      expect(clientCtorSpy).toHaveBeenCalledTimes(1);
      const opts = clientCtorSpy.mock.calls[0]?.[0] as any;
      expect(opts.url).toBe("ws://example.com/ws");
      expect(opts.token).toBe("env-token");
      expect(opts.device.label).toBe("env label");
      expect(opts.device.mode).toBe("env-mode");
      expect(createStorageSpy).toHaveBeenCalledWith(
        join(tempHome, "desktop-node", "device-identity.json"),
      );
    } finally {
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("loads gateway token from env token path file", async () => {
    vi.resetModules();
    delete process.env["TYRUM_GATEWAY_TOKEN"];
    delete process.env["GATEWAY_TOKEN"];

    const tempDir = await mkdtemp(join(tmpdir(), "tyrum-desktop-node-token-"));
    const tokenPath = join(tempDir, "token.txt");
    await writeFile(tokenPath, "file-token\n", "utf8");
    process.env["TYRUM_GATEWAY_TOKEN_PATH"] = tokenPath;

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const { runCli } = await import("../src/cli/run-cli.js");
      const code = await runWithSigterm(runCli(["--label", "file token label"]));

      expect(code).toBe(0);
      const opts = clientCtorSpy.mock.calls[0]?.[0] as any;
      expect(opts.token).toBe("file-token");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("throws when token file is empty", async () => {
    vi.resetModules();
    delete process.env["TYRUM_GATEWAY_TOKEN"];
    delete process.env["GATEWAY_TOKEN"];

    const tempDir = await mkdtemp(join(tmpdir(), "tyrum-desktop-node-empty-token-"));
    const tokenPath = join(tempDir, "token.txt");
    await writeFile(tokenPath, "", "utf8");
    process.env["GATEWAY_TOKEN_PATH"] = tokenPath;

    try {
      const { runCli } = await import("../src/cli/run-cli.js");
      await expect(runCli([])).rejects.toThrow(`token file is empty: ${tokenPath}`);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("throws when no gateway token is available", async () => {
    vi.resetModules();
    delete process.env["TYRUM_GATEWAY_TOKEN"];
    delete process.env["GATEWAY_TOKEN"];
    delete process.env["TYRUM_GATEWAY_TOKEN_PATH"];
    delete process.env["GATEWAY_TOKEN_PATH"];

    const { runCli } = await import("../src/cli/run-cli.js");
    await expect(runCli([])).rejects.toThrow("missing gateway token");
  });

  it("returns 1 when device identity cannot be loaded", async () => {
    vi.resetModules();
    process.env["TYRUM_GATEWAY_TOKEN"] = "test-token";
    loadOrCreateSpy.mockRejectedValueOnce(new Error("boom"));
    formatDeviceIdentityErrorSpy.mockReturnValueOnce("formatted boom");

    vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { runCli } = await import("../src/cli/run-cli.js");
    const code = await runCli(["--label", "identity-error"]);

    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith("error: formatted boom");
  });
});
