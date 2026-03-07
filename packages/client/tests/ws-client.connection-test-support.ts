import { expect, it, vi } from "vitest";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
} from "@tyrum/schemas";
import * as deviceIdentity from "../src/device-identity.js";
import type { TyrumClientProtocolErrorInfo } from "../src/ws-client.js";
import { TyrumClient } from "../src/ws-client.js";
import {
  type TestServer,
  createTestServer,
  waitForMessage,
  handleInboundFrame,
} from "./ws-client.test-support.js";

type ConnectionFixture = {
  getServer: () => TestServer | undefined;
  setServer: (s: TestServer) => void;
  getClient: () => TyrumClient | undefined;
  setClient: (c: TyrumClient) => void;
};

function registerConnectionHandshakeTests(fixture: ConnectionFixture): void {
  it("connects and sends connect.init with capability descriptors", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "test-token",
      capabilities: ["playwright", "http"],
    });
    fixture.setClient(client);

    client.connect();
    const ws = await server.waitForClient();
    const connect = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(connect["type"]).toBe("connect.init");
    expect(connect["payload"]).toEqual({
      protocol_rev: 2,
      role: "client",
      device: expect.objectContaining({
        device_id: expect.any(String),
        pubkey: expect.any(String),
      }),
      capabilities: [
        {
          id: descriptorIdForClientCapability("playwright"),
          version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
        },
        {
          id: descriptorIdForClientCapability("http"),
          version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
        },
      ],
    });
  });

  it("reuses one auto-generated device identity across concurrent resolution", async () => {
    const client = new TyrumClient({
      url: "ws://127.0.0.1:65535",
      token: "t",
      capabilities: [],
      reconnect: false,
    });
    fixture.setClient(client);

    const firstIdentity = { deviceId: "device-A", publicKey: "pub-A", privateKey: "priv-A" };
    const secondIdentity = { deviceId: "device-B", publicKey: "pub-B", privateKey: "priv-B" };

    let resolveFirstIdentity!: (value: typeof firstIdentity) => void;
    let resolveSecondIdentity!: (value: typeof secondIdentity) => void;
    const firstIdentityPromise = new Promise<typeof firstIdentity>((resolve) => {
      resolveFirstIdentity = resolve;
    });
    const secondIdentityPromise = new Promise<typeof secondIdentity>((resolve) => {
      resolveSecondIdentity = resolve;
    });

    const createSpy = vi
      .spyOn(deviceIdentity, "createDeviceIdentity")
      .mockImplementationOnce(async () => await firstIdentityPromise)
      .mockImplementationOnce(async () => await secondIdentityPromise);

    const resolveConnectDevice = (
      client as unknown as {
        resolveConnectDevice: () => Promise<{
          publicKey: string;
          privateKey: string;
          deviceId: string;
        }>;
      }
    ).resolveConnectDevice.bind(client);

    const firstCall = resolveConnectDevice();
    const secondCall = resolveConnectDevice();

    resolveSecondIdentity(secondIdentity);
    await Promise.resolve();
    resolveFirstIdentity(firstIdentity);

    const [resolvedFirst, resolvedSecond] = await Promise.all([firstCall, secondCall]);
    const resolvedThird = await resolveConnectDevice();

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(resolvedFirst).toEqual(firstIdentity);
    expect(resolvedSecond).toEqual(firstIdentity);
    expect(resolvedThird).toEqual(firstIdentity);
  });

  it("derives device id using shared base64url decoder", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const spy = vi.spyOn(deviceIdentity, "fromBase64Url");
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
      role: "node",
      device: { publicKey: "AQID", privateKey: "BAUG" },
    });
    fixture.setClient(client);

    client.connect();
    const ws = await server.waitForClient();
    const init = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(init["type"]).toBe("connect.init");
    expect(spy).toHaveBeenCalled();
  });

  it("omits empty optional device strings in connect.init payload", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
      role: "node",
      device: {
        publicKey: "AQID",
        privateKey: "BAUG",
        deviceId: "",
        label: "",
        platform: "   ",
        version: "",
        mode: "",
      },
    });
    fixture.setClient(client);

    client.connect();
    const ws = await server.waitForClient();
    const init = (await waitForMessage(ws)) as Record<string, unknown>;

    expect(init["type"]).toBe("connect.init");
    const payload = init["payload"] as Record<string, unknown>;
    const device = payload["device"] as Record<string, unknown>;

    expect(typeof device["device_id"]).toBe("string");
    expect(String(device["device_id"]).length).toBeGreaterThan(0);
    expect(device["pubkey"]).toBe("AQID");
    expect(Object.prototype.hasOwnProperty.call(device, "label")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(device, "platform")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(device, "version")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(device, "mode")).toBe(false);
  });
}

