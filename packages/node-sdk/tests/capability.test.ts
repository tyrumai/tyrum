import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import type { WebSocket as WsWebSocket } from "ws";
import { TyrumClient } from "@tyrum/transport-sdk";
import { autoExecute } from "../src/capability.js";
import type { CapabilityProvider, TaskExecuteContext } from "../src/capability.js";

type TaskExecuteMessage = {
  request_id: string;
  payload: {
    turn_id?: string;
    dispatch_id: string;
    action: {
      type: string;
      args: Record<string, unknown>;
    };
  };
};

class FakeAutoExecuteClient implements Pick<TyrumClient, "on" | "respondTaskExecute"> {
  respondTaskExecute = vi.fn();
  private handler: ((msg: TaskExecuteMessage) => void) | undefined;

  on(event: string, handler: (msg: TaskExecuteMessage) => void): void {
    expect(event).toBe("task_execute");
    this.handler = handler;
  }

  dispatch(message: TaskExecuteMessage): void {
    if (!this.handler) {
      throw new Error("task_execute handler not registered");
    }
    this.handler(message);
  }
}

function makeTaskExecuteMessage(
  action: TaskExecuteMessage["payload"]["action"],
  overrides?: Partial<TaskExecuteMessage>,
): TaskExecuteMessage {
  return {
    request_id: overrides?.request_id ?? "t-1",
    payload: {
      turn_id: "550e8400-e29b-41d4-a716-446655440000",
      dispatch_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      action,
      ...overrides?.payload,
    },
  };
}

