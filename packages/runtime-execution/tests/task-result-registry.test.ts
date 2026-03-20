import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskResultRegistry, type TaskResult } from "../src/task-result-registry.js";

const RESULT: TaskResult = { ok: true, evidence: { a: 1 } };

afterEach(() => {
  vi.useRealTimers();
});

describe("TaskResultRegistry", () => {
  it("resolves a waiting task and rejects duplicate resolution after cleanup", async () => {
    const registry = new TaskResultRegistry();

    const pending = registry.wait("task-1", { timeoutMs: 5_000 });
    expect(registry.resolve("task-1", RESULT)).toBe(true);

    await expect(pending).resolves.toEqual(RESULT);
    expect(registry.resolve("task-1", { ok: true })).toBe(false);
  });

  it("delivers buffered results when resolve happens before wait", async () => {
    const registry = new TaskResultRegistry();

    expect(registry.resolve("task-1", RESULT)).toBe(true);
    await expect(registry.wait("task-1", { timeoutMs: 5_000 })).resolves.toEqual(RESULT);
    expect(registry.resolve("task-1", { ok: true })).toBe(false);
  });

  it("rejects blank task ids and trims association lookups", async () => {
    const registry = new TaskResultRegistry();

    registry.associate(" task-1 ", " conn-1 ");
    expect(registry.getAssociatedConnectionId(" task-1 ")).toBe("conn-1");
    expect(registry.getAssociatedConnectionId("   ")).toBeUndefined();
    await expect(registry.wait("   ")).rejects.toThrow("taskId is required");
  });

  it("ignores blank associations and terminal-task reassociation", async () => {
    const registry = new TaskResultRegistry();

    registry.associate(" ", "conn-1");
    registry.associate("task-1", " ");
    expect(registry.getAssociatedConnectionId("task-1")).toBeUndefined();

    expect(registry.resolve("task-1", RESULT)).toBe(true);
    await expect(registry.wait("task-1")).resolves.toEqual(RESULT);

    registry.associate("task-1", "conn-2");
    expect(registry.getAssociatedConnectionId("task-1")).toBeUndefined();
  });

  it("returns the same pending promise for repeated waits", async () => {
    const registry = new TaskResultRegistry();

    const first = registry.wait("task-1", { timeoutMs: 5_000 });
    const second = registry.wait("task-1", { timeoutMs: 5_000 });

    expect(second).toBe(first);
    expect(registry.resolve("task-1", RESULT)).toBe(true);
    await expect(first).resolves.toEqual(RESULT);
    await expect(second).resolves.toEqual(RESULT);
  });

  it("records explicit wait connection ids and reuses existing associations", async () => {
    const registry = new TaskResultRegistry();

    const pendingWithExplicitConnection = registry.wait("task-1", {
      timeoutMs: 5_000,
      connectionId: " conn-1 ",
    });
    expect(registry.getAssociatedConnectionId("task-1")).toBe("conn-1");
    expect(registry.rejectAllForConnection("conn-1")).toBe(1);
    await expect(pendingWithExplicitConnection).rejects.toThrow(/disconnected/i);

    const reusedAssociationRegistry = new TaskResultRegistry();
    reusedAssociationRegistry.associate("task-2", "conn-2");
    const pendingWithAssociatedConnection = reusedAssociationRegistry.wait("task-2", {
      timeoutMs: 5_000,
    });
    expect(reusedAssociationRegistry.getAssociatedConnectionId("task-2")).toBe("conn-2");
    expect(reusedAssociationRegistry.rejectAllForConnection("conn-2")).toBe(1);
    await expect(pendingWithAssociatedConnection).rejects.toThrow(/disconnected/i);
  });

  it("rejects waits that time out and makes later resolve return false", async () => {
    vi.useFakeTimers();

    const registry = new TaskResultRegistry();
    const pending = registry.wait("task-1", { timeoutMs: 10 });
    const rejection = expect(pending).rejects.toThrow(/timeout/i);

    await vi.advanceTimersByTimeAsync(11);

    await rejection;
    expect(registry.resolve("task-1", { ok: true })).toBe(false);
  });

  it("stores a pre-wait disconnect error and then marks the task terminal", async () => {
    vi.useFakeTimers();

    const registry = new TaskResultRegistry();
    registry.associate("task-1", "conn-1");
    expect(registry.rejectAllForConnection("conn-1")).toBe(0);

    const firstWait = registry.wait("task-1", { timeoutMs: 10 });
    await expect(firstWait).rejects.toThrow(/disconnected/i);

    const secondWait = registry.wait("task-1", { timeoutMs: 10 });
    await expect(secondWait).rejects.toThrow(/no longer available/i);
  });

  it("returns zero for blank connection ids", () => {
    const registry = new TaskResultRegistry();

    expect(registry.rejectAllForConnection("   ")).toBe(0);
  });

  it("evicts the oldest buffered result when maxBufferedResults is exceeded", async () => {
    vi.useFakeTimers();

    const registry = new TaskResultRegistry({ maxBufferedResults: 1 });
    expect(registry.resolve("task-1", RESULT)).toBe(true);
    expect(registry.resolve("task-2", { ok: true, evidence: { b: 2 } })).toBe(true);

    const evictedWait = registry.wait("task-1", { timeoutMs: 10 });
    const timedOut = expect(evictedWait).rejects.toThrow(/timeout/i);
    await vi.advanceTimersByTimeAsync(11);
    await timedOut;

    await expect(registry.wait("task-2", { timeoutMs: 10 })).resolves.toEqual({
      ok: true,
      evidence: { b: 2 },
    });
  });

  it("evicts the oldest terminal state when maxTerminalTasks is exceeded", async () => {
    vi.useFakeTimers();

    const registry = new TaskResultRegistry({ maxTerminalTasks: 1 });

    expect(registry.resolve("task-1", RESULT)).toBe(true);
    await expect(registry.wait("task-1", { timeoutMs: 10 })).resolves.toEqual(RESULT);

    expect(registry.resolve("task-2", { ok: true, evidence: { b: 2 } })).toBe(true);
    await expect(registry.wait("task-2", { timeoutMs: 10 })).resolves.toEqual({
      ok: true,
      evidence: { b: 2 },
    });

    await expect(registry.wait("task-2", { timeoutMs: 10 })).rejects.toThrow(
      /no longer available/i,
    );

    const evictedTerminalWait = registry.wait("task-1", { timeoutMs: 10 });
    const timedOut = expect(evictedTerminalWait).rejects.toThrow(/timeout/i);
    await vi.advanceTimersByTimeAsync(11);
    await timedOut;
  });

  it("evicts the oldest association when maxTaskAssociations is exceeded", () => {
    const registry = new TaskResultRegistry({ maxTaskAssociations: 1 });

    registry.associate("task-1", "conn-1");
    registry.associate("task-2", "conn-2");

    expect(registry.getAssociatedConnectionId("task-1")).toBeUndefined();
    expect(registry.getAssociatedConnectionId("task-2")).toBe("conn-2");
    expect(registry.rejectAllForConnection("conn-1")).toBe(0);
  });

  it("reassociates tasks to the new connection and removes the old index entry", async () => {
    const registry = new TaskResultRegistry();

    registry.associate("task-1", "conn-1");
    registry.associate("task-1", "conn-2");
    expect(registry.getAssociatedConnectionId("task-1")).toBe("conn-2");
    expect(registry.rejectAllForConnection("conn-1")).toBe(0);

    const pending = registry.wait("task-1", { timeoutMs: 5_000 });
    expect(registry.rejectAllForConnection("conn-2")).toBe(1);
    await expect(pending).rejects.toThrow(/conn-2/);
  });
});
