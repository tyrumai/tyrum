import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
import { spawnSync } from "node:child_process";

import { ensureSelfSignedTlsMaterial } from "../../src/modules/tls/self-signed.js";

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

function opensslAvailable(): boolean {
  try {
    const res = spawnSync("openssl", ["version"], { stdio: "ignore" });
    return res.status === 0;
  } catch {
    return false;
  }
}

describe("self-signed TLS material", () => {
  it("reads existing PEM files and computes the certificate fingerprint", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-tls-"));
    const tlsDir = join(home, "tls");
    await mkdir(tlsDir, { recursive: true });
    await writeFile(join(tlsDir, "cert.pem"), LOCALHOST_CERT_PEM, "utf-8");
    await writeFile(join(tlsDir, "key.pem"), LOCALHOST_KEY_PEM, "utf-8");

    const expected = new X509Certificate(LOCALHOST_CERT_PEM).fingerprint256;

    const material = await ensureSelfSignedTlsMaterial({ home });
    expect(material.fingerprint256).toBe(expected);
  });

  it.skipIf(!opensslAvailable())(
    "generates and persists a new certificate on first run",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "tyrum-tls-gen-"));

      const first = await ensureSelfSignedTlsMaterial({ home });
      const second = await ensureSelfSignedTlsMaterial({ home });

      expect(first.fingerprint256).toBe(second.fingerprint256);
      expect(first.certPath).toBe(second.certPath);
      expect(first.keyPath).toBe(second.keyPath);
    },
  );
});
