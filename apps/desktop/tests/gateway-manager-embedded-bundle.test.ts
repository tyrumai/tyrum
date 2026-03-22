import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";

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

import { GatewayManager } from "../src/main/gateway-manager.js";
import type { DesktopSubprocess } from "../src/main/desktop-subprocess.js";

function mockProc() {
  const emitter = new EventEmitter();
  return {
    proc: {
      kind: "utility",
      exitCode: null,
      signalCode: null,
      stdout: null,
      stderr: null,
      pid: 12345,
      onExit: (listener) => emitter.on("exit", listener),
      onceExit: (listener) => emitter.once("exit", listener),
      onceComplete: (listener) => emitter.once("complete", listener),
      onceError: (_listener) => {},
      terminate: vi.fn(() => {
        queueMicrotask(() => {
          emitter.emit("exit", 0, null);
          emitter.emit("complete", 0, null);
        });
      }),
      forceTerminate: vi.fn(),
    } satisfies DesktopSubprocess,
  };
}

afterEach(() => {
  launchDesktopSubprocessMock.mockReset();
  vi.unstubAllGlobals();
});

it("emits embedded bundle diagnostics before starting the child process", async () => {
  const gm = new GatewayManager();
  const { proc } = mockProc();
  launchDesktopSubprocessMock.mockResolvedValue(proc);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));

  const logs: string[] = [];
  gm.on("log", (entry) => logs.push(entry.message));

  await gm.start({
    gatewayBin: "/repo/apps/desktop/dist/gateway/index.mjs",
    gatewayBinSource: "staged",
    port: 7788,
    dbPath: "/tmp/test.db",
    accessToken: "test-token",
  });

  expect(logs[0]).toBe(
    "embedded-gateway bundle: source=staged path=/repo/apps/desktop/dist/gateway/index.mjs",
  );
  expect(logs[1]).toBe(`embedded-gateway launch: mode=node command=${process.execPath}`);
  expect(launchDesktopSubprocessMock).toHaveBeenCalledWith({
    kind: "node",
    command: process.execPath,
    args: [
      "/repo/apps/desktop/dist/gateway/index.mjs",
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
      TYRUM_EMBEDDED_GATEWAY_BUNDLE_SOURCE: "staged",
    },
  });

  await gm.stop();
});
