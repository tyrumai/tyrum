import { beforeEach, describe, expect, it, vi } from "vitest";

const createHttpServerMock = vi.fn();
const createHttpsServerMock = vi.fn();
const getRequestListenerMock = vi.fn();
const ensureSelfSignedTlsMaterialMock = vi.fn();

vi.mock("node:http", () => ({
  createServer: (...args: unknown[]) => createHttpServerMock(...args),
}));

vi.mock("node:https", () => ({
  createServer: (...args: unknown[]) => createHttpsServerMock(...args),
}));

vi.mock("@hono/node-server", () => ({
  getRequestListener: (...args: unknown[]) => getRequestListenerMock(...args),
}));

vi.mock("../../src/modules/tls/self-signed.js", () => ({
  ensureSelfSignedTlsMaterial: (...args: unknown[]) => ensureSelfSignedTlsMaterialMock(...args),
}));

const createBaseContext = () =>
  ({
    tyrumHome: "/tmp/tyrum-home",
    shouldRunEdge: true,
    host: "127.0.0.1",
    port: 8788,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    deploymentConfig: {
      server: {},
    },
    container: {
      db: {},
    },
  }) as const;

const createHttpServer = () => {
  const server = {
    on: vi.fn(),
    listen: vi.fn((_port: unknown, _host: unknown, cb: () => void) => {
      cb();
      return server;
    }),
  };
  return server;
};

describe("createGatewayServer", () => {
  beforeEach(() => {
    createHttpServerMock.mockReset();
    createHttpsServerMock.mockReset();
    getRequestListenerMock.mockReset();
    ensureSelfSignedTlsMaterialMock.mockReset();
    getRequestListenerMock.mockImplementation(() => "listener");
  });

  it("returns undefined when edge listener is disabled", async () => {
    const { createGatewayServer } = await import("../../src/bootstrap/runtime-builders-server.js");

    const context = {
      ...createBaseContext(),
      shouldRunEdge: false,
    } as const;
    const app = { fetch: vi.fn() } as const;
    const wsHandler = { handleUpgrade: vi.fn() } as const;

    const result = await createGatewayServer(context as never, app as never, wsHandler as never);

    expect(result).toBeUndefined();
    expect(createHttpServerMock).not.toHaveBeenCalled();
    expect(createHttpsServerMock).not.toHaveBeenCalled();
  });

  it("starts plain HTTP gateway server when TLS is disabled", async () => {
    const { createGatewayServer } = await import("../../src/bootstrap/runtime-builders-server.js");
    const context = createBaseContext() as never;
    const app = { fetch: vi.fn() } as const;
    const wsHandler = { handleUpgrade: vi.fn() } as const;
    const server = createHttpServer();
    createHttpServerMock.mockReturnValue(server);

    const result = await createGatewayServer(context as never, app as never, wsHandler as never);

    expect(createHttpServerMock).toHaveBeenCalledWith("listener");
    expect(server.listen).toHaveBeenCalledWith(context.port, context.host, expect.any(Function));
    expect(server.on).toHaveBeenCalledWith("upgrade", expect.any(Function));

    const upgradeHandler = server.on.mock.calls.find(([event]) => event === "upgrade")?.[1] as
      | undefined
      | ((request: { url?: string }, socket: { destroyed?: boolean }, head: Uint8Array) => void);
    expect(upgradeHandler).toBeDefined();

    const socket = { destroy: vi.fn() };
    upgradeHandler?.({ url: "/" }, socket, Buffer.from(""));
    expect(socket.destroy).toHaveBeenCalledTimes(1);

    upgradeHandler?.({ url: "/ws" }, { destroy: vi.fn() } as never, Buffer.from(""));

    expect(result?.tlsFingerprint256).toBeUndefined();
    expect(result?.server).toBe(server);
    expect(context.logger.info).toHaveBeenCalledOnce();
  });

  it("starts HTTPS gateway server and logs fingerprint when TLS is self-signed", async () => {
    const { createGatewayServer } = await import("../../src/bootstrap/runtime-builders-server.js");
    const context = {
      ...createBaseContext(),
      deploymentConfig: {
        server: { tlsSelfSigned: true },
      },
    } as never;
    const app = { fetch: vi.fn() } as const;
    const wsHandler = { handleUpgrade: vi.fn() } as const;
    const server = createHttpServer();
    const material = {
      keyPem: "key",
      certPem: "cert",
      fingerprint256: "sha256",
      certPath: "/tmp/cert.pem",
      keyPath: "/tmp/key.pem",
    };
    ensureSelfSignedTlsMaterialMock.mockResolvedValue(material);
    createHttpsServerMock.mockReturnValue(server);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await createGatewayServer(context as never, app as never, wsHandler as never);

    expect(ensureSelfSignedTlsMaterialMock).toHaveBeenCalledWith({ home: context.tyrumHome });
    expect(createHttpsServerMock).toHaveBeenCalledWith(
      { key: material.keyPem, cert: material.certPem },
      "listener",
    );
    expect(server.listen).toHaveBeenCalledWith(context.port, context.host, expect.any(Function));
    expect(result?.tlsFingerprint256).toBe(material.fingerprint256);
    expect(result?.server).toBe(server);
    expect(consoleSpy).toHaveBeenCalledWith(
      "TLS enabled (self-signed). Browsers will show a warning unless trusted.",
    );
    consoleSpy.mockRestore();
  });
});
