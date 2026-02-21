import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutboxPoller } from "../../src/modules/backplane/outbox-poller.js";
import type { OutboxRow } from "../../src/modules/backplane/outbox-dal.js";

function createMockOutboxDal() {
  return {
    ensureConsumer: vi.fn<[string], Promise<void>>().mockResolvedValue(undefined),
    poll: vi.fn<[string, number], Promise<OutboxRow[]>>().mockResolvedValue([]),
    ackConsumerCursor: vi.fn<[string, number], Promise<void>>().mockResolvedValue(undefined),
    enqueue: vi.fn(),
  };
}

function createMockConnectionManager() {
  return {
    allClients: vi.fn().mockReturnValue([]),
    getClient: vi.fn().mockReturnValue(undefined),
  };
}

function createMockEventConsumer() {
  return {
    isDuplicate: vi.fn().mockReturnValue(false),
    size: 0,
  };
}

function makeBroadcastRow(id: number, message: unknown, extra?: { source_edge_id?: string; skip_local?: boolean }): OutboxRow {
  return {
    id,
    topic: "ws.broadcast",
    target_edge_id: null,
    payload: { message, ...extra },
    created_at: "2025-01-20T09:00:00.000Z",
  };
}

function makeDirectRow(id: number, connectionId: string, message: unknown): OutboxRow {
  return {
    id,
    topic: "ws.direct",
    target_edge_id: null,
    payload: { connection_id: connectionId, message },
    created_at: "2025-01-20T09:00:00.000Z",
  };
}

function makeGatewayEventRow(id: number, payload: unknown): OutboxRow {
  return {
    id,
    topic: "gateway.event",
    target_edge_id: null,
    payload,
    created_at: "2025-01-20T09:00:00.000Z",
  };
}

