import { EventEmitter } from "node:events";
import { vi } from "vitest";
import type { GatewayManager, GatewayStatus } from "../src/main/gateway-manager.js";
import type { DesktopSubprocess } from "../src/main/desktop-subprocess.js";

export type Internal = {
  process: unknown;
  setStatus(status: GatewayStatus): void;
  startHealthCheck(port: number, host: string): void;
  stopHealthCheck(): void;
};

export type StartOptions = Parameters<GatewayManager["start"]>[0];

const defaultStartOptions: StartOptions = {
  gatewayBin: "/nonexistent",
  port: 7788,
  dbPath: "/tmp/test.db",
  accessToken: "test-token",
};

export function gatewayStartOptions(overrides: Partial<StartOptions> = {}): StartOptions {
  return { ...defaultStartOptions, ...overrides };
}

export function stubHealthyFetch(): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));
}

export function createMockDesktopSubprocess(
  overrides: {
    kind?: DesktopSubprocess["kind"];
    exitCode?: number | null;
    signalCode?: NodeJS.Signals | null;
  } = {},
) {
  const emitter = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  let exitCode = overrides.exitCode ?? null;
  let signalCode = overrides.signalCode ?? null;

  return {
    proc: {
      kind: overrides.kind ?? "node",
      get exitCode() {
        return exitCode;
      },
      get signalCode() {
        return signalCode;
      },
      get stdout() {
        return stdout;
      },
      get stderr() {
        return stderr;
      },
      pid: 12345,
      onExit: (listener: (code: number | null, signal: NodeJS.Signals | null) => void) => {
        emitter.on("exit", listener);
      },
      onceExit: (listener: (code: number | null, signal: NodeJS.Signals | null) => void) => {
        emitter.once("exit", listener);
      },
      onceComplete: (listener: (code: number | null, signal: NodeJS.Signals | null) => void) => {
        emitter.once("complete", listener);
      },
      onceError: (listener: (error: Error) => void) => {
        emitter.once("error", listener);
      },
      terminate: vi.fn(() => {
        signalCode = "SIGTERM";
        queueMicrotask(() => {
          emitter.emit("exit", exitCode, signalCode);
          emitter.emit("complete", exitCode, signalCode);
        });
      }),
      forceTerminate: vi.fn(() => {
        signalCode = "SIGKILL";
        queueMicrotask(() => {
          emitter.emit("exit", exitCode, signalCode);
          emitter.emit("complete", exitCode, signalCode);
        });
      }),
    } satisfies DesktopSubprocess,
    stdout,
    stderr,
    emitExit: (code: number | null, signal: NodeJS.Signals | null = null) => {
      exitCode = code;
      signalCode = signal;
      emitter.emit("exit", code, signal);
      emitter.emit("complete", code, signal);
    },
    emitError: (error: Error) => {
      emitter.emit("error", error);
    },
  };
}

export function createMockStreamingDesktopSubprocess() {
  const { proc, stdout, stderr, emitExit } = createMockDesktopSubprocess();
  proc.terminate = vi.fn(() => {
    queueMicrotask(() => emitExit(0, "SIGTERM"));
  });
  return { proc, stdout, stderr, emitExit };
}
