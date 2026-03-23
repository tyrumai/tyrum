/**
 * event-bus.ts — unit tests for the gateway typed event emitter.
 */

import { describe, expect, it, vi } from "vitest";
import { createEventBus } from "../../src/event-bus.js";

describe("createEventBus", () => {
  it("returns an emitter that delivers plan:completed events", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on("plan:completed", handler);
    bus.emit("plan:completed", { planId: "p1", stepsExecuted: 3 });
    expect(handler).toHaveBeenCalledWith({ planId: "p1", stepsExecuted: 3 });
  });

  it("returns an emitter that delivers plan:failed events", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on("plan:failed", handler);
    bus.emit("plan:failed", { planId: "p2", reason: "timeout" });
    expect(handler).toHaveBeenCalledWith({ planId: "p2", reason: "timeout" });
  });

  it("returns an emitter that delivers plan:escalated events", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on("plan:escalated", handler);
    bus.emit("plan:escalated", { planId: "p3", stepIndex: 5 });
    expect(handler).toHaveBeenCalledWith({ planId: "p3", stepIndex: 5 });
  });

  it("returns an emitter that delivers watcher:fired events", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on("watcher:fired", handler);
    bus.emit("watcher:fired", {
      watcherId: "w1",
      planId: "p4",
      triggerType: "webhook",
    });
    expect(handler).toHaveBeenCalledWith({
      watcherId: "w1",
      planId: "p4",
      triggerType: "webhook",
    });
  });

  it("does not call handler after unsubscribing", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on("plan:completed", handler);
    bus.off("plan:completed", handler);
    bus.emit("plan:completed", { planId: "p1", stepsExecuted: 1 });
    expect(handler).not.toHaveBeenCalled();
  });
});
