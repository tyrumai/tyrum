import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMockDesktopSubprocess,
  createMockStreamingDesktopSubprocess,
  gatewayStartOptions,
  type Internal,
  stubHealthyFetch,
} from "./gateway-manager.test-helpers.js";

const { launchDesktopSubprocessMock } = vi.hoisted(() => ({
  launchDesktopSubprocessMock: vi.fn(),
}));

vi.mock("../src/main/desktop-subprocess.js", async () => {
  const actual = await vi.importActual<typeof import("../src/main/desktop-subprocess.js")>(
    "../src/main/desktop-subprocess.js",
  );
  return {
    ...actual,
    launchDesktopSubprocess: launchDesktopSubprocessMock,
  };
});

import {
  GatewayManager,
  type GatewayStatus,
  resolveGatewayLaunchSpec,
  summarizeGatewayStartupFailure,
} from "../src/main/gateway-manager.js";

async function startGatewayForLogs() {
  const gm = new GatewayManager();
  const { proc, stdout, stderr } = createMockStreamingDesktopSubprocess();
  launchDesktopSubprocessMock.mockResolvedValue(proc);
  stubHealthyFetch();

  const logs: { level: string; message: string }[] = [];
  gm.on("log", (entry) => logs.push(entry));

  await gm.start(gatewayStartOptions());
  return { gm, proc, stdout, stderr, logs };
}

