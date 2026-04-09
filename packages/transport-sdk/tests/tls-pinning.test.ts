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
  const init = (await waitForMessage(ws)) as Record<string, unknown>;
  expect(init["type"]).toBe("connect.init");
  expect(typeof init["request_id"]).toBe("string");

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

const LOCALHOST_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDKmma998uRhHdY
KadWw/v/nxsKMrMhXYBLy+QVAAUan8lurGZCLJ03ePnEjTu6eDxeTIcnzX5BOzyS
QQ88qV/L+NBIT0Hpb3LtCGXTs4LmC7PrdkMsiRbgZAev8JiOPLLFw8Vf3SFNdkrO
jqsr8Dv/n1lYuPj0oC0tQ4rtpaHJ7X6+S1he4HWR7R2xU9vQs0TXFnFG8bWIfT5x
tnizygNyXY7OHT+k4eVmq32ggZ5nd3ewNGurPShA7Gf+4f9b+p34opcK5SEvJ1ZT
DyTUZ4y2rTWAMWUoqEIbf+tG6e8ih5m8R3O4la6MM20eq1NMGZu4GDf8QhvdZUJI
RVVHK5ixAgMBAAECggEAA4nt8+ZoqXnQOVZJ6wMDle04zvqVedEs+7XxHbjz6IlZ
s/uM0jNUCtXhEUuGZhfcoGjds/vmgdvCZODAHsHBGk+WDhXx+2fepftUxv1j0reU
h2R34NFjWJzwAZpWLybU2GLhNyRQ784lA/Bb7EmsYfHDNmCNuv0eE47dAHtkBOzq
GTLZLDK0vQK0DF8HPsEN+WeyxifNuYkZ5JotNNKLmppAVCNP8KvrXbAlNFqZwMvJ
qyY8vO/x8o1Zr5Ki93m4BbUtpT6lGIXHe1tOXto3nofZRoyd9cFR2GseIkafRYF6
39gOpznIT6+VnHTFN9GJfm1oaRD/ENc/izmqPSmC+QKBgQD2neZCR22aD1WxH8PG
pCnk1L60qsQWD4wkiI0XcQOyYzFkDN1yhjDVbzgX2ypzHiVQnJCN3z1NsrdiYvCh
Nc/re0xKFUUBH9E7bWYAwsJm0EF5AwL7bnkeJBKdoyS/ZgmokymH5dr99dGWkBZo
bHN3OltagBTkHbnmuYtdB8L3qQKBgQDST8yho/eGsZPqpXfUSwrw0HX7IYE+YARl
ienmeYAVOMOmf3fcZ8mR/OiivYKa/RasRF4bdpWyut45pmtCmRM5ntjkLKjHwDJQ
DiPUdwuSNzxb7aE/uKY5R6yxYMVQzlrNQnDFMRJ6XMNL37RwfJOJ6NXrwc4C/07V
rdJAcmEdyQKBgD+pp0U41yxMBR0CTDG9MytlWA2ff5sKTG0p6vJANGoafSeMwqXL
ylNusJZH939cKtnScOaO2G50Ui7Nx7x1/cSWQa1mLDgMFKE4rnpHzJNp81zf0CdD
73Q+b6fN87CNELU5uCDiz1N736z0aTRvuqbuo6KLKdlxawoKn9VWKZhxAoGBAMZN
rjKfq87adBGlcia/l5JXzVc9UWNiH+MqNl02JVpdSsYcnQU666p24VhJ/vNrPsyy
LlYQ67g6UT3kuHB0a9dB+1qy7XZjuE0Z+BjnIwb8hDJeD1RJJJsQBTq/d23pFV9D
jZex3K15+D/7sGT8YhWAcO06sajL2SbMHlrcPsxZAoGAFYdpulnFUL7fAL/Zqx1A
QbA+vsFULQTK5K8yELWOrg0jUW6gUEV0LKCWBHeREqIjl48wCgshF//1UpZ/V0K+
g49I3BaJXeyYFS7YErqKZiMHH5dOBeX+KcxIeON1h8TSKDNtfltdrzzWG38RLtWU
/aVwWykHXK0bXg8SKqZG2Ec=
-----END PRIVATE KEY-----`;

const LOCALHOST_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDHzCCAgegAwIBAgIUHmOQAn2wXqSFYKsp73om7L+Bh4cwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDMwMjE0NTU1MFoXDTM2MDIy
ODE0NTU1MFowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAyppmvffLkYR3WCmnVsP7/58bCjKzIV2AS8vkFQAFGp/J
bqxmQiydN3j5xI07ung8XkyHJ81+QTs8kkEPPKlfy/jQSE9B6W9y7Qhl07OC5guz
63ZDLIkW4GQHr/CYjjyyxcPFX90hTXZKzo6rK/A7/59ZWLj49KAtLUOK7aWhye1+
vktYXuB1ke0dsVPb0LNE1xZxRvG1iH0+cbZ4s8oDcl2Ozh0/pOHlZqt9oIGeZ3d3
sDRrqz0oQOxn/uH/W/qd+KKXCuUhLydWUw8k1GeMtq01gDFlKKhCG3/rRunvIoeZ
vEdzuJWujDNtHqtTTBmbuBg3/EIb3WVCSEVVRyuYsQIDAQABo2kwZzAdBgNVHQ4E
FgQUu7d333Rp08IsecJUURlk+hW8zGEwHwYDVR0jBBgwFoAUu7d333Rp08IsecJU
URlk+hW8zGEwDwYDVR0TAQH/BAUwAwEB/zAUBgNVHREEDTALgglsb2NhbGhvc3Qw
DQYJKoZIhvcNAQELBQADggEBADZ2EEJ2XbtRzTS5BLh/kzD4/z7EzHjcovq/thTv
JqBmqyioO69wyL1P1Axo7s1LLRFSFgIVpBcYgVwgm5KvwzXaUR6HBuLpLcK5iGeU
TtBFmy13s/7YW+wKa9v74qN4QEQEGZWAP8Hs61nuRmejt898mSY2+I2SK/5Wsbgf
7Xgr7vepf9MBV+Mc5OI0s5Ik4qJr4jOkIOf1FS94LTaUGK86dFMR2KiPdX0VTKiw
ZUgdgr+jG3//EQG2CgZrofePBs20poQx1Sf/b6vpcR5u2oMY5YaEOk4TwqNi6TiR
Ynb0ZZ9vCVyxnwC5aLw3DDYzEsuAd9JTDEbNfbR8qd26hMk=
-----END CERTIFICATE-----`;

