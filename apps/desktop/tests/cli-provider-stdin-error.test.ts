import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { ActionPrimitive } from "@tyrum/schemas";

const { execaMock } = vi.hoisted(() => ({
  execaMock: vi.fn(),
}));

vi.mock("execa", () => {
  return {
    execa: execaMock,
  };
});

import { CliProvider } from "../src/main/providers/cli-provider.js";

type MockStdin = EventEmitter & {
  write: (chunk: string) => boolean;
  end: () => void;
};

type MockChildProcess = EventEmitter & {
  stdin: MockStdin;
  stdout: EventEmitter;
  stderr: EventEmitter;
};

function makeAction(args: Record<string, unknown>): ActionPrimitive {
  return { type: "CLI", args };
}

function createMockChild(): MockChildProcess {
  const stdin = new EventEmitter() as MockStdin;
  stdin.write = vi.fn((chunk: string) => {
    void chunk;
    const err = Object.assign(new Error("broken pipe"), { code: "EPIPE" });
    stdin.emit("error", err);
    return true;
  });
  stdin.end = vi.fn();

  return Object.assign(new EventEmitter(), {
    stdin,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
}

type MockSubprocessResult = {
  exitCode: number | null;
  durationMs: number;
  code?: string;
  timedOut: boolean;
  isTerminated: boolean;
  originalMessage?: string;
  message?: string;
};

type MockSubprocess = Promise<MockSubprocessResult> & MockChildProcess;

function createMockSubprocess(result: MockSubprocessResult): MockSubprocess {
  const child = createMockChild();
  let resolvePromise: (value: MockSubprocessResult) => void = () => undefined;
  const promise = new Promise<MockSubprocessResult>((resolve) => {
    resolvePromise = resolve;
  });

  queueMicrotask(() => {
    resolvePromise(result);
  });

  return Object.assign(promise, child);
}

describe("CliProvider stdin handling", () => {
  it("handles stdin EPIPE without throwing", async () => {
    let child: MockSubprocess | undefined;
    execaMock.mockImplementation(() => {
      child = createMockSubprocess({
        exitCode: 0,
        durationMs: 1,
        timedOut: false,
        isTerminated: false,
      });
      return child;
    });

    const provider = new CliProvider(["echo"], ["*"], true);
    const result = await provider.execute(
      makeAction({
        cmd: "echo",
        stdin: "payload",
      }),
    );

    expect(result.success).toBe(true);
    expect(child).toBeDefined();
    expect(child?.stdin.listenerCount("error")).toBeGreaterThan(0);
  });
});
