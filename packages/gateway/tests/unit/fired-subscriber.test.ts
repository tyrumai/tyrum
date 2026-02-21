import { describe, expect, it, vi } from "vitest";
import { WatcherFiredSubscriber } from "../../src/modules/watcher/fired-subscriber.js";
import type { GatewayEvents } from "../../src/event-bus.js";

// mitt's CJS/ESM interop: replicate what the codebase does.
import * as mittNs from "mitt";
const mitt = (
  typeof mittNs.default === "function" ? mittNs.default : mittNs
) as unknown as <T extends Record<string, unknown>>() => import("mitt").Emitter<T>;

function createEventBus() {
  return mitt<GatewayEvents>();
}

function createMockDb() {
  return {
    run: vi.fn<[string, unknown[]], Promise<{ changes: number }>>().mockResolvedValue({ changes: 1 }),
  };
}

function createMockEngine() {
  return {
    enqueuePlan: vi.fn<[unknown], Promise<void>>().mockResolvedValue(undefined),
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

function makeFiringEvent(overrides?: Partial<GatewayEvents["watcher:fired"]>): GatewayEvents["watcher:fired"] {
  return {
    watcherId: 1,
    planId: "plan-abc",
    triggerType: "schedule",
    firingId: "firing-001",
    ...overrides,
  };
}

describe("WatcherFiredSubscriber", () => {
  it("start() subscribes to watcher:fired events", async () => {
    const eventBus = createEventBus();
    const db = createMockDb();
    const engine = createMockEngine();

    const subscriber = new WatcherFiredSubscriber({
      db: db as never,
      eventBus,
      engine: engine as never,
    });

    subscriber.start();
    eventBus.emit("watcher:fired", makeFiringEvent());

    // Allow the async handler to run
    await vi.waitFor(() => {
      expect(engine.enqueuePlan).toHaveBeenCalledTimes(1);
    });

    subscriber.stop();
  });

  it("stop() unsubscribes from events", async () => {
    const eventBus = createEventBus();
    const db = createMockDb();
    const engine = createMockEngine();

    const subscriber = new WatcherFiredSubscriber({
      db: db as never,
      eventBus,
      engine: engine as never,
    });

    subscriber.start();
    subscriber.stop();

    eventBus.emit("watcher:fired", makeFiringEvent());

    // Give a tick for the handler to potentially fire
    await new Promise((r) => setTimeout(r, 10));
    expect(engine.enqueuePlan).not.toHaveBeenCalled();
  });

  it("enqueues plan on watcher:fired event", async () => {
    const eventBus = createEventBus();
    const db = createMockDb();
    const engine = createMockEngine();

    const subscriber = new WatcherFiredSubscriber({
      db: db as never,
      eventBus,
      engine: engine as never,
    });

    subscriber.start();
    eventBus.emit("watcher:fired", makeFiringEvent({ watcherId: 7, planId: "plan-xyz", firingId: "f-99" }));

    await vi.waitFor(() => {
      expect(engine.enqueuePlan).toHaveBeenCalledWith({
        key: "watcher-7",
        lane: "watcher",
        planId: "plan-xyz",
        requestId: "f-99",
        steps: [],
      });
    });

    subscriber.stop();
  });

  it("updates firing status to 'enqueued' on success", async () => {
    const eventBus = createEventBus();
    const db = createMockDb();
    const engine = createMockEngine();

    const subscriber = new WatcherFiredSubscriber({
      db: db as never,
      eventBus,
      engine: engine as never,
    });

    subscriber.start();
    eventBus.emit("watcher:fired", makeFiringEvent({ firingId: "f-200" }));

    await vi.waitFor(() => {
      expect(db.run).toHaveBeenCalledWith(
        `UPDATE watcher_firings SET status = 'enqueued' WHERE firing_id = ?`,
        ["f-200"],
      );
    });

    subscriber.stop();
  });

  it("updates firing status to 'failed' on engine error", async () => {
    const eventBus = createEventBus();
    const db = createMockDb();
    const engine = createMockEngine();
    const logger = createMockLogger();

    engine.enqueuePlan.mockRejectedValue(new Error("engine down"));

    const subscriber = new WatcherFiredSubscriber({
      db: db as never,
      eventBus,
      engine: engine as never,
      logger: logger as never,
    });

    subscriber.start();
    eventBus.emit("watcher:fired", makeFiringEvent({ firingId: "f-fail" }));

    await vi.waitFor(() => {
      expect(db.run).toHaveBeenCalledWith(
        `UPDATE watcher_firings SET status = 'failed' WHERE firing_id = ?`,
        ["f-fail"],
      );
    });

    expect(logger.error).toHaveBeenCalledWith(
      "watcher.firing_enqueue_failed",
      expect.objectContaining({ error: "engine down" }),
    );

    subscriber.stop();
  });

  it("ignores events without firingId", async () => {
    const eventBus = createEventBus();
    const db = createMockDb();
    const engine = createMockEngine();

    const subscriber = new WatcherFiredSubscriber({
      db: db as never,
      eventBus,
      engine: engine as never,
    });

    subscriber.start();
    eventBus.emit("watcher:fired", makeFiringEvent({ firingId: undefined }));

    // Give the async handler time to run
    await new Promise((r) => setTimeout(r, 10));
    expect(engine.enqueuePlan).not.toHaveBeenCalled();

    subscriber.stop();
  });
});
