import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer } from "node:https";
import { X509Certificate } from "node:crypto";
import { WebSocketServer } from "ws";
import type { WebSocket as WsWebSocket } from "ws";
import { TyrumClient } from "../src/ws-client.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    p,
    delay(ms).then(() => {
      throw new Error(`${label} timeout after ${ms}ms`);
    }),
  ]);
}

function waitForMessage(ws: WsWebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
  });
}

async function acceptConnect(ws: WsWebSocket, clientId = "client-1"): Promise<void> {
  const connect = (await waitForMessage(ws)) as Record<string, unknown>;
  expect(connect["type"]).toBe("connect");
  expect(typeof connect["request_id"]).toBe("string");
  const requestId = String(connect["request_id"]);

  ws.send(
    JSON.stringify({
      request_id: requestId,
      type: "connect",
      ok: true,
      result: { client_id: clientId },
    }),
  );
}

const LOCALHOST_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDGT2L8H2cSqKyR
ffeHuggcEaEkSai7P+WZ2aGADGrElyWuDKOf7u4YtABVsSlAA4i3JK5d8WlP7vy4
1BC2bc2Pw4yJmqhy3M0tfHv9oy/6kTGYKB7TdJT0oov3Me70/Gx6wq+HRuCu6Zho
exNp+jJ8bPl9+1o/Oa3ZX8INNSV7mKlbemdK0V00TtHKVSmF7AZhG9SnUKchhQ2J
T27rQ7QiwwOYNy0NPi2Za7OlSvTSiaBAAn6PP0spCFrivTro963jfYpfpyUyRjxS
vq0CdkbUQCdJBjuQ/3wKRSTG8JAb823gE9fMqAALH1t07LmUXScktmMtZEmnpQZT
7DbLqbkrAgMBAAECggEAQ0snHMUPNf606H4lZBJVtCirVOQF9Nye7hEyw3/zLxjX
OXOihqAOfaV/Q5TlmYpZd0RkQw6rnOtNKO8VaMJj8ff6las8pBWXLmtCq/QXUOC6
QpbCtyCld0o9UrnIC6wop5Ou+qmrjs9H35R8Jwc24JAeLYkAu9m3y76527+AI6s1
nPswjGXN7W/yLPzLbcnNz67mizBEuojM7ITNdAL2xFflsg1ujgXoBpJz1Dn8h4PS
HPUOGlT1jXrgMxmZrHXZC7dTF5C3jgLGtC6pCRIiFEJkWdviEBGPqR3HUmAk1OEc
UDt5eHiVLhhtfrQYwiRKFNIk7KaI1prMga37eyV92QKBgQD3hv3IsSVzh+LMb4bH
8IwUAnXA2Ph/ir3GPh0Q1X+vdOI/awq4/CR8dR64gSom4cAw10GVvcdaXSK+aIWv
lZpbXcTT1a42lDs/1ovuJTfEt5kyttWoWV9LuxqWJZaj+HiqdxQl69MT2JGimZ50
gWJY7IB/CV4E28jhgRORKUm0HQKBgQDNGR6WzOSOYtTktZuTtWKTcR2/DwpCMaJM
hCV2ssZwLgaXjygMkDnXrRh5K66C8Emv3RLJ5+o0BHhWi+aQleq7oxsLe2+Q9ugK
jW0sqYWcpBa8EhbWMM3JwjptG4nXc9c1W02Dw7sDw8vadOfk+ZjC20zWDaE0kFPf
JtPAuvyP5wKBgQCLG3s+sYeJoQFtwPOvI9mlWSiSI52sF+3FHp05G7MxiO+pkl+p
TFK4+x0ztatZxJ89E4wROmFxwEvJVHZlEh94X39BSaIpnC6cFtf3E0V/MWtQW/5B
KVDr/4/Wd/Nr3TT7IAbbtOegDKL0DX9GnHwH24nvWvVSp64CRYcYmmqIZQKBgAWC
1EiXDtkonLHck2afrBtsIbF9lPf8X3EQ5/TNjvl6syClbx0PTw6Vjx/KZbENBd3c
4eFdAvUM3bLtpW9jJ+CM3HAti+zoRYnrDPDzSSzRV+8LyWNOAmmWd31xDP4mFbVQ
U7/jpYXPYA3psEV903YA8Iqb6SYBbs+DOpNmMt0nAoGBAOyy+SOZJ1cmaPUb3hGQ
g8nWAnrGBkGnekwC8M0xoSbOVmIEQ6I5dPm9CjJYGGKAnEeMZPmBdoPbPsIZd9Iw
H0WvcIrHBT758SPAzeqN18TtU1Z2jvqsfdfxNoC26kgWj2iX0bszlqHClqQi348Q
OODWsR61F6ETxDc5mB7Fcg3s
-----END PRIVATE KEY-----`;

const LOCALHOST_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDHzCCAgegAwIBAgIUM4BVx2jDYxcHca4h5xmcdRphQXgwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDIyNDE5NDcwNVoXDTI2MDIy
NTE5NDcwNVowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAxk9i/B9nEqiskX33h7oIHBGhJEmouz/lmdmhgAxqxJcl
rgyjn+7uGLQAVbEpQAOItySuXfFpT+78uNQQtm3Nj8OMiZqoctzNLXx7/aMv+pEx
mCge03SU9KKL9zHu9PxsesKvh0bgrumYaHsTafoyfGz5fftaPzmt2V/CDTUle5ip
W3pnStFdNE7RylUphewGYRvUp1CnIYUNiU9u60O0IsMDmDctDT4tmWuzpUr00omg
QAJ+jz9LKQha4r066Pet432KX6clMkY8Ur6tAnZG1EAnSQY7kP98CkUkxvCQG/Nt
4BPXzKgACx9bdOy5lF0nJLZjLWRJp6UGU+w2y6m5KwIDAQABo2kwZzAdBgNVHQ4E
FgQUgSFOb6AmgUThMGy7H01E3gwrApAwHwYDVR0jBBgwFoAUgSFOb6AmgUThMGy7
H01E3gwrApAwDwYDVR0TAQH/BAUwAwEB/zAUBgNVHREEDTALgglsb2NhbGhvc3Qw
DQYJKoZIhvcNAQELBQADggEBADOnfHYjiFYL2aFXLTTNoTPjmkcllvFSrRCFmWLQ
wpDV5ZhHF8tFjZYlItsb9tZDklFrK+6SGRckKifrgeNOO26Joy7Jbx7DZ2Cw7lcD
7uJZh8o4Ez+zMGFzKmxbu7i2LL+Snjs3QVF3k9hEJuJhofhxvi3oYf6tYlvZSYaI
EaGVxsgV26FYq7U2ufaE8C1W1Yx6VJmsXmeh0H6aK7/hJpWB5S8PwBYelwJWQsj9
1Elt886dGoTX3u8GWXYf4WN/9X9jmTjkRuIdLcjNwJODWlXKh6oq7n/VyBVadNUb
seIrpr4hBpDBDCtxGBv8QuqGXXNVr7IZXv+rAagxCIrQ3jo=
-----END CERTIFICATE-----`;

