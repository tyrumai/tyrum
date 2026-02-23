import { describe, expect, it, vi } from "vitest";

interface MockWebSocket {
  send: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  readyState: number;
}

function createMockWs(): MockWebSocket {
  return {
    send: vi.fn(),
    ping: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn(),
    readyState: 1, // OPEN
  };
}

describe("gateway dist bundle", () => {
  it("uses WS ping/pong control frames for heartbeats (regression for /app/live disconnects)", async () => {
    const mod = await import(
      new URL("../../dist/index.mjs", import.meta.url).href
    );
    const ConnectionManager = mod.ConnectionManager as {
      new (): {
        addClient: (ws: unknown, capabilities: unknown[]) => string;
        heartbeat: () => void;
      };
    };

    const cm = new ConnectionManager();
    const ws = createMockWs();
    cm.addClient(ws as never, []);

    cm.heartbeat();

    expect(ws.ping).toHaveBeenCalledOnce();
    expect(ws.send).not.toHaveBeenCalled();
  });
});