describe("OutboxPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("start / stop", () => {
    it("start() begins polling interval, stop() clears it", async () => {
      const dal = createMockOutboxDal();
      const cm = createMockConnectionManager();
      const poller = new OutboxPoller({
        consumerId: "edge-1",
        outboxDal: dal as never,
        connectionManager: cm as never,
        pollIntervalMs: 100,
      });

      poller.start();
      expect(dal.ensureConsumer).toHaveBeenCalledWith("edge-1");

      await vi.advanceTimersByTimeAsync(350);
      expect(dal.poll.mock.calls.length).toBeGreaterThanOrEqual(3);

      poller.stop();
      const callCount = dal.poll.mock.calls.length;
      await vi.advanceTimersByTimeAsync(300);
      expect(dal.poll.mock.calls.length).toBe(callCount);
    });
  });

  describe("tick", () => {
    it("processes ws.broadcast rows — sends to all clients", async () => {
      const dal = createMockOutboxDal();
      const sendA = vi.fn();
      const sendB = vi.fn();
      const cm = createMockConnectionManager();
      cm.allClients.mockReturnValue([
        { ws: { send: sendA } },
        { ws: { send: sendB } },
      ]);

      const row = makeBroadcastRow(1, { type: "event", data: "hello" });
      dal.poll.mockResolvedValueOnce([row]);

      const poller = new OutboxPoller({
        consumerId: "edge-1",
        outboxDal: dal as never,
        connectionManager: cm as never,
      });

      await poller.tick();

      const expected = JSON.stringify({ type: "event", data: "hello" });
      expect(sendA).toHaveBeenCalledWith(expected);
      expect(sendB).toHaveBeenCalledWith(expected);
    });

    it("processes ws.direct rows — sends to specific client", async () => {
      const dal = createMockOutboxDal();
      const sendFn = vi.fn();
      const cm = createMockConnectionManager();
      cm.getClient.mockReturnValue({ ws: { send: sendFn } });

      const row = makeDirectRow(2, "conn-42", { type: "reply", data: "hi" });
      dal.poll.mockResolvedValueOnce([row]);

      const poller = new OutboxPoller({
        consumerId: "edge-1",
        outboxDal: dal as never,
        connectionManager: cm as never,
      });

      await poller.tick();

      expect(cm.getClient).toHaveBeenCalledWith("conn-42");
      expect(sendFn).toHaveBeenCalledWith(JSON.stringify({ type: "reply", data: "hi" }));
    });

    it("handles gateway.event topic — calls onGatewayEvent", async () => {
      const dal = createMockOutboxDal();
      const cm = createMockConnectionManager();
      const onGatewayEvent = vi.fn();

      const row = makeGatewayEventRow(3, { kind: "test", value: 1 });
      dal.poll.mockResolvedValueOnce([row]);

      const poller = new OutboxPoller({
        consumerId: "edge-1",
        outboxDal: dal as never,
        connectionManager: cm as never,
        onGatewayEvent,
      });

      await poller.tick();

      expect(onGatewayEvent).toHaveBeenCalledWith({ kind: "test", value: 1 });
    });

    it("skips duplicate events when eventConsumer detects them", async () => {
      const dal = createMockOutboxDal();
      const sendFn = vi.fn();
      const cm = createMockConnectionManager();
      cm.allClients.mockReturnValue([{ ws: { send: sendFn } }]);
      const eventConsumer = createMockEventConsumer();
      eventConsumer.isDuplicate.mockReturnValue(true);

      const row = makeBroadcastRow(4, { type: "event", event_id: "dup-1" });
      dal.poll.mockResolvedValueOnce([row]);

      const poller = new OutboxPoller({
        consumerId: "edge-1",
        outboxDal: dal as never,
        connectionManager: cm as never,
        eventConsumer: eventConsumer as never,
      });

      await poller.tick();

      expect(sendFn).not.toHaveBeenCalled();
      // Still acks the cursor
      expect(dal.ackConsumerCursor).toHaveBeenCalledWith("edge-1", 4);
    });

    it("skips self-originated broadcast when skip_local is true", async () => {
      const dal = createMockOutboxDal();
      const sendFn = vi.fn();
      const cm = createMockConnectionManager();
      cm.allClients.mockReturnValue([{ ws: { send: sendFn } }]);

      const row = makeBroadcastRow(5, { type: "event" }, {
        source_edge_id: "edge-1",
        skip_local: true,
      });
      dal.poll.mockResolvedValueOnce([row]);

      const poller = new OutboxPoller({
        consumerId: "edge-1",
        outboxDal: dal as never,
        connectionManager: cm as never,
      });

      await poller.tick();

      expect(sendFn).not.toHaveBeenCalled();
    });

    it("acks cursor after processing each row", async () => {
      const dal = createMockOutboxDal();
      const cm = createMockConnectionManager();
      cm.allClients.mockReturnValue([{ ws: { send: vi.fn() } }]);

      const rows = [
        makeBroadcastRow(10, { type: "a" }),
        makeBroadcastRow(11, { type: "b" }),
      ];
      dal.poll.mockResolvedValueOnce(rows);

      const poller = new OutboxPoller({
        consumerId: "edge-1",
        outboxDal: dal as never,
        connectionManager: cm as never,
      });

      await poller.tick();

      expect(dal.ackConsumerCursor).toHaveBeenCalledWith("edge-1", 10);
      expect(dal.ackConsumerCursor).toHaveBeenCalledWith("edge-1", 11);
      expect(dal.ackConsumerCursor).toHaveBeenCalledTimes(2);
    });

    it("is reentrant-safe (skips if already ticking)", async () => {
      const dal = createMockOutboxDal();
      const cm = createMockConnectionManager();

      // Make poll hang until we resolve it
      let resolvePoll!: (rows: OutboxRow[]) => void;
      dal.poll.mockReturnValueOnce(
        new Promise<OutboxRow[]>((resolve) => {
          resolvePoll = resolve;
        }),
      );

      const poller = new OutboxPoller({
        consumerId: "edge-1",
        outboxDal: dal as never,
        connectionManager: cm as never,
      });

      const first = poller.tick();
      // Second tick should bail out immediately because ticking is true
      await poller.tick();

      expect(dal.poll).toHaveBeenCalledTimes(1);

      resolvePoll([]);
      await first;
    });

    it("handles empty poll result gracefully", async () => {
      const dal = createMockOutboxDal();
      const cm = createMockConnectionManager();
      dal.poll.mockResolvedValueOnce([]);

      const poller = new OutboxPoller({
        consumerId: "edge-1",
        outboxDal: dal as never,
        connectionManager: cm as never,
      });

      await expect(poller.tick()).resolves.toBeUndefined();
      expect(dal.ackConsumerCursor).not.toHaveBeenCalled();
    });
  });
});