function registerConnectionProtocolErrorTests(fixture: ConnectionFixture): void {
  it("reports malformed JSON frames through protocol_error hooks", () => {
    const received: TyrumClientProtocolErrorInfo[] = [];
    const onProtocolError = vi.fn((info) => {
      received.push(info);
    });
    const client = new TyrumClient({
      url: "ws://127.0.0.1:65535",
      token: "t",
      capabilities: [],
      reconnect: false,
      onProtocolError,
    });
    fixture.setClient(client);

    const protocolEvents: TyrumClientProtocolErrorInfo[] = [];
    client.on("protocol_error", (info) => {
      protocolEvents.push(info);
    });

    handleInboundFrame(client, "{bad json");

    expect(onProtocolError).toHaveBeenCalledTimes(1);
    expect(received).toEqual([
      { kind: "invalid_json", raw: "{bad json", error: expect.any(String), suppressedCount: 0 },
    ]);
    expect(protocolEvents).toEqual(received);
  });

  it("reports invalid envelopes through protocol_error hooks", () => {
    const received: TyrumClientProtocolErrorInfo[] = [];
    const onProtocolError = vi.fn((info) => {
      received.push(info);
    });
    const client = new TyrumClient({
      url: "ws://127.0.0.1:65535",
      token: "t",
      capabilities: [],
      reconnect: false,
      onProtocolError,
    });
    fixture.setClient(client);

    handleInboundFrame(client, JSON.stringify({ type: "plan.update" }));

    expect(onProtocolError).toHaveBeenCalledTimes(1);
    expect(received).toEqual([
      {
        kind: "invalid_envelope",
        raw: JSON.stringify({ type: "plan.update" }),
        error: expect.any(String),
        suppressedCount: 0,
      },
    ]);
  });

  it("rate limits repeated protocol_error reports and flushes a suppressed count", () => {
    vi.useFakeTimers();
    const onProtocolError = vi.fn();
    const client = new TyrumClient({
      url: "ws://127.0.0.1:65535",
      token: "t",
      capabilities: [],
      reconnect: false,
      onProtocolError,
    });
    fixture.setClient(client);

    handleInboundFrame(client, "{bad json");
    handleInboundFrame(client, "{still bad");

    expect(onProtocolError).toHaveBeenCalledTimes(1);
    expect(onProtocolError).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kind: "invalid_json", suppressedCount: 0 }),
    );

    vi.advanceTimersByTime(5_000);
    handleInboundFrame(client, JSON.stringify({ type: "plan.update" }));

    expect(onProtocolError).toHaveBeenCalledTimes(2);
    expect(onProtocolError).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ kind: "invalid_envelope", suppressedCount: 1 }),
    );
  });

  it("warns about malformed frames when debugProtocol is enabled", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const raw = '{"token":"secret","broken":';
    const client = new TyrumClient({
      url: "ws://127.0.0.1:65535",
      token: "t",
      capabilities: [],
      reconnect: false,
      debugProtocol: true,
    });
    fixture.setClient(client);

    handleInboundFrame(client, raw);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("invalid_json");
    expect(warn.mock.calls[0]?.[0]).toContain(`raw_length=${raw.length}`);
    expect(warn.mock.calls[0]?.[0]).not.toContain(raw);
  });

  it("sends namespaced, versioned capability descriptors in connect.init", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["cli", "http"],
      reconnect: false,
      role: "node",
      device: { publicKey: "AQID", privateKey: "BAUG" },
    });
    fixture.setClient(client);

    client.connect();
    const ws = await server.waitForClient();
    const init = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(init["type"]).toBe("connect.init");

    const payload = init["payload"] as Record<string, unknown>;
    expect(payload["capabilities"]).toEqual([
      {
        id: descriptorIdForClientCapability("cli"),
        version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
      },
      {
        id: descriptorIdForClientCapability("http"),
        version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
      },
    ]);
  });
}

export function registerConnectionTests(fixture: ConnectionFixture): void {
  registerConnectionHandshakeTests(fixture);
  registerConnectionProtocolErrorTests(fixture);
}
