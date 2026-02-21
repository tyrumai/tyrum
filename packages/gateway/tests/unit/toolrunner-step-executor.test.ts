import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { ActionPrimitive } from "@tyrum/schemas";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { createToolRunnerStepExecutor } from "../../src/modules/execution/toolrunner-step-executor.js";

const mockSpawn = vi.mocked(spawn);

/* ---------- helpers ---------- */

function makeAction(type: ActionPrimitive["type"], args?: Record<string, unknown>): ActionPrimitive {
  return { type, args: args ?? {} };
}

function createMockChild(
  exitCode: number | null,
  signal: string | null,
  stdout: string,
  stderr = "",
) {
  const child = new EventEmitter() as any;
  child.stdout = new Readable({
    read() {
      this.push(Buffer.from(stdout));
      this.push(null);
    },
  });
  child.stderr = new Readable({
    read() {
      this.push(Buffer.from(stderr));
      this.push(null);
    },
  });
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.kill = vi.fn();
  setTimeout(() => child.emit("close", exitCode, signal), 5);
  return child;
}

function createMockChildWithError(errorMessage: string) {
  const child = new EventEmitter() as any;
  child.stdout = new Readable({ read() { this.push(null); } });
  child.stderr = new Readable({ read() { this.push(null); } });
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.kill = vi.fn();
  setTimeout(() => child.emit("error", new Error(errorMessage)), 5);
  return child;
}

function createMockChildWithStdinError(exitCode: number | null, stdout: string) {
  const child = new EventEmitter() as any;
  child.stdout = new Readable({
    read() {
      this.push(Buffer.from(stdout));
      this.push(null);
    },
  });
  child.stderr = new Readable({ read() { this.push(null); } });
  child.stdin = {
    write: vi.fn().mockImplementation(() => {
      throw new Error("stdin broken pipe");
    }),
    end: vi.fn(),
  };
  child.kill = vi.fn();
  // Do not emit close; the stdin error should resolve the promise first.
  return child;
}

/* ---------- suite ---------- */

describe("ToolRunnerStepExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const executor = createToolRunnerStepExecutor({
    entrypoint: "/opt/tyrum/runner.js",
  });

  const defaultAction = makeAction("Http", { url: "https://example.com" });

  it("executes successfully — parses JSON result from stdout", async () => {
    const stepResult = {
      success: true,
      result: { status: 200 },
      evidence: { http: { status: 200 } },
    };
    const child = createMockChild(0, null, JSON.stringify(stepResult));
    mockSpawn.mockReturnValue(child as any);

    const result = await executor.execute(defaultAction, "plan-1", 0, 30_000);

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ status: 200 });
    expect(result.evidence).toEqual({ http: { status: 200 } });

    // Verify spawn was called with process.execPath and entrypoint
    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(["/opt/tyrum/runner.js", "toolrunner"]),
      expect.objectContaining({
        env: expect.objectContaining({ TYRUM_TOOLRUNNER_MODE: "1" }),
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );

    // Verify payload was written to stdin
    expect(child.stdin.write).toHaveBeenCalledWith(
      expect.stringContaining('"plan_id":"plan-1"'),
      "utf-8",
    );
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("returns error on non-zero exit code", async () => {
    const child = createMockChild(1, null, "", "toolrunner crashed");
    mockSpawn.mockReturnValue(child as any);

    const result = await executor.execute(defaultAction, "plan-1", 0, 30_000);

    expect(result.success).toBe(false);
    expect(result.error).toBe("toolrunner crashed");
    expect(result.cost?.duration_ms).toBeTypeOf("number");
  });

  it("returns fallback error message on non-zero exit code with empty stderr", async () => {
    const child = createMockChild(2, null, "", "");
    mockSpawn.mockReturnValue(child as any);

    const result = await executor.execute(defaultAction, "plan-1", 0, 30_000);

    expect(result.success).toBe(false);
    expect(result.error).toContain("toolrunner exited with code 2");
    expect(result.cost?.duration_ms).toBeTypeOf("number");
  });

  it("returns error on signal termination", async () => {
    const child = createMockChild(null, "SIGTERM", "");
    mockSpawn.mockReturnValue(child as any);

    const result = await executor.execute(defaultAction, "plan-1", 0, 30_000);

    expect(result.success).toBe(false);
    expect(result.error).toContain("toolrunner terminated by signal SIGTERM");
    expect(result.cost?.duration_ms).toBeTypeOf("number");
  });

  it("returns error on invalid JSON stdout", async () => {
    const child = createMockChild(0, null, "not valid json {{{");
    mockSpawn.mockReturnValue(child as any);

    const result = await executor.execute(defaultAction, "plan-1", 0, 30_000);

    expect(result.success).toBe(false);
    expect(result.error).toContain("toolrunner returned invalid json");
    expect(result.cost?.duration_ms).toBeTypeOf("number");
  });

  it("returns error on spawn error", async () => {
    const child = createMockChildWithError("ENOENT: no such file");
    mockSpawn.mockReturnValue(child as any);

    const result = await executor.execute(defaultAction, "plan-1", 0, 30_000);

    expect(result.success).toBe(false);
    expect(result.error).toContain("toolrunner spawn error");
    expect(result.error).toContain("ENOENT");
  });

  it("returns error on stdin write error", async () => {
    const child = createMockChildWithStdinError(0, "{}");
    mockSpawn.mockReturnValue(child as any);

    const result = await executor.execute(defaultAction, "plan-1", 0, 30_000);

    expect(result.success).toBe(false);
    expect(result.error).toContain("toolrunner stdin error");
    expect(result.error).toContain("stdin broken pipe");
  });

  it("includes duration_ms in cost on failure", async () => {
    const child = createMockChild(1, null, "", "fail");
    mockSpawn.mockReturnValue(child as any);

    const result = await executor.execute(defaultAction, "plan-1", 0, 30_000);

    expect(result.success).toBe(false);
    expect(result.cost).toBeDefined();
    expect(result.cost?.duration_ms).toBeGreaterThanOrEqual(0);
  });
});
