import { describe, expect, it, vi } from "vitest";
import { createBearerTokenAuth, createOperatorCore } from "../src/index.js";

type Handler = (data: unknown) => void;

class FakeWsClient {
  private readonly handlers = new Map<string, Set<Handler>>();

  connect = vi.fn(() => {});
  disconnect = vi.fn(() => {});

  on(event: string, handler: Handler): void {
    const existing = this.handlers.get(event);
    if (existing) {
      existing.add(handler);
      return;
    }
    this.handlers.set(event, new Set([handler]));
  }

  off(event: string, handler: Handler): void {
    const existing = this.handlers.get(event);
    if (!existing) return;
    existing.delete(handler);
    if (existing.size === 0) {
      this.handlers.delete(event);
    }
  }

  emit(event: string, data: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(data);
    }
  }
}

function createFakeHttpClient() {
  return {
    status: { get: vi.fn(async () => ({ status: "ok" })) },
    usage: { get: vi.fn(async () => ({ status: "ok" })) },
    presence: { list: vi.fn(async () => ({ status: "ok", entries: [] })) },
    pairings: { list: vi.fn(async () => ({ status: "ok", pairings: [] })) },
  } as any;
}

describe("connection recovery grace", () => {
  it("enters recovering connecting state on transient disconnect, then finalizes to disconnected after grace", () => {
    vi.useFakeTimers();
    try {
      const ws = new FakeWsClient();
      const http = createFakeHttpClient();
      const core = createOperatorCore({
        wsUrl: "ws://example.test/ws",
        httpBaseUrl: "http://example.test",
        auth: createBearerTokenAuth("test-token"),
        deps: { ws: ws as any, http },
      });

      core.connect();
      ws.emit("connected", { clientId: "client-123" });

      ws.emit("disconnected", { code: 1006, reason: "net down" });
      expect(core.connectionStore.getSnapshot().status).toBe("connecting");
      expect(core.connectionStore.getSnapshot().recovering).toBe(true);

      vi.advanceTimersByTime(10_001);
      expect(core.connectionStore.getSnapshot().status).toBe("disconnected");
      expect(core.connectionStore.getSnapshot().recovering).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not finalize to disconnected if reconnect completes within grace", () => {
    vi.useFakeTimers();
    try {
      const ws = new FakeWsClient();
      const http = createFakeHttpClient();
      const core = createOperatorCore({
        wsUrl: "ws://example.test/ws",
        httpBaseUrl: "http://example.test",
        auth: createBearerTokenAuth("test-token"),
        deps: { ws: ws as any, http },
      });

      core.connect();
      ws.emit("connected", { clientId: "client-123" });

      ws.emit("disconnected", { code: 1006, reason: "net down" });
      expect(core.connectionStore.getSnapshot()).toMatchObject({
        status: "connecting",
        recovering: true,
      });

      ws.emit("connected", { clientId: "client-123" });
      expect(core.connectionStore.getSnapshot()).toMatchObject({
        status: "connected",
        recovering: false,
      });

      vi.advanceTimersByTime(60_000);
      expect(core.connectionStore.getSnapshot()).toMatchObject({
        status: "connected",
        recovering: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats terminal close codes as immediately disconnected (no grace)", () => {
    vi.useFakeTimers();
    try {
      const ws = new FakeWsClient();
      const http = createFakeHttpClient();
      const core = createOperatorCore({
        wsUrl: "ws://example.test/ws",
        httpBaseUrl: "http://example.test",
        auth: createBearerTokenAuth("test-token"),
        deps: { ws: ws as any, http },
      });

      core.connect();
      ws.emit("connected", { clientId: "client-123" });

      ws.emit("disconnected", { code: 4001, reason: "unauthorized" });
      expect(core.connectionStore.getSnapshot()).toMatchObject({
        status: "disconnected",
        recovering: false,
      });

      vi.advanceTimersByTime(60_000);
      expect(core.connectionStore.getSnapshot()).toMatchObject({
        status: "disconnected",
        recovering: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not record reconnect schedule after terminal disconnect", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const ws = new FakeWsClient();
      const http = createFakeHttpClient();
      const core = createOperatorCore({
        wsUrl: "ws://example.test/ws",
        httpBaseUrl: "http://example.test",
        auth: createBearerTokenAuth("test-token"),
        deps: { ws: ws as any, http },
      });

      core.connect();
      ws.emit("connected", { clientId: "client-123" });

      ws.emit("disconnected", { code: 4001, reason: "unauthorized" });
      const nextRetryAtMs = Date.now() + 12_000;
      ws.emit("reconnect_scheduled", { delayMs: 12_000, nextRetryAtMs, attempt: 1 });

      expect(core.connectionStore.getSnapshot()).toMatchObject({
        status: "disconnected",
        recovering: false,
        nextRetryAtMs: null,
        lastDisconnect: { code: 4001, reason: "unauthorized" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not re-enter recovering after grace has finalized to disconnected", () => {
    vi.useFakeTimers();
    try {
      const ws = new FakeWsClient();
      const http = createFakeHttpClient();
      const core = createOperatorCore({
        wsUrl: "ws://example.test/ws",
        httpBaseUrl: "http://example.test",
        auth: createBearerTokenAuth("test-token"),
        deps: { ws: ws as any, http },
      });

      core.connect();
      ws.emit("connected", { clientId: "client-123" });

      ws.emit("disconnected", { code: 1006, reason: "net down" });
      expect(core.connectionStore.getSnapshot()).toMatchObject({
        status: "connecting",
        recovering: true,
      });

      vi.advanceTimersByTime(10_001);
      expect(core.connectionStore.getSnapshot()).toMatchObject({
        status: "disconnected",
        recovering: false,
      });

      ws.emit("disconnected", { code: 1006, reason: "still down" });
      expect(core.connectionStore.getSnapshot()).toMatchObject({
        status: "connecting",
        recovering: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("records next retry timing for gated reconnect UX", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const ws = new FakeWsClient();
      const http = createFakeHttpClient();
      const core = createOperatorCore({
        wsUrl: "ws://example.test/ws",
        httpBaseUrl: "http://example.test",
        auth: createBearerTokenAuth("test-token"),
        deps: { ws: ws as any, http },
      });

      core.connect();
      ws.emit("connected", { clientId: "client-123" });

      ws.emit("disconnected", { code: 1006, reason: "net down" });
      const nextRetryAtMs = Date.now() + 12_000;
      ws.emit("reconnect_scheduled", { delayMs: 12_000, nextRetryAtMs, attempt: 1 });

      expect(core.connectionStore.getSnapshot()).toMatchObject({
        status: "connecting",
        recovering: true,
        nextRetryAtMs,
      });

      vi.advanceTimersByTime(10_001);
      expect(core.connectionStore.getSnapshot()).toMatchObject({
        status: "disconnected",
        recovering: false,
        nextRetryAtMs,
      });

      ws.emit("connected", { clientId: "client-123" });
      expect(core.connectionStore.getSnapshot()).toMatchObject({
        status: "connected",
        recovering: false,
        nextRetryAtMs: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps disconnected state after intentional disconnect close event", () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws: ws as any, http },
    });

    core.connect();
    ws.emit("connected", { clientId: "client-123" });
    expect(core.connectionStore.getSnapshot()).toMatchObject({
      status: "connected",
      recovering: false,
    });

    core.disconnect();
    expect(core.connectionStore.getSnapshot()).toMatchObject({
      status: "disconnected",
      recovering: false,
    });

    // Simulate the async close event emitted after ws.disconnect().
    ws.emit("disconnected", { code: 1000, reason: "client disconnect" });
    expect(core.connectionStore.getSnapshot()).toMatchObject({
      status: "disconnected",
      recovering: false,
    });
  });
});
