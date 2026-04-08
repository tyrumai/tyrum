import { afterEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  const instances: Array<{
    options: Record<string, unknown>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    emit: (event: string, payload?: unknown) => void;
  }> = [];

  class MockTyrumClient {
    static instances = instances;

    readonly connect = vi.fn();
    readonly disconnect = vi.fn();
    readonly on = vi.fn((event: string, handler: (payload?: unknown) => void) => {
      const handlers = this.handlers.get(event) ?? new Set<(payload?: unknown) => void>();
      handlers.add(handler);
      this.handlers.set(event, handlers);
    });
    readonly off = vi.fn((event: string, handler: (payload?: unknown) => void) => {
      this.handlers.get(event)?.delete(handler);
    });

    private readonly handlers = new Map<string, Set<(payload?: unknown) => void>>();

    constructor(readonly options: Record<string, unknown>) {
      MockTyrumClient.instances.push(this);
    }

    emit(event: string, payload?: unknown): void {
      for (const handler of this.handlers.get(event) ?? []) {
        handler(payload);
      }
    }
  }

  return {
    MockTyrumClient,
    createTyrumHttpClientMock: vi.fn(),
    requireOperatorConfigMock: vi.fn(),
    requireOperatorDeviceIdentityMock: vi.fn(),
    resolveGatewayWsUrlMock: vi.fn(),
    instances,
  };
});

vi.mock("@tyrum/operator-app/node", () => ({
  TyrumClient: mockState.MockTyrumClient,
  createTyrumHttpClient: mockState.createTyrumHttpClientMock,
}));

vi.mock("../../src/operator-paths.js", () => ({
  resolveGatewayWsUrl: mockState.resolveGatewayWsUrlMock,
}));

vi.mock("../../src/operator-state.js", () => ({
  requireOperatorConfig: mockState.requireOperatorConfigMock,
  requireOperatorDeviceIdentity: mockState.requireOperatorDeviceIdentityMock,
}));

import { createBenchmarkOperatorSession } from "../../src/benchmark/operator-session.js";

describe("createBenchmarkOperatorSession", () => {
  async function settleBootstrap(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    mockState.instances.length = 0;
    mockState.createTyrumHttpClientMock.mockReset();
    mockState.requireOperatorConfigMock.mockReset();
    mockState.requireOperatorDeviceIdentityMock.mockReset();
    mockState.resolveGatewayWsUrlMock.mockReset();
  });

  function primeOperatorState(): void {
    mockState.requireOperatorConfigMock.mockResolvedValue({
      gateway_url: "https://gateway.example.test",
      auth_token: "operator-token",
      tls_cert_fingerprint256: "abcd",
      tls_allow_self_signed: true,
    });
    mockState.requireOperatorDeviceIdentityMock.mockResolvedValue({
      deviceId: "device-1",
      publicKey: "pub",
      privateKey: "priv",
    });
    mockState.resolveGatewayWsUrlMock.mockReturnValue("wss://gateway.example.test/ws");
    mockState.createTyrumHttpClientMock.mockReturnValue({ kind: "http-client" });
  }

  it("creates HTTP and WS clients and disconnects them on close", async () => {
    primeOperatorState();

    const pending = createBenchmarkOperatorSession("/tmp/home");
    await settleBootstrap();
    const wsClient = mockState.instances[0];
    expect(wsClient).toBeDefined();
    wsClient?.emit("connected");

    const session = await pending;

    expect(mockState.createTyrumHttpClientMock).toHaveBeenCalledWith({
      baseUrl: "https://gateway.example.test",
      auth: { type: "bearer", token: "operator-token" },
      tlsCertFingerprint256: "abcd",
      tlsAllowSelfSigned: true,
    });
    expect(mockState.resolveGatewayWsUrlMock).toHaveBeenCalledWith("https://gateway.example.test");
    expect(wsClient?.connect).toHaveBeenCalledTimes(1);
    expect(wsClient?.options).toMatchObject({
      url: "wss://gateway.example.test/ws",
      token: "operator-token",
      reconnect: false,
      tlsCertFingerprint256: "abcd",
      tlsAllowSelfSigned: true,
      device: {
        deviceId: "device-1",
        publicKey: "pub",
        privateKey: "priv",
      },
    });

    session.close();
    expect(wsClient?.disconnect).toHaveBeenCalledTimes(1);
  });

  it("surfaces transport errors while connecting", async () => {
    primeOperatorState();

    const pending = createBenchmarkOperatorSession("/tmp/home");
    await settleBootstrap();
    const wsClient = mockState.instances[0];
    const rejection = expect(pending).rejects.toThrow("socket failure");
    wsClient?.emit("transport_error", { message: "socket failure" });

    await rejection;
  });

  it("surfaces disconnect events while connecting", async () => {
    primeOperatorState();

    const pending = createBenchmarkOperatorSession("/tmp/home");
    await settleBootstrap();
    const wsClient = mockState.instances[0];
    const rejection = expect(pending).rejects.toThrow(
      "WebSocket disconnected (4001): closed by gateway",
    );
    wsClient?.emit("disconnected", { code: 4001, reason: "closed by gateway" });

    await rejection;
  });

  it("times out when the websocket never connects", async () => {
    vi.useFakeTimers();
    primeOperatorState();

    const pending = createBenchmarkOperatorSession("/tmp/home");
    const rejection = expect(pending).rejects.toThrow("WebSocket connect timed out");
    await settleBootstrap();
    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;
  });
});
