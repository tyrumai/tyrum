import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
} from "@tyrum/schemas";
import { TyrumClient } from "../src/ws-client.js";
import {
  type TestServer,
  createTestServer,
  waitForMessage,
  acceptConnect,
  delay,
  withTimeout,
  waitForReconnectScheduled,
} from "./ws-client.test-support.js";

export function registerReconnectTests(fixture: {
  getServer: () => TestServer | undefined;
  setServer: (s: TestServer) => void;
  getClient: () => TyrumClient | undefined;
  setClient: (c: TyrumClient) => void;
}): void {
  it("disconnects cleanly", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
    });
    fixture.setClient(client);

    const connectedP = new Promise<void>((resolve) => {
      client.on("connected", () => resolve());
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await connectedP;

    expect(client.connected).toBe(true);
    client.disconnect();
    // After disconnect the property should reflect closed state
    expect(client.connected).toBe(false);
  });

  it("emits disconnected event with code and reason", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
    });
    fixture.setClient(client);

    const disconnectedP = new Promise<{ code: number; reason: string }>((resolve) => {
      client.on("disconnected", resolve);
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);

    // Server-initiated close
    ws.close(4100, "test-close");

    const disconnectInfo = await disconnectedP;
    expect(disconnectInfo.code).toBe(4100);
    expect(disconnectInfo.reason).toBe("test-close");
  });

  it("reconnects after unexpected close", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["cli"],
      reconnect: true,
      maxReconnectDelay: 500,
    });
    fixture.setClient(client);

    client.connect();
    const ws1 = await server.waitForClient();
    const connect1 = (await waitForMessage(ws1)) as Record<string, unknown>;
    expect(connect1["type"]).toBe("connect.init");
    expect(connect1["payload"]).toEqual(
      expect.objectContaining({
        protocol_rev: 2,
        role: "client",
        capabilities: [
          {
            id: descriptorIdForClientCapability("cli"),
            version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
          },
        ],
      }),
    );
    ws1.send(
      JSON.stringify({
        request_id: String(connect1["request_id"]),
        type: "connect.init",
        ok: true,
        result: { connection_id: "conn-1", challenge: "nonce-1" },
      }),
    );
    const proof1 = (await waitForMessage(ws1)) as Record<string, unknown>;
    expect(proof1["type"]).toBe("connect.proof");
    ws1.send(
      JSON.stringify({
        request_id: String(proof1["request_id"]),
        type: "connect.proof",
        ok: true,
        result: { client_id: "client-1", device_id: "dev-1", role: "client" },
      }),
    );

    // Force-close from server (1001 = "going away" — 1006 is reserved)
    ws1.close(1001, "gone");

    // Client should reconnect — wait for a second connection
    const ws2 = await server.waitForClient();
    const connect2 = (await waitForMessage(ws2)) as Record<string, unknown>;
    expect(connect2["type"]).toBe("connect.init");
    expect(connect2["payload"]).toEqual(
      expect.objectContaining({
        protocol_rev: 2,
        role: "client",
        capabilities: [
          {
            id: descriptorIdForClientCapability("cli"),
            version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
          },
        ],
      }),
    );
    ws2.send(
      JSON.stringify({
        request_id: String(connect2["request_id"]),
        type: "connect.init",
        ok: true,
        result: { connection_id: "conn-2", challenge: "nonce-2" },
      }),
    );
    const proof2 = (await waitForMessage(ws2)) as Record<string, unknown>;
    expect(proof2["type"]).toBe("connect.proof");
    ws2.send(
      JSON.stringify({
        request_id: String(proof2["request_id"]),
        type: "connect.proof",
        ok: true,
        result: { client_id: "client-2", device_id: "dev-2", role: "client" },
      }),
    );
  });

  it("schedules exponential reconnect backoff with jitter up to maxReconnectDelay", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: true,
      reconnectBaseDelayMs: 4,
      maxReconnectDelay: 10,
    });
    fixture.setClient(client);

    client.connect();
    const ws1 = await server.waitForClient();
    await acceptConnect(ws1);

    const reconnect1 = waitForReconnectScheduled(client);
    ws1.close(1001, "gone");
    const reconnectSchedule1 = await withTimeout(reconnect1, 2_000, "reconnect_scheduled 1");
    expect(reconnectSchedule1.delayMs).toBe(2);
    expect(reconnectSchedule1.attempt).toBe(1);
    expect(reconnectSchedule1.nextRetryAtMs).toBeGreaterThan(Date.now());

    const ws2 = await withTimeout(server.waitForClient(), 2_000, "ws2 reconnect");
    const reconnect2 = waitForReconnectScheduled(client);
    ws2.close(1001, "gone again");
    const reconnectSchedule2 = await withTimeout(reconnect2, 2_000, "reconnect_scheduled 2");
    expect(reconnectSchedule2.delayMs).toBe(4);
    expect(reconnectSchedule2.attempt).toBe(2);
    expect(reconnectSchedule2.nextRetryAtMs).toBeGreaterThan(Date.now());

    const ws3 = await withTimeout(server.waitForClient(), 2_000, "ws3 reconnect");
    const reconnect3 = waitForReconnectScheduled(client);
    ws3.close(1001, "gone once more");
    const reconnectSchedule3 = await withTimeout(reconnect3, 2_000, "reconnect_scheduled 3");
    expect(reconnectSchedule3.delayMs).toBe(5);
    expect(reconnectSchedule3.attempt).toBe(3);
    expect(reconnectSchedule3.nextRetryAtMs).toBeGreaterThan(Date.now());
  });

  it("resets reconnect backoff after an intentional reconnect", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: true,
      reconnectBaseDelayMs: 20,
      maxReconnectDelay: 100,
    });
    fixture.setClient(client);

    client.connect();
    const ws1 = await server.waitForClient();
    await acceptConnect(ws1);

    const reconnect1 = waitForReconnectScheduled(client);
    ws1.close(1001, "gone");
    const reconnectSchedule1 = await withTimeout(reconnect1, 2_000, "reconnect_scheduled 1");
    expect(reconnectSchedule1.delayMs).toBe(10);
    expect(reconnectSchedule1.attempt).toBe(1);

    const ws2 = await withTimeout(server.waitForClient(), 2_000, "ws2 reconnect");
    const reconnect2 = waitForReconnectScheduled(client);
    ws2.close(1001, "gone again");
    const reconnectSchedule2 = await withTimeout(reconnect2, 2_000, "reconnect_scheduled 2");
    expect(reconnectSchedule2.delayMs).toBe(20);
    expect(reconnectSchedule2.attempt).toBe(2);

    client.disconnect();
    client.connect();

    const ws3 = await withTimeout(server.waitForClient(), 2_000, "ws3 reconnect");
    const reconnect3 = waitForReconnectScheduled(client);
    ws3.close(1001, "gone after manual reconnect");
    const reconnectSchedule3 = await withTimeout(reconnect3, 2_000, "reconnect_scheduled 3");
    expect(reconnectSchedule3.delayMs).toBe(10);
    expect(reconnectSchedule3.attempt).toBe(1);
  });

  it("does not reconnect after a terminal close code and emits an actionable transport error", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: true,
    });
    fixture.setClient(client);

    const scheduleSpy = vi.spyOn(
      client as unknown as { scheduleReconnect: () => void },
      "scheduleReconnect",
    );
    const disconnectedP = new Promise<{ code: number; reason: string }>((resolve) => {
      client.on("disconnected", resolve);
    });
    const transportErrorP = new Promise<{ message: string }>((resolve) => {
      client.on("transport_error", resolve);
    });

    client.connect();
    const ws = await server.waitForClient();
    ws.close(4005, "protocol_rev mismatch");

    const disconnected = await withTimeout(disconnectedP, 2_000, "disconnected");
    const transportError = await withTimeout(transportErrorP, 2_000, "transport_error");

    expect(disconnected).toEqual({ code: 4005, reason: "protocol_rev mismatch" });
    expect(transportError.message).toContain("4005");
    expect(transportError.message).toContain("protocol_rev mismatch");
    expect(scheduleSpy).not.toHaveBeenCalled();
  });

  it.each([
    { token: "t", shouldReconnect: false },
    { token: "", shouldReconnect: true },
  ])(
    "treats unauthorized close as terminal only when token is configured (token=%j)",
    async ({ token, shouldReconnect }) => {
      const server = createTestServer();
      fixture.setServer(server);
      const client = new TyrumClient({
        url: server.url,
        token,
        capabilities: [],
        reconnect: true,
        maxReconnectDelay: 25,
      });
      fixture.setClient(client);

      const scheduleSpy = vi.spyOn(
        client as unknown as { scheduleReconnect: () => void },
        "scheduleReconnect",
      );

      client.connect();
      const ws1 = await server.waitForClient();

      let reconnectScheduledP:
        | Promise<{ delayMs: number; nextRetryAtMs: number; attempt: number }>
        | undefined;
      if (shouldReconnect) {
        reconnectScheduledP = new Promise((resolve) => {
          client.on("reconnect_scheduled", resolve);
        });
      }

      let transportErrorP: Promise<{ message: string }> | undefined;
      if (!shouldReconnect) {
        transportErrorP = new Promise((resolve) => {
          client.on("transport_error", resolve);
        });
      }

      ws1.close(4001, "unauthorized");

      if (!shouldReconnect) {
        const transportError = await withTimeout(transportErrorP!, 2_000, "transport_error");
        expect(transportError.message).toContain("unauthorized");
        expect(scheduleSpy).not.toHaveBeenCalled();
        return;
      }

      const reconnectSchedule = await withTimeout(
        reconnectScheduledP!,
        2_000,
        "reconnect_scheduled",
      );
      expect(reconnectSchedule.attempt).toBe(1);

      const ws2 = await withTimeout(server.waitForClient(), 2_000, "ws2 reconnect");
      expect(ws2.readyState).toBe(WebSocket.OPEN);
    },
  );

  it("reconnects when socket closes mid device-proof handshake", async () => {
    const server = createTestServer();
    fixture.setServer(server);

    const keyPair = generateKeyPairSync("ed25519");
    const publicKeyDer = keyPair.publicKey.export({ format: "der", type: "spki" }) as Uint8Array;
    const privateKeyDer = keyPair.privateKey.export({ format: "der", type: "pkcs8" }) as Uint8Array;

    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: true,
      maxReconnectDelay: 25,
      role: "node",
      device: {
        publicKey: Buffer.from(publicKeyDer).toString("base64url"),
        privateKey: Buffer.from(privateKeyDer).toString("base64url"),
      },
    });
    fixture.setClient(client);

    const connectedP = new Promise<void>((resolve) => {
      client.on("connected", () => resolve());
    });

    if (!globalThis.crypto?.subtle) {
      throw new Error("WebCrypto subtle API not available");
    }

    const originalSign = globalThis.crypto.subtle.sign.bind(globalThis.crypto.subtle);
    let didReject = false;
    const signRejectedP = new Promise<void>((resolve) => {
      vi.spyOn(globalThis.crypto.subtle!, "sign").mockImplementation(async (...args) => {
        if (!didReject) {
          didReject = true;
          await delay(50);
          resolve();
          throw new Error("test sign failure");
        }
        return await originalSign(...(args as Parameters<typeof originalSign>));
      });
    });

    client.connect();

    // First connection: server responds to connect.init then closes immediately.
    const ws1 = await withTimeout(server.waitForClient(), 2_000, "ws1 connection");
    const init1 = (await withTimeout(waitForMessage(ws1), 2_000, "ws1 connect.init")) as Record<
      string,
      unknown
    >;
    expect(init1["type"]).toBe("connect.init");
    ws1.send(
      JSON.stringify({
        request_id: String(init1["request_id"]),
        type: "connect.init",
        ok: true,
        result: { connection_id: "conn-1", challenge: "nonce-1" },
      }),
    );
    ws1.terminate();

    // Second connection: wait for the reconnect, then complete the handshake.
    const ws2 = await withTimeout(server.waitForClient(), 2_000, "ws2 reconnect");
    const init2 = (await withTimeout(waitForMessage(ws2), 2_000, "ws2 connect.init")) as Record<
      string,
      unknown
    >;
    expect(init2["type"]).toBe("connect.init");
    ws2.send(
      JSON.stringify({
        request_id: String(init2["request_id"]),
        type: "connect.init",
        ok: true,
        result: { connection_id: "conn-2", challenge: "nonce-2" },
      }),
    );

    const proof2 = (await withTimeout(waitForMessage(ws2), 2_000, "ws2 connect.proof")) as Record<
      string,
      unknown
    >;
    expect(proof2["type"]).toBe("connect.proof");

    // Ensure stale handshake work has a chance to fail while the new socket is alive.
    await withTimeout(signRejectedP, 2_000, "sign rejection");

    ws2.send(
      JSON.stringify({
        request_id: String(proof2["request_id"]),
        type: "connect.proof",
        ok: true,
        result: { client_id: "client-2", device_id: "dev-2", role: "node" },
      }),
    );

    await withTimeout(connectedP, 2_000, "connected");
    expect(client.connected).toBe(true);
  });

  it("sends token in websocket subprotocol metadata", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "my-token",
      capabilities: [],
    });
    fixture.setClient(client);

    const connectedP = new Promise<void>((resolve) => {
      client.on("connected", () => resolve());
    });

    client.connect();
    const protocolHeader = await server.waitForProtocolHeader();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await connectedP;
    expect(typeof protocolHeader).toBe("string");
    const offered = String(protocolHeader ?? "");
    expect(offered).toContain("tyrum-v1");
    expect(offered).toContain("tyrum-auth.");
    expect(client.connected).toBe(true);
  });

  it("builds websocket protocols without auth metadata when token is empty", () => {
    const client = new TyrumClient({
      url: "ws://127.0.0.1:65535",
      token: "   ",
      capabilities: [],
      reconnect: false,
    });
    fixture.setClient(client);

    const protocols = (client as unknown as { buildProtocols(): string[] }).buildProtocols();

    expect(protocols).toEqual(["tyrum-v1"]);
  });

  it("builds websocket protocols with auth metadata when token is present", () => {
    const client = new TyrumClient({
      url: "ws://127.0.0.1:65535",
      token: "my-token",
      capabilities: [],
      reconnect: false,
    });
    fixture.setClient(client);

    const protocols = (client as unknown as { buildProtocols(): string[] }).buildProtocols();

    expect(protocols).toEqual(["tyrum-v1", "tyrum-auth.bXktdG9rZW4"]);
  });

  it("does not reconnect after intentional disconnect", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: true,
    });
    fixture.setClient(client);

    const connectedP = new Promise<void>((resolve) => {
      client.on("connected", () => resolve());
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await connectedP;
    client.disconnect();

    // Wait a bit to ensure no reconnect is attempted
    await delay(200);
    expect(client.connected).toBe(false);
  });
}
