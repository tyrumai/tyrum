import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:https";
import { X509Certificate } from "node:crypto";
import { createTyrumHttpClient, TyrumHttpClientError } from "../src/index.js";

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

function errorMessageChain(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 4; i += 1) {
    if (!cur || typeof cur !== "object") break;
    if (cur instanceof Error) {
      parts.push(cur.message);
      cur = (cur as Error & { cause?: unknown }).cause;
      continue;
    }
    break;
  }
  return parts.filter((p) => p.trim().length > 0).join(" :: ");
}

async function createSecureHttpTestServer(): Promise<{
  baseUrl: string;
  fingerprint256: string;
  caCertPem: string;
  close: () => Promise<void>;
}> {
  const fingerprint256 = new X509Certificate(LOCALHOST_CERT_PEM).fingerprint256;

  const server = createServer({ key: LOCALHOST_KEY_PEM, cert: LOCALHOST_CERT_PEM }, (req, res) => {
    if (!req.url || req.url === "/") {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    if (req.url === "/status") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          status: "ok",
          version: "0.0.0-test",
          instance_id: "inst-1",
          role: "gateway",
          db_kind: "sqlite",
          is_exposed: false,
          otel_enabled: false,
          auth: { enabled: true },
          ws: null,
          policy: null,
          model_auth: null,
          catalog_freshness: null,
          conversations: null,
          queue_depth: null,
          sandbox: null,
          config_health: { status: "ok", issues: [] },
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  const baseUrl = `https://localhost:${port}`;

  async function close(): Promise<void> {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return { baseUrl, fingerprint256, caCertPem: LOCALHOST_CERT_PEM, close };
}

describe("HTTP TLS certificate pinning", () => {
  let server: Awaited<ReturnType<typeof createSecureHttpTestServer>> | undefined;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
  });

  it("rejects untrusted TLS certificates even when the fingerprint matches", async () => {
    server = await createSecureHttpTestServer();
    const client = createTyrumHttpClient({
      baseUrl: server.baseUrl,
      auth: { type: "none" },
      tlsCertFingerprint256: server.fingerprint256,
    });

    let err: unknown;
    try {
      await client.status.get();
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(TyrumHttpClientError);
    expect((err as TyrumHttpClientError).code).toBe("network_error");
    expect(errorMessageChain(err).toLowerCase()).toMatch(
      /self\s*signed|unable to verify|local issuer|certificate/,
    );
  });

  it("connects when the fingerprint matches and the CA is trusted", async () => {
    server = await createSecureHttpTestServer();
    const client = createTyrumHttpClient({
      baseUrl: server.baseUrl,
      auth: { type: "none" },
      tlsCertFingerprint256: server.fingerprint256,
      tlsCaCertPem: server.caCertPem,
    });

    const status = await client.status.get();
    expect(status.status).toBe("ok");
    expect(status.instance_id).toBe("inst-1");
  });

  it("rejects the request when the configured fingerprint does not match", async () => {
    server = await createSecureHttpTestServer();
    const client = createTyrumHttpClient({
      baseUrl: server.baseUrl,
      auth: { type: "none" },
      tlsCertFingerprint256: server.fingerprint256.replace(/[0-9A-F]/, (c) =>
        c === "A" ? "B" : "A",
      ),
      tlsCaCertPem: server.caCertPem,
    });

    let err: unknown;
    try {
      await client.status.get();
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(TyrumHttpClientError);
    expect((err as TyrumHttpClientError).code).toBe("network_error");
    expect(errorMessageChain(err).toLowerCase()).toContain("fingerprint");
  });
});