async function createSecureTestServer(): Promise<{
  url: string;
  fingerprint256: string;
  close: () => Promise<void>;
  waitForClient: () => Promise<WsWebSocket>;
}> {
  const fingerprint256 = new X509Certificate(LOCALHOST_CERT_PEM).fingerprint256;

  const server = createServer({ key: LOCALHOST_KEY_PEM, cert: LOCALHOST_CERT_PEM });
  const wss = new WebSocketServer({ server });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  const url = `wss://localhost:${port}`;

  const clientWaiters: Array<(ws: WsWebSocket) => void> = [];
  const pendingClients: WsWebSocket[] = [];
  wss.on("connection", (ws) => {
    const waiter = clientWaiters.shift();
    if (waiter) waiter(ws);
    else pendingClients.push(ws);
  });

  function waitForClient(): Promise<WsWebSocket> {
    const pending = pendingClients.shift();
    if (pending) return Promise.resolve(pending);
    return new Promise((resolve) => clientWaiters.push(resolve));
  }

  async function close(): Promise<void> {
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return { url, fingerprint256, close, waitForClient };
}

describe("TLS certificate pinning", () => {
  let server: Awaited<ReturnType<typeof createSecureTestServer>> | undefined;
  let client: TyrumClient | undefined;

  afterEach(async () => {
    client?.disconnect();
    client = undefined;
    if (server) {
      await server.close();
      server = undefined;
    }
    vi.restoreAllMocks();
  });

  it("connects when the configured fingerprint matches", async () => {
    server = await createSecureTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "test-token",
      capabilities: [],
      reconnect: false,
      tlsCertFingerprint256: server.fingerprint256,
    });

    const connected = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });

    client.connect();

    const ws = await server.waitForClient();
    await acceptConnect(ws);

    await withTimeout(connected, 2_000, "connected");
  });

  it("rejects connection when the configured fingerprint does not match", async () => {
    server = await createSecureTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "test-token",
      capabilities: [],
      reconnect: false,
      tlsCertFingerprint256: server.fingerprint256.replace(/[0-9A-F]/, (c) => (c === "A" ? "B" : "A")),
    });

    const connectedSpy = vi.fn();
    client.on("connected", connectedSpy);

    const transportError = new Promise<{ message: string }>((resolve) => {
      client!.on("transport_error", resolve);
    });

    client.connect();

    const err = await withTimeout(transportError, 2_000, "transport_error");
    expect(err.message.toLowerCase()).toContain("fingerprint");
    expect(connectedSpy).not.toHaveBeenCalled();
  });

  it("does not auto-reconnect on invalid tlsCertFingerprint256", async () => {
    vi.useFakeTimers();
    try {
      const misconfigured = new TyrumClient({
        url: "wss://localhost:8788/ws",
        token: "test-token",
        capabilities: [],
        reconnect: true,
        tlsCertFingerprint256: "not-a-fingerprint",
      });

      const transportError = new Promise<void>((resolve) => {
        misconfigured.on("transport_error", () => resolve());
      });

      misconfigured.connect();
      await transportError;

      expect(vi.getTimerCount()).toBe(0);

      misconfigured.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });
});
