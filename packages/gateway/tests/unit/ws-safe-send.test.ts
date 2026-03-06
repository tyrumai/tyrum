import { describe, expect, it, vi } from "vitest";
import { MetricsRegistry } from "../../src/modules/observability/metrics.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import {
  DEFAULT_WS_MAX_BUFFERED_BYTES,
  WS_SLOW_CONSUMER_CLOSE_CODE,
  WS_SLOW_CONSUMER_CLOSE_REASON,
  safeSendWs,
} from "../../src/ws/safe-send.js";

interface MockWebSocket {
  bufferedAmount: number;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
}

function createMockWs(options?: {
  bufferedAmount?: number;
  readyState?: number;
  sendImpl?: (payload: string) => void;
}): MockWebSocket {
  return {
    bufferedAmount: options?.bufferedAmount ?? 0,
    close: vi.fn(),
    on: vi.fn(() => undefined as never),
    readyState: options?.readyState ?? 1,
    send: vi.fn(options?.sendImpl ?? (() => undefined as never)),
    terminate: vi.fn(),
  };
}

describe("safeSendWs", () => {
  it("evicts slow consumers before sending once buffered data exceeds the limit", async () => {
    const metrics = new MetricsRegistry();
    const connectionManager = new ConnectionManager();
    const logger = { warn: vi.fn() };
    const ws = createMockWs({ bufferedAmount: 11 });
    const id = connectionManager.addClient(ws as never, ["cli"], { id: "client-1" });
    const peer = connectionManager.getClient(id);

    expect(peer).toBeDefined();

    const delivered = safeSendWs(peer!, JSON.stringify({ ok: true }), {
      connectionManager,
      logger: logger as never,
      metrics,
      maxBufferedBytes: 10,
      topic: "ws.broadcast",
    });

    expect(delivered).toBe(false);
    expect(ws.send).not.toHaveBeenCalled();
    expect(ws.close).toHaveBeenCalledWith(
      WS_SLOW_CONSUMER_CLOSE_CODE,
      WS_SLOW_CONSUMER_CLOSE_REASON,
    );
    expect(connectionManager.getClient(id)).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "ws.slow_consumer_evicted",
      expect.objectContaining({
        buffered_amount: 11,
        connection_id: "client-1",
        max_buffered_bytes: 10,
        topic: "ws.broadcast",
      }),
    );
    await expect(
      metrics.registry.getSingleMetricAsString("ws_slow_consumer_evictions_total"),
    ).resolves.toMatch(/ws_slow_consumer_evictions_total\s+1(\s|$)/);
    await expect(
      metrics.registry.getSingleMetricAsString("ws_slow_consumer_buffered_amount_bytes"),
    ).resolves.toMatch(/ws_slow_consumer_buffered_amount_bytes_count\s+1(\s|$)/);
  });

  it("counts send failures without throwing", async () => {
    const metrics = new MetricsRegistry();
    const logger = { warn: vi.fn() };
    const ws = createMockWs({
      sendImpl: () => {
        throw new Error("send failed");
      },
    });
    const connectionManager = new ConnectionManager();
    const id = connectionManager.addClient(ws as never, ["cli"], { id: "client-1" });
    const peer = connectionManager.getClient(id);

    expect(peer).toBeDefined();

    const delivered = safeSendWs(peer!, JSON.stringify({ ok: true }), {
      connectionManager,
      logger: logger as never,
      metrics,
      sendFailureLogMessage: "outbox.ws_send_failed",
      topic: "ws.broadcast",
    });

    expect(delivered).toBe(false);
    expect(connectionManager.getClient(id)).toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "outbox.ws_send_failed",
      expect.objectContaining({
        connection_id: "client-1",
        error: "send failed",
        topic: "ws.broadcast",
      }),
    );
    await expect(
      metrics.registry.getSingleMetricAsString("ws_send_failures_total"),
    ).resolves.toMatch(/ws_send_failures_total\s+1(\s|$)/);
  });

  it("drops non-open peers without trying to send", () => {
    const connectionManager = new ConnectionManager();
    const ws = createMockWs({ readyState: 3 });
    const id = connectionManager.addClient(ws as never, ["cli"], { id: "client-1" });
    const peer = connectionManager.getClient(id);

    expect(peer).toBeDefined();

    const delivered = safeSendWs(peer!, JSON.stringify({ ok: true }), {
      connectionManager,
      maxBufferedBytes: DEFAULT_WS_MAX_BUFFERED_BYTES,
    });

    expect(delivered).toBe(false);
    expect(ws.send).not.toHaveBeenCalled();
    expect(connectionManager.getClient(id)).toBeUndefined();
  });
});