async function flushAsyncDispatch(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForRespondTaskCalls(
  respondTaskExecute: { mock: { calls: unknown[] } },
  count: number,
): Promise<void> {
  await vi.waitFor(() => {
    expect(respondTaskExecute.mock.calls).toHaveLength(count);
  });
}

function createTestServer(): {
  wss: WebSocketServer;
  url: string;
  close: () => Promise<void>;
  waitForClient: () => Promise<WsWebSocket>;
} {
  const wss = new WebSocketServer({ port: 0 });
  const addr = wss.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  const url = `ws://127.0.0.1:${port}`;

  const clientWaiters: Array<(ws: WsWebSocket) => void> = [];
  const pendingClients: WsWebSocket[] = [];

  wss.on("connection", (ws) => {
    const waiter = clientWaiters.shift();
    if (waiter) {
      waiter(ws);
    } else {
      pendingClients.push(ws);
    }
  });

  function waitForClient(): Promise<WsWebSocket> {
    const pending = pendingClients.shift();
    if (pending) return Promise.resolve(pending);
    return new Promise<WsWebSocket>((resolve) => {
      clientWaiters.push(resolve);
    });
  }

  async function close(): Promise<void> {
    return new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
  }

  return { wss, url, close, waitForClient };
}

function waitForMessage(ws: WsWebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once("message", (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

async function acceptConnect(ws: WsWebSocket, clientId = "client-1"): Promise<void> {
  const init = (await waitForMessage(ws)) as Record<string, unknown>;
  expect(init["type"]).toBe("connect.init");
  ws.send(
    JSON.stringify({
      request_id: String(init["request_id"]),
      type: "connect.init",
      ok: true,
      result: { connection_id: "conn-1", challenge: "nonce-1" },
    }),
  );

  const proof = (await waitForMessage(ws)) as Record<string, unknown>;
  expect(proof["type"]).toBe("connect.proof");
  ws.send(
    JSON.stringify({
      request_id: String(proof["request_id"]),
      type: "connect.proof",
      ok: true,
      result: { client_id: clientId, device_id: "device-1", role: "client" },
    }),
  );
}

describe("autoExecute", () => {
  let server: ReturnType<typeof createTestServer> | undefined;
  let client: TyrumClient | undefined;

  afterEach(async () => {
    client?.disconnect();
    client = undefined;
    if (server) {
      await server.close();
      server = undefined;
    }
  });

  it("routes task.execute to matching provider and sends response", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["desktop"],
      reconnect: false,
    });

    const expectedContext = {
      requestId: "t-1",
      turnId: "550e8400-e29b-41d4-a716-446655440000",
      dispatchId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
    } satisfies TaskExecuteContext;
    const desktopProvider: CapabilityProvider = {
      capability: "desktop",
      execute: async (action, ctx?: TaskExecuteContext) => {
        expect(action.type).toBe("Desktop");
        expect(ctx).toEqual(expectedContext);
        return {
          success: true,
          evidence: { screenshot: "base64..." },
        };
      },
    };

    autoExecute(client, [desktopProvider]);

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);

    ws.send(
      JSON.stringify({
        request_id: "t-1",
        type: "task.execute",
        payload: {
          turn_id: expectedContext.turnId,
          dispatch_id: expectedContext.dispatchId,
          action: { type: "Desktop", args: { op: "screenshot" } },
        },
      }),
    );

    const result = await waitForMessage(ws);
    expect(result).toEqual({
      request_id: "t-1",
      type: "task.execute",
      ok: true,
      result: { evidence: { screenshot: "base64..." } },
    });
  });

  it("routes actions through explicit capabilityIds when they are provided", async () => {
    const fakeClient = new FakeAutoExecuteClient();
    const execute = vi.fn(
      async (action: { type: string; args: Record<string, unknown> }, ctx?: TaskExecuteContext) => {
        expect(action).toEqual({ type: "Desktop", args: { op: "screenshot" } });
        expect(ctx).toEqual({
          requestId: "t-1",
          turnId: "550e8400-e29b-41d4-a716-446655440000",
          dispatchId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        });
        return { success: true, result: { ok: true } };
      },
    );
    const provider: CapabilityProvider = {
      capabilityIds: ["tyrum.desktop.screenshot"],
      execute,
    };

    autoExecute(fakeClient, [provider]);
    fakeClient.dispatch(makeTaskExecuteMessage({ type: "Desktop", args: { op: "screenshot" } }));
    await waitForRespondTaskCalls(fakeClient.respondTaskExecute, 1);

    expect(execute).toHaveBeenCalledOnce();
    expect(fakeClient.respondTaskExecute).toHaveBeenCalledWith(
      "t-1",
      true,
      { ok: true },
      undefined,
      undefined,
    );
  });

  it("prefers capabilityIds over deprecated capability when both are present", async () => {
    const fakeClient = new FakeAutoExecuteClient();
    const execute = vi.fn();
    const provider: CapabilityProvider = {
      capability: "desktop",
      capabilityIds: ["tyrum.browser.navigate"],
      execute,
    };

    autoExecute(fakeClient, [provider]);
    fakeClient.dispatch(makeTaskExecuteMessage({ type: "Desktop", args: { op: "screenshot" } }));
    await flushAsyncDispatch();

    expect(execute).not.toHaveBeenCalled();
    expect(fakeClient.respondTaskExecute).toHaveBeenCalledWith(
      "t-1",
      false,
      undefined,
      undefined,
      "no provider for capability: tyrum.desktop.screenshot",
    );
  });

  it("fails when no provider matches the required capability", async () => {
    const fakeClient = new FakeAutoExecuteClient();

    autoExecute(fakeClient, []);
    fakeClient.dispatch(makeTaskExecuteMessage({ type: "Desktop", args: { op: "screenshot" } }));
    await flushAsyncDispatch();

    expect(fakeClient.respondTaskExecute).toHaveBeenCalledWith(
      "t-1",
      false,
      undefined,
      undefined,
      "no provider for capability: tyrum.desktop.screenshot",
    );
  });

  it("returns provider errors as failed task responses", async () => {
    const fakeClient = new FakeAutoExecuteClient();
    const provider: CapabilityProvider = {
      capability: "desktop",
      execute: vi.fn(async () => {
        throw new Error("desktop unavailable");
      }),
    };

    autoExecute(fakeClient, [provider]);
    fakeClient.dispatch(makeTaskExecuteMessage({ type: "Desktop", args: { op: "screenshot" } }));
    await waitForRespondTaskCalls(fakeClient.respondTaskExecute, 1);

    expect(fakeClient.respondTaskExecute).toHaveBeenCalledWith(
      "t-1",
      false,
      undefined,
      undefined,
      "desktop unavailable",
    );
  });

  it("passes through unsuccessful task results unchanged", async () => {
    const fakeClient = new FakeAutoExecuteClient();
    const provider: CapabilityProvider = {
      capability: "desktop",
      execute: vi.fn(async () => ({
        success: false,
        evidence: { reason: "operator-denied" },
        error: "approval required",
      })),
    };

    autoExecute(fakeClient, [provider]);
    fakeClient.dispatch(makeTaskExecuteMessage({ type: "Desktop", args: { op: "screenshot" } }));
    await waitForRespondTaskCalls(fakeClient.respondTaskExecute, 1);

    expect(fakeClient.respondTaskExecute).toHaveBeenCalledWith(
      "t-1",
      false,
      undefined,
      { reason: "operator-denied" },
      "approval required",
    );
  });

  it("attempts a fallback failure response when serialization fails", async () => {
    const fakeClient = new FakeAutoExecuteClient();
    fakeClient.respondTaskExecute
      .mockImplementationOnce(() => {
        throw new Error("serialize failed");
      })
      .mockImplementationOnce(() => undefined);

    const provider: CapabilityProvider = {
      capability: "desktop",
      execute: vi.fn(async () => ({
        success: true,
        result: { answer: 42 },
      })),
    };

    autoExecute(fakeClient, [provider]);
    fakeClient.dispatch(makeTaskExecuteMessage({ type: "Desktop", args: { op: "screenshot" } }));
    await waitForRespondTaskCalls(fakeClient.respondTaskExecute, 2);

    expect(fakeClient.respondTaskExecute).toHaveBeenCalledTimes(2);
    expect(fakeClient.respondTaskExecute).toHaveBeenNthCalledWith(
      2,
      "t-1",
      false,
      undefined,
      undefined,
      "task.execute response serialization failed: serialize failed",
    );
  });

  it("swallows a fallback serialization failure", async () => {
    const fakeClient = new FakeAutoExecuteClient();
    fakeClient.respondTaskExecute.mockImplementation(() => {
      throw new Error("still broken");
    });

    const provider: CapabilityProvider = {
      capability: "desktop",
      execute: vi.fn(async () => ({
        success: true,
        result: { ok: true },
      })),
    };

    autoExecute(fakeClient, [provider]);

    expect(() => {
      fakeClient.dispatch(makeTaskExecuteMessage({ type: "Desktop", args: { op: "screenshot" } }));
    }).not.toThrow();

    await waitForRespondTaskCalls(fakeClient.respondTaskExecute, 2);
    expect(fakeClient.respondTaskExecute).toHaveBeenCalledTimes(2);
  });
});
