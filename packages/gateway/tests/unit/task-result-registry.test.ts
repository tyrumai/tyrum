import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskResultRegistry } from "../../src/ws/protocol/task-result-registry.js";

describe("TaskResultRegistry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves a waiting task and cleans up the entry", async () => {
    const registry = new TaskResultRegistry();

    const pending = registry.wait("task-1", { timeoutMs: 5_000 });
    expect(registry.resolve("task-1", { ok: true, evidence: { a: 1 } })).toBe(true);

    await expect(pending).resolves.toEqual({ ok: true, evidence: { a: 1 } });

    expect(registry.resolve("task-1", { ok: true })).toBe(false);
  });

  it("delivers results even when resolve happens before wait", async () => {
    const registry = new TaskResultRegistry();

    expect(registry.resolve("task-1", { ok: true, evidence: { a: 1 } })).toBe(true);

    await expect(registry.wait("task-1", { timeoutMs: 5_000 })).resolves.toEqual({
      ok: true,
      evidence: { a: 1 },
    });

    expect(registry.resolve("task-1", { ok: true })).toBe(false);
  });

  it("rejects waits that time out and cleans up the entry", async () => {
    vi.useFakeTimers();

    const registry = new TaskResultRegistry();
    const pending = registry.wait("task-1", { timeoutMs: 10 });

    const rejection = expect(pending).rejects.toThrow(/timeout/i);
    await vi.advanceTimersByTimeAsync(11);

    await rejection;
    expect(registry.resolve("task-1", { ok: true })).toBe(false);
  });

  it("rejects pending waits for a disconnected connection", async () => {
    const registry = new TaskResultRegistry();
    registry.associate("task-1", "conn-1");
    const pending = registry.wait("task-1", { timeoutMs: 5_000 });

    expect(registry.rejectAllForConnection("conn-1")).toBe(1);

    await expect(pending).rejects.toThrow(/disconnected/i);
    expect(registry.resolve("task-1", { ok: true })).toBe(false);
  });

  it("rejects waits when the associated connection closes before wait starts", async () => {
    vi.useFakeTimers();

    const registry = new TaskResultRegistry();
    registry.associate("task-1", "conn-1");
    registry.rejectAllForConnection("conn-1");

    const pending = registry.wait("task-1", { timeoutMs: 10 });
    const rejection = expect(pending).rejects.toThrow(/disconnected/i);

    await vi.advanceTimersByTimeAsync(11);

    await rejection;
  });
});