describe("GatewayManager", () => {
  afterEach(() => {
    launchDesktopSubprocessMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("status starts as 'stopped'", () => {
    const gm = new GatewayManager();
    expect(gm.status).toBe("stopped");
  });

  it.each([
    {
      name: "summarizes startup logs with highest-priority bind errors",
      lines: [
        "Watcher processor and scheduler started",
        "Error: listen EADDRINUSE: address already in use 127.0.0.1:8788",
        "at Server.setupListenHandle (node:net:1940:16)",
      ],
      expected: "Error: listen EADDRINUSE: address already in use 127.0.0.1:8788",
    },
    {
      name: "falls back to the last non-empty startup line",
      lines: ["one", "two", "  ", "final line"],
      expected: "final line",
    },
    {
      name: "ignores stack footer noise and picks the actual error line",
      lines: [
        "node:internal/modules/cjs/loader:1386",
        "  throw err;",
        "  ^",
        "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/tmp/missing.mjs'",
        "    at Function._resolveFilename (node:internal/modules/cjs/loader:1383:15)",
        "    at defaultResolveImpl (node:internal/modules/cjs/loader:1025:19)",
        "Node.js v24.9.0",
      ],
      expected: "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/tmp/missing.mjs'",
    },
    {
      name: "prefers generic error lines over Node.js version footer",
      lines: [
        "node:internal/modules/run_main:123",
        "Error: spawn /tmp/bin ENOENT",
        "    at ChildProcess._handle.onexit (node:internal/child_process:286:19)",
        "Node.js v24.9.0",
      ],
      expected: "Error: spawn /tmp/bin ENOENT",
    },
  ])("$name", ({ lines, expected }) => {
    expect(summarizeGatewayStartupFailure(lines)).toBe(expected);
  });

  it("stop() on a stopped manager is a no-op", async () => {
    const gm = new GatewayManager();
    await gm.stop();
    expect(gm.status).toBe("stopped");
  });

  it("start() when already running throws", async () => {
    const gm = new GatewayManager();

    const internal = gm as unknown as Internal;
    internal.process = {};

    await expect(gm.start(gatewayStartOptions({ port: 9999 }))).rejects.toThrow(
      "Gateway already running",
    );
  });

  it("rejects concurrent start() calls while launch is still in flight", async () => {
    const gm = new GatewayManager();
    const { proc } = createMockDesktopSubprocess();
    let resolveLaunch: ((value: typeof proc) => void) | null = null;

    launchDesktopSubprocessMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLaunch = resolve;
        }),
    );
    stubHealthyFetch();

    const firstStart = gm.start(gatewayStartOptions());
    const secondStart = gm.start(gatewayStartOptions({ port: 9999 }));
    await Promise.resolve();

    expect(launchDesktopSubprocessMock).toHaveBeenCalledTimes(1);
    await expect(secondStart).rejects.toThrow("Gateway already running");

    resolveLaunch?.(proc);
    await firstStart;
    await gm.stop();
  });

  it("emits status-change events", () => {
    const gm = new GatewayManager();
    const statuses: GatewayStatus[] = [];
    gm.on("status-change", (s) => statuses.push(s));

    const internal = gm as unknown as Internal;
    internal.setStatus("starting");
    internal.setStatus("running");
    internal.setStatus("stopped");

    expect(statuses).toEqual(["starting", "running", "stopped"]);
  });

  it("passes CLI flags when starting gateway", async () => {
    const gm = new GatewayManager();
    const { proc } = createMockDesktopSubprocess();
    launchDesktopSubprocessMock.mockResolvedValue(proc);
    stubHealthyFetch();

    await gm.start(gatewayStartOptions({ accessToken: "local-token-123" }));

    expect(launchDesktopSubprocessMock).toHaveBeenCalledWith({
      kind: "node",
      command: process.execPath,
      args: [
        "/nonexistent",
        "start",
        "--host",
        "127.0.0.1",
        "--port",
        "7788",
        "--home",
        "/tmp",
        "--db",
        "/tmp/test.db",
      ],
      env: {
        TYRUM_EMBEDDED_GATEWAY_BUNDLE_SOURCE: "",
      },
    });

    await gm.stop();
  });

  it("issues a default tenant admin token via the embedded gateway bundle", async () => {
    const gm = new GatewayManager();
    const { proc, stdout, emitExit } = createMockStreamingDesktopSubprocess();
    launchDesktopSubprocessMock.mockResolvedValue(proc);

    const tokenPromise = gm.issueDefaultTenantAdminToken({
      gatewayBin: "/nonexistent",
      dbPath: "/tmp/test.db",
    });
    await Promise.resolve();
    stdout.emit("data", Buffer.from("tokens.issue-default-tenant-admin: ok\n"));
    stdout.emit("data", Buffer.from("default-tenant-admin: tyrum-token.v1.issued.token\n"));
    emitExit(0);

    const token = await tokenPromise;

    expect(token).toBe("tyrum-token.v1.issued.token");

    expect(launchDesktopSubprocessMock).toHaveBeenCalledWith({
      kind: "node",
      command: process.execPath,
      args: [
        "/nonexistent",
        "tokens",
        "issue-default-tenant-admin",
        "--home",
        "/tmp",
        "--db",
        "/tmp/test.db",
      ],
      env: {},
    });
  });

  it("redacts recovered tokens from token-issue failures", async () => {
    const gm = new GatewayManager();
    const { proc, stdout, emitExit } = createMockStreamingDesktopSubprocess();
    launchDesktopSubprocessMock.mockResolvedValue(proc);

    const issue = gm.issueDefaultTenantAdminToken({
      gatewayBin: "/nonexistent",
      dbPath: "/tmp/test.db",
    });
    await Promise.resolve();
    stdout.emit("data", Buffer.from("default-tenant-admin: tyrum-token.v1.secret.token\n"));
    emitExit(1);

    await expect(issue).rejects.toThrow("default-tenant-admin: [REDACTED]");
    await issue.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("tyrum-token.v1.secret.token");
    });
  });

  it.each([
    {
      name: "uses utilityProcess for staged gateway bundles inside Electron",
      gatewayBin: "/repo/apps/desktop/dist/gateway/index.mjs",
      gatewayBinSource: "staged" as const,
      expected: {
        kind: "utility",
        modulePath: "/repo/apps/desktop/dist/gateway/index.mjs",
        args: [],
        env: {},
        serviceName: "Tyrum Embedded Gateway",
        allowLoadingUnsignedLibraries: true,
      },
    },
    {
      name: "uses a real Node runtime for the monorepo gateway bundle inside Electron",
      gatewayBin: "/repo/packages/gateway/dist/index.mjs",
      gatewayBinSource: "monorepo" as const,
      expected: {
        kind: "node",
        command: "/opt/homebrew/bin/node",
        args: [],
        env: {},
      },
    },
    {
      name: "uses utilityProcess for packaged gateway bundles",
      gatewayBin: "/Applications/Tyrum.app/Contents/Resources/app.asar/dist/gateway/index.mjs",
      gatewayBinSource: "packaged" as const,
      expected: {
        kind: "utility",
        modulePath: "/Applications/Tyrum.app/Contents/Resources/app.asar/dist/gateway/index.mjs",
        args: [],
        env: {},
        serviceName: "Tyrum Embedded Gateway",
        allowLoadingUnsignedLibraries: true,
      },
    },
  ])("$name", ({ gatewayBin, gatewayBinSource, expected }) => {
    expect(
      resolveGatewayLaunchSpec({
        gatewayBin,
        gatewayBinSource,
        processExecPath: "/Applications/Tyrum.app/Contents/MacOS/Tyrum",
        versions: { ...process.versions, electron: "40.7.0" },
        env: { TYRUM_DESKTOP_NODE_EXEC_PATH: "/opt/homebrew/bin/node" },
      }),
    ).toEqual(expected);
  });

  it.each([
    {
      name: "preserves CRLF line endings when redacting bootstrap tokens",
      chunks: ["system: tyrum-token.v1.abc.def\r\nhello\r\n"],
      expectedLog: "system: [REDACTED]\r\nhello",
    },
    {
      name: "preserves original indentation and padding when redacting bootstrap tokens",
      chunks: ["\t  system: tyrum-token.v1.abc.def   \r\nhello\r\n"],
      expectedLog: "\t  system: [REDACTED]   \r\nhello",
    },
    {
      name: "captures bootstrap tokens when log prefixes precede the label",
      chunks: ["[gateway] default-tenant-admin: tyrum-token.v1.abc.def\r\n"],
      expectedLog: "[gateway] default-tenant-admin: [REDACTED]",
      expectedToken: ["default-tenant-admin", "tyrum-token.v1.abc.def"] as const,
    },
    {
      name: "captures bootstrap tokens split across stdout chunks without leaking them",
      chunks: ["system: tyrum-token.v1.abc.", "def\r\nhello\r\n"],
      expectedLog: "system: [REDACTED]\r\nhello",
      expectedToken: ["system", "tyrum-token.v1.abc.def"] as const,
      assertBeforeLastChunk: true,
    },
  ])("$name", async ({ chunks, expectedLog, expectedToken, assertBeforeLastChunk }) => {
    const { gm, stdout, logs } = await startGatewayForLogs();
    for (const [index, chunk] of chunks.entries()) {
      stdout.emit("data", Buffer.from(chunk));
      if (assertBeforeLastChunk && index === 0) {
        expect(logs.some((entry) => entry.message.includes("tyrum-token.v1."))).toBe(false);
        expect(gm.getBootstrapToken("system")).toBeUndefined();
      }
    }

    if (expectedToken) {
      expect(gm.getBootstrapToken(expectedToken[0])).toBe(expectedToken[1]);
    }
    expect(logs.some((entry) => entry.message.includes("tyrum-token.v1."))).toBe(false);
    expect(logs.at(-1)?.message).toBe(expectedLog);

    await gm.stop();
  });

  it("graceful stop does not emit transient error status", async () => {
    const gm = new GatewayManager();
    const { proc } = createMockDesktopSubprocess();
    launchDesktopSubprocessMock.mockResolvedValue(proc);
    stubHealthyFetch();

    const statuses: GatewayStatus[] = [];
    gm.on("status-change", (s) => statuses.push(s));

    await gm.start(gatewayStartOptions({ port: 7777 }));
    await gm.stop();

    expect(proc.terminate).toHaveBeenCalled();
    expect(statuses).toContain("stopped");
    expect(statuses).not.toContain("error");
  });

  it("does not report running when process exits after health passes", async () => {
    const gm = new GatewayManager();
    const { proc, emitExit } = createMockDesktopSubprocess();
    launchDesktopSubprocessMock.mockResolvedValue(proc);

    const statuses: GatewayStatus[] = [];
    gm.on("status-change", (status) => statuses.push(status));

    const fetchMock = vi.fn().mockImplementation(async () => {
      queueMicrotask(() => {
        emitExit(1);
      });
      return { ok: true } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(gm.start(gatewayStartOptions())).rejects.toThrow("Gateway failed to start");

    expect(gm.status).toBe("error");
    expect(statuses).not.toContain("running");
  });
});
