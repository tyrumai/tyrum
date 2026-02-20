import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { ActionPrimitive } from "@tyrum/schemas";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return {
    ...actual,
    spawn: spawnMock,
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

describe("CliProvider stdin handling", () => {
  it("handles stdin EPIPE without throwing", async () => {
    spawnMock.mockImplementation(() => {
      const child = createMockChild();
      queueMicrotask(() => child.emit("close", 0));
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
    const child = spawnMock.mock.results[0]?.value as MockChildProcess | undefined;
    expect(child).toBeDefined();
    expect(child?.stdin.listenerCount("error")).toBeGreaterThan(0);
  });
});