async function createSecureTestServer(): Promise<{
  url: string;
  fingerprint256: string;
  caCertPem: string;
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

  return { url, fingerprint256, caCertPem: LOCALHOST_CERT_PEM, close, waitForClient };
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

  it("rejects untrusted TLS certificates even when the fingerprint matches", async () => {
    server = await createSecureTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "test-token",
      capabilities: [],
      reconnect: false,
      tlsCertFingerprint256: server.fingerprint256,
    });

    const connectedSpy = vi.fn();
    client.on("connected", connectedSpy);

    const transportError = new Promise<{ message: string }>((resolve) => {
      client!.on("transport_error", resolve);
    });

    client.connect();

    const err = await withTimeout(transportError, 2_000, "transport_error");
    expect(err.message.toLowerCase()).toMatch(
      /self\s*signed|unable to verify|local issuer|certificate/,
    );
    expect(connectedSpy).not.toHaveBeenCalled();
  });

  it("connects when the configured fingerprint matches and the CA is trusted", async () => {
    server = await createSecureTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "test-token",
      capabilities: [],
      reconnect: false,
      tlsCertFingerprint256: server.fingerprint256,
      tlsCaCertPem: server.caCertPem,
    });

    const connected = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });

    client.connect();

    const ws = await server.waitForClient();
    await acceptConnect(ws);

    await withTimeout(connected, 2_000, "connected");
  });

  it("connects when the fingerprint matches and the CA is trusted", async () => {
    server = await createSecureTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "test-token",
      capabilities: [],
      reconnect: false,
      tlsCertFingerprint256: server.fingerprint256,
      tlsCaCertPem: server.caCertPem,
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
      tlsCertFingerprint256: server.fingerprint256.replace(/[0-9A-F]/, (c) =>
        c === "A" ? "B" : "A",
      ),
      tlsCaCertPem: server.caCertPem,
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

  it("does not auto-reconnect on fingerprint mismatch", async () => {
    server = await createSecureTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "test-token",
      capabilities: [],
      reconnect: true,
      tlsCertFingerprint256: server.fingerprint256.replace(/[0-9A-F]/, (c) =>
        c === "A" ? "B" : "A",
      ),
      tlsCaCertPem: server.caCertPem,
    });

    const scheduleSpy = vi.spyOn(
      client as unknown as { scheduleReconnect: () => void },
      "scheduleReconnect",
    );

    const disconnected = new Promise<void>((resolve) => {
      client!.on("disconnected", () => resolve());
    });

    const transportError = new Promise<{ message: string }>((resolve) => {
      client!.on("transport_error", resolve);
    });

    client.connect();

    const err = await withTimeout(transportError, 2_000, "transport_error");
    expect(err.message.toLowerCase()).toContain("fingerprint");

    await withTimeout(disconnected, 2_000, "disconnected");

    expect(scheduleSpy).not.toHaveBeenCalled();
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
