import { afterEach, describe, expect, it, vi } from "vitest";

import { TyrumClient } from "../src/ws-client.js";

vi.mock("undici", () => {
  const agents: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];

  class Agent {
    destroy = vi.fn(() => Promise.resolve());

    constructor(_opts: unknown) {
      agents.push(this);
    }
  }

  return { Agent, __agents: agents };
});

describe("TLS certificate pinning dispatcher cleanup", () => {
  const originalWebSocket = globalThis.WebSocket;

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    vi.restoreAllMocks();
  });

  it("destroys the undici Agent if the WebSocket constructor throws", async () => {
    class ThrowingWebSocket {
      constructor() {
        throw new Error("ctor boom");
      }
    }
    globalThis.WebSocket = ThrowingWebSocket as unknown as typeof WebSocket;

    const client = new TyrumClient({
      url: "wss://localhost:1234/ws",
      token: "test-token",
      capabilities: [],
      reconnect: false,
      tlsCertFingerprint256: "a".repeat(64),
    });

    const transportError = new Promise<{ message: string }>((resolve) => {
      client.on("transport_error", resolve);
    });

    client.connect();

    const err = await transportError;
    expect(err.message).toContain("ctor boom");

    const undici = (await import("undici")) as unknown as {
      __agents: Array<{ destroy: ReturnType<typeof vi.fn> }>;
    };
    expect(undici.__agents).toHaveLength(1);
    expect(undici.__agents[0].destroy).toHaveBeenCalledTimes(1);
  });
});
