import type { WsEventEnvelope } from "@tyrum/schemas";
import { describe, expect, it, vi } from "vitest";
import { MetricsRegistry } from "../../src/modules/observability/metrics.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { broadcastWsEvent } from "../../src/ws/broadcast.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

interface MockWebSocket {
  bufferedAmount: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  readyState: number;
  terminate: ReturnType<typeof vi.fn>;
}

function createMockWs(
  sendImpl?: (payload: string) => void,
  options?: { bufferedAmount?: number; readyState?: number },
): MockWebSocket {
  return {
    bufferedAmount: options?.bufferedAmount ?? 0,
    send: vi.fn(sendImpl ?? (() => undefined as never)),
    close: vi.fn(),
    on: vi.fn(() => undefined as never),
    readyState: options?.readyState ?? 1,
    terminate: vi.fn(),
  };
}

describe("broadcastWsEvent", () => {
  it("broadcasts to matching audience and enqueues cluster delivery", () => {
    const cm = new ConnectionManager();

    const allowed = createMockWs();
    const deniedByScope = createMockWs();
    const deniedByRole = createMockWs();

    cm.addClient(allowed as never, [], {
      role: "client",
      authClaims: {
        token_kind: "device",
        token_id: "token-allowed",
        tenant_id: DEFAULT_TENANT_ID,
        role: "client",
        scopes: ["operator.read"],
      },
    });
    cm.addClient(deniedByScope as never, [], {
      role: "client",
      authClaims: {
        token_kind: "device",
        token_id: "token-scope-denied",
        tenant_id: DEFAULT_TENANT_ID,
        role: "client",
        scopes: [],
      },
    });
    cm.addClient(deniedByRole as never, [], {
      role: "node",
      authClaims: {
        token_kind: "device",
        token_id: "token-role-denied",
        tenant_id: DEFAULT_TENANT_ID,
        role: "node",
        scopes: ["operator.read"],
      },
    });

    const evt: WsEventEnvelope = {
      event_id: "evt-1",
      type: "test.event",
      occurred_at: new Date().toISOString(),
      scope: { kind: "agent", agent_id: "default" },
      payload: { ok: true },
    } as WsEventEnvelope;

    const enqueue = vi.fn(async () => undefined as never);
    broadcastWsEvent(
      DEFAULT_TENANT_ID,
      evt,
      { connectionManager: cm, cluster: { edgeId: "edge-1", outboxDal: { enqueue } as never } },
      { roles: ["client"], required_scopes: ["operator.read"] },
    );

    expect(allowed.send).toHaveBeenCalledTimes(1);
    expect(deniedByScope.send).not.toHaveBeenCalled();
    expect(deniedByRole.send).not.toHaveBeenCalled();

    const sent = JSON.parse(String(allowed.send.mock.calls[0]?.[0]));
    expect(sent).toEqual(evt);

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      DEFAULT_TENANT_ID,
      "ws.broadcast",
      expect.objectContaining({
        source_edge_id: "edge-1",
        skip_local: true,
        message: evt,
        audience: { roles: ["client"], required_scopes: ["operator.read"] },
      }),
    );
  });

  it("ignores WebSocket send failures", () => {
    const cm = new ConnectionManager();
    const throwing = createMockWs(() => {
      throw new Error("send failed");
    });
    const ok = createMockWs();

    cm.addClient(throwing as never, [], {
      role: "client",
      authClaims: {
        token_kind: "admin",
        token_id: "token-throwing",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      },
    });
    cm.addClient(ok as never, [], {
      role: "client",
      authClaims: {
        token_kind: "admin",
        token_id: "token-ok",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      },
    });

    const evt: WsEventEnvelope = {
      event_id: "evt-2",
      type: "test.event",
      occurred_at: new Date().toISOString(),
      scope: { kind: "agent", agent_id: "default" },
      payload: { ok: true },
    } as WsEventEnvelope;

    expect(() => broadcastWsEvent(DEFAULT_TENANT_ID, evt, { connectionManager: cm })).not.toThrow();
    expect(ok.send).toHaveBeenCalledTimes(1);
  });

  it("evicts slow consumers and still delivers to healthy peers", async () => {
    const metrics = new MetricsRegistry();
    const cm = new ConnectionManager();
    const logger = { warn: vi.fn() };
    const slow = createMockWs(undefined, { bufferedAmount: 11 });
    const healthy = createMockWs();

    cm.addClient(slow as never, [], {
      id: "slow-client",
      role: "client",
      authClaims: {
        token_kind: "admin",
        token_id: "token-slow",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      },
    });
    cm.addClient(healthy as never, [], {
      id: "healthy-client",
      role: "client",
      authClaims: {
        token_kind: "admin",
        token_id: "token-healthy",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      },
    });

    const evt: WsEventEnvelope = {
      event_id: "evt-3",
      type: "test.event",
      occurred_at: new Date().toISOString(),
      scope: { kind: "agent", agent_id: "default" },
      payload: { ok: true },
    } as WsEventEnvelope;

    broadcastWsEvent(DEFAULT_TENANT_ID, evt, {
      connectionManager: cm,
      logger: logger as never,
      maxBufferedBytes: 10,
      metrics,
    });

    expect(slow.send).not.toHaveBeenCalled();
    expect(slow.close).toHaveBeenCalledWith(1013, "slow consumer");
    expect(healthy.send).toHaveBeenCalledTimes(1);
    expect(cm.getClient("slow-client")).toBeUndefined();
    expect(cm.getClient("healthy-client")).toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "ws.slow_consumer_evicted",
      expect.objectContaining({
        connection_id: "slow-client",
        delivery_mode: "local_broadcast",
        topic: "ws.broadcast",
      }),
    );
    await expect(
      metrics.registry.getSingleMetricAsString("ws_slow_consumer_evictions_total"),
    ).resolves.toMatch(/ws_slow_consumer_evictions_total\s+1(\s|$)/);
  });
});
