import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: (signal?: NodeJS.Signals) => boolean;
  pid: number;
};

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  child.pid = 4_321;
  return child;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.resetModules();
});

describe("execBash", () => {
  it("escalates timed out commands to SIGKILL after the grace period", async () => {
    vi.useFakeTimers();
    const child = createMockChild();
    spawnMock.mockReturnValueOnce(child);

    const processKillSpy = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (signal === "SIGKILL") {
        queueMicrotask(() => child.emit("close", null, signal));
      }
      return pid !== 0;
    });

    const { execBash } = await import("../../src/providers/filesystem-provider-helpers.js");
    const resultPromise = execBash("trap '' TERM; sleep 9999", "/sandbox", 100, 1_024);

    await vi.advanceTimersByTimeAsync(100);
    expect(processKillSpy).toHaveBeenNthCalledWith(1, -child.pid, "SIGTERM");

    await vi.advanceTimersByTimeAsync(5_000);
    const result = await resultPromise;

    expect(processKillSpy).toHaveBeenNthCalledWith(2, -child.pid, "SIGKILL");
    expect(result).toEqual({ output: "", exitCode: null });
    expect(spawnMock).toHaveBeenCalledWith(
      "sh",
      ["-c", "trap '' TERM; sleep 9999"],
      expect.objectContaining({
        cwd: "/sandbox",
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  });

  it("rejects when the shell fails to spawn", async () => {
    const child = createMockChild();
    spawnMock.mockReturnValueOnce(child);

    const { execBash } = await import("../../src/providers/filesystem-provider-helpers.js");
    const resultPromise = execBash("echo hello", "/missing", 100, 1_024);

    queueMicrotask(() => {
      child.emit("error", new Error("spawn sh ENOENT"));
    });

    await expect(resultPromise).rejects.toThrow("Error spawning command: spawn sh ENOENT");
  });
});
