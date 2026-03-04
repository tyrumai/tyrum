import { spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { constants } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

export type SelfSignedTlsMaterial = Readonly<{
  certPem: string;
  keyPem: string;
  certPath: string;
  keyPath: string;
  fingerprint256: string;
}>;

function stripIpv6ZoneIndex(ip: string): string {
  const idx = ip.indexOf("%");
  return idx === -1 ? ip : ip.slice(0, idx);
}

function resolveLocalIpSans(): string[] {
  const out = new Set<string>(["127.0.0.1", "::1"]);
  const nets = networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const entry of entries ?? []) {
      if (!entry || entry.internal) continue;
      const address = stripIpv6ZoneIndex(entry.address);
      if (address.trim().length === 0) continue;
      out.add(address);
    }
  }
  return [...out];
}

function safeStat(path: string): Promise<{ exists: boolean; isFile: boolean }> {
  return stat(path)
    .then((s) => ({ exists: true, isFile: s.isFile() }))
    .catch((err) => {
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code?: unknown }).code === "ENOENT"
      ) {
        return { exists: false, isFile: false };
      }
      throw err;
    });
}

function buildOpenSslConfig(input: { cn: string; dnsNames: string[]; ipSans: string[] }): string {
  const dnsLines = input.dnsNames.map((name, idx) => `DNS.${idx + 1} = ${name}`).join("\n");
  const ipLines = input.ipSans.map((ip, idx) => `IP.${idx + 1} = ${ip}`).join("\n");

  return [
    "[req]",
    "distinguished_name = req_distinguished_name",
    "x509_extensions = v3_req",
    "prompt = no",
    "",
    "[req_distinguished_name]",
    `CN = ${input.cn}`,
    "",
    "[v3_req]",
    "basicConstraints = critical,CA:false",
    "keyUsage = critical,digitalSignature,keyEncipherment",
    "extendedKeyUsage = serverAuth",
    "subjectAltName = @alt_names",
    "",
    "[alt_names]",
    dnsLines,
    ipLines,
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function runOpenSslReq(args: string[]): void {
  const res = spawnSync("openssl", args, { stdio: "pipe" });
  if (res.status === 0) return;
  const stderr = res.stderr ? res.stderr.toString("utf-8").trim() : "";
  const hint = stderr.length > 0 ? `: ${stderr}` : "";
  throw new Error(`openssl failed${hint}`);
}

export async function ensureSelfSignedTlsMaterial(input: {
  home: string;
}): Promise<SelfSignedTlsMaterial> {
  const tlsDir = join(input.home, "tls");
  const certPath = join(tlsDir, "cert.pem");
  const keyPath = join(tlsDir, "key.pem");
  const fingerprintPath = join(tlsDir, "fingerprint256.txt");

  await mkdir(tlsDir, { recursive: true, mode: 0o700 });

  const certInfo = await safeStat(certPath);
  const keyInfo = await safeStat(keyPath);

  if (certInfo.exists !== keyInfo.exists) {
    throw new Error(
      `Self-signed TLS material is incomplete (cert exists: ${String(
        certInfo.exists,
      )}, key exists: ${String(keyInfo.exists)}). Remove '${tlsDir}' and retry.`,
    );
  }

  if (!certInfo.exists && !keyInfo.exists) {
    const certTmp = join(tlsDir, "cert.pem.tmp");
    const keyTmp = join(tlsDir, "key.pem.tmp");
    const cfgPath = join(tlsDir, "openssl.cnf");

    const ipSans = resolveLocalIpSans();
    const dnsNames = ["localhost"];
    const config = buildOpenSslConfig({ cn: "tyrum-gateway", dnsNames, ipSans });
    await writeFile(cfgPath, config, { encoding: "utf-8", mode: 0o600 });

    try {
      // Generate a long-lived self-signed leaf cert.
      runOpenSslReq([
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-sha256",
        "-days",
        "3650",
        "-keyout",
        keyTmp,
        "-out",
        certTmp,
        "-config",
        cfgPath,
      ]);

      await chmod(keyTmp, 0o600);
      await chmod(certTmp, 0o644);

      await rename(keyTmp, keyPath);
      await rename(certTmp, certPath);
    } catch (err) {
      // Best-effort cleanup if generation fails.
      await Promise.allSettled([
        rm(keyTmp, { force: true }),
        rm(certTmp, { force: true }),
        rm(cfgPath, { force: true }),
      ]);
      throw err;
    }

    // Keep the config around for debugging, but ensure it's not world-readable.
    await chmod(cfgPath, 0o600).catch(() => {});
  } else {
    if (!certInfo.isFile || !keyInfo.isFile) {
      throw new Error(`Self-signed TLS paths must be files: ${certPath}, ${keyPath}`);
    }

    // Defensive permissions check for the private key.
    try {
      const s = await stat(keyPath);
      if ((s.mode & (constants.S_IRWXG | constants.S_IRWXO)) !== 0) {
        await chmod(keyPath, 0o600);
      }
    } catch {
      // Intentional: best-effort hardening; if stat/chmod fails we'll still try to start with the key.
    }
  }

  const [certPem, keyPem] = await Promise.all([
    readFile(certPath, "utf-8"),
    readFile(keyPath, "utf-8"),
  ]);
  const fingerprint256 = new X509Certificate(certPem).fingerprint256;
  await writeFile(fingerprintPath, `${fingerprint256}\n`, { encoding: "utf-8", mode: 0o600 });

  return { certPem, keyPem, certPath, keyPath, fingerprint256 };
}
