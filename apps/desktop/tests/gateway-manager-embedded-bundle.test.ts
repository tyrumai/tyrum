import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: spawnMock,
  };
});

import { GatewayManager } from "../src/main/gateway-manager.js";

function mockProc() {
  const proc = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill: vi.fn((signal?: string) => {
      if (signal === "SIGTERM") {
        proc.signalCode = "SIGTERM";
        queueMicrotask(() => proc.emit("exit", null));
      }
    }),
    stdout: null,
    stderr: null,
    stdin: null,
    pid: 12345,
  });
  return proc;
}

afterEach(() => {
  spawnMock.mockReset();
  vi.unstubAllGlobals();
});

it("emits embedded bundle diagnostics before starting the child process", async () => {
  const gm = new GatewayManager();
  const proc = mockProc();
  spawnMock.mockReturnValue(proc);
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

  const [, , options] = spawnMock.mock.calls[0] ?? [];
  const env = (options as { env?: Record<string, string> }).env;
  expect(env?.["TYRUM_EMBEDDED_GATEWAY_BUNDLE_SOURCE"]).toBe("staged");

  await gm.stop();
});
