import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { TuiAppMarker, createTuiCoreMock, parseTuiCliArgsMock, renderMock, resolveTuiConfigMock } =
  vi.hoisted(() => ({
    TuiAppMarker: "mock-tui-app",
    createTuiCoreMock: vi.fn(),
    parseTuiCliArgsMock: vi.fn(),
    renderMock: vi.fn(),
    resolveTuiConfigMock: vi.fn(),
  }));

vi.mock("ink", () => ({
  render: renderMock,
}));

vi.mock("../src/app.js", () => ({
  TuiApp: TuiAppMarker,
}));

vi.mock("../src/cli-args.js", () => ({
  parseTuiCliArgs: parseTuiCliArgsMock,
}));

vi.mock("../src/config.js", () => ({
  resolveTuiConfig: resolveTuiConfigMock,
}));

vi.mock("../src/core.js", () => ({
  createTuiCore: createTuiCoreMock,
}));

const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

const baseStartCommand = {
  kind: "start" as const,
  gatewayUrl: "http://gateway.internal:8788",
  token: "test-token",
  tyrumHome: "/tmp/tyrum-home",
  deviceIdentityPath: "/tmp/tyrum-home/tui/device-identity.json",
  tlsCertFingerprint256: "a".repeat(64),
  reconnect: false,
};

const resolvedConfig = {
  wsUrl: "ws://gateway.internal:8788/ws",
  httpBaseUrl: "http://gateway.internal:8788",
  token: "test-token",
  deviceIdentityPath: "/tmp/tyrum-home/tui/device-identity.json",
  tlsCertFingerprint256: "a".repeat(64),
  reconnect: false,
};

async function importRunCli(): Promise<(argv?: readonly string[]) => Promise<number>> {
  const mod = await import("../src/cli.js");
  return mod.runCli;
}

describe("tui cli runtime", () => {
  beforeEach(() => {
    vi.resetModules();
    parseTuiCliArgsMock.mockReset();
    resolveTuiConfigMock.mockReset();
    createTuiCoreMock.mockReset();
    renderMock.mockReset();
    logSpy.mockClear();
    errorSpy.mockClear();
  });

  afterAll(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("prints help and exits with status 1 when argument parsing fails", async () => {
    parseTuiCliArgsMock.mockImplementation(() => {
      throw new Error("unknown argument '--bad'");
    });

    const runCli = await importRunCli();

    await expect(runCli(["--bad"])).resolves.toBe(1);
    expect(errorSpy).toHaveBeenCalledWith("error: unknown argument '--bad'");
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Usage:");
  });

  it("renders the app, forwards the resolved config, and returns a numeric exit code", async () => {
    parseTuiCliArgsMock.mockReturnValue(baseStartCommand);
    resolveTuiConfigMock.mockReturnValue(resolvedConfig);

    const core = { dispose: vi.fn() };
    createTuiCoreMock.mockResolvedValue(core);

    const instance = {
      waitUntilExit: vi.fn().mockResolvedValue(7),
      cleanup: vi.fn(),
    };
    renderMock.mockReturnValue(instance);

    const runCli = await importRunCli();

    await expect(runCli(["start"])).resolves.toBe(7);
    expect(resolveTuiConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayUrl: baseStartCommand.gatewayUrl,
        token: baseStartCommand.token,
        tyrumHome: baseStartCommand.tyrumHome,
        deviceIdentityPath: baseStartCommand.deviceIdentityPath,
        tlsCertFingerprint256: baseStartCommand.tlsCertFingerprint256,
        reconnect: baseStartCommand.reconnect,
        defaults: expect.objectContaining({
          gatewayUrl: "http://127.0.0.1:8788",
          tyrumHome: expect.any(String),
        }),
      }),
    );
    expect(createTuiCoreMock).toHaveBeenCalledWith(resolvedConfig);

    const renderedElement = renderMock.mock.calls[0]?.[0] as {
      type?: unknown;
      props?: { runtime?: unknown; config?: unknown };
    };
    expect(renderedElement.type).toBe(TuiAppMarker);
    expect(renderedElement.props).toMatchObject({
      runtime: core,
      config: resolvedConfig,
    });
    expect(instance.cleanup).toHaveBeenCalledTimes(1);
    expect(core.dispose).toHaveBeenCalledTimes(1);
  });

  it("normalizes non-numeric render exit codes to zero", async () => {
    parseTuiCliArgsMock.mockReturnValue(baseStartCommand);
    resolveTuiConfigMock.mockReturnValue(resolvedConfig);

    const core = { dispose: vi.fn() };
    createTuiCoreMock.mockResolvedValue(core);

    const instance = {
      waitUntilExit: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn(),
    };
    renderMock.mockReturnValue(instance);

    const runCli = await importRunCli();

    await expect(runCli(["start"])).resolves.toBe(0);
    expect(instance.cleanup).toHaveBeenCalledTimes(1);
    expect(core.dispose).toHaveBeenCalledTimes(1);
  });

  it("reports render failures and disposes the created core", async () => {
    parseTuiCliArgsMock.mockReturnValue(baseStartCommand);
    resolveTuiConfigMock.mockReturnValue(resolvedConfig);

    const core = { dispose: vi.fn() };
    createTuiCoreMock.mockResolvedValue(core);
    renderMock.mockImplementation(() => {
      throw new Error("render exploded");
    });

    const runCli = await importRunCli();

    await expect(runCli(["start"])).resolves.toBe(1);
    expect(errorSpy).toHaveBeenCalledWith("error: render exploded");
    expect(core.dispose).toHaveBeenCalledTimes(1);
  });
});
