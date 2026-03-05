import type { WsEventEnvelope } from "@tyrum/schemas";
import { describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { broadcastWsEvent } from "../../src/ws/broadcast.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

interface MockWebSocket {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  readyState: number;
}

function createMockWs(sendImpl?: (payload: string) => void): MockWebSocket {
  return {
    send: vi.fn(sendImpl ?? (() => undefined as never)),
    close: vi.fn(),
    on: vi.fn(() => undefined as never),
    readyState: 1,
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
});
