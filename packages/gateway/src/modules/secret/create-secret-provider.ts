import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SqlDb } from "../../statestore/types.js";
import { DbSecretProvider } from "./provider.js";

function isFsErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function resolveMasterKeyPath(params: { dbPath: string; tyrumHome: string }): string {
  const dbPath = params.dbPath.trim();
  if (dbPath === ":memory:") {
    return join(params.tyrumHome, "master.key");
  }

  // Server deployments: store master key under the gateway home directory.
  // (Desktop keychain support is intentionally out of scope for this helper.)
  return join(params.tyrumHome, "master.key");
}

async function loadOrCreateMasterKey(keyPath: string): Promise<Buffer> {
  await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 });

  const readKey = async (): Promise<Buffer> => {
    const raw = (await readFile(keyPath, "utf8")).trim();
    if (raw.length === 0) {
      throw new Error("secrets master key file is empty");
    }
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length !== 32) {
      throw new Error(`secrets master key must be 32 bytes (got ${String(decoded.length)} bytes)`);
    }
    return decoded;
  };

  try {
    return await readKey();
  } catch (err) {
    if (!isFsErrorCode(err, "ENOENT")) {
      throw err;
    }
  }

  const key = randomBytes(32);
  const payload = `${key.toString("base64")}\n`;

  try {
    await writeFile(keyPath, payload, { mode: 0o600, flag: "wx" });
    return key;
  } catch (err) {
    if (isFsErrorCode(err, "EEXIST")) {
      return await readKey();
    }
    throw err;
  }
}

function keyIdForMasterKey(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export async function createDbSecretProvider(params: {
  db: SqlDb;
  dbPath: string;
  tyrumHome: string;
  tenantId: string;
}): Promise<DbSecretProvider> {
  const factory = await createDbSecretProviderFactory({
    db: params.db,
    dbPath: params.dbPath,
    tyrumHome: params.tyrumHome,
  });

  return factory.secretProviderForTenant(params.tenantId);
}

export async function createDbSecretProviderFactory(params: {
  db: SqlDb;
  dbPath: string;
  tyrumHome: string;
}): Promise<{
  secretProviderForTenant: (tenantId: string) => DbSecretProvider;
  keyId: string;
}> {
  const dbPath = params.dbPath.trim();

  const masterKey =
    dbPath === ":memory:"
      ? randomBytes(32)
      : await loadOrCreateMasterKey(resolveMasterKeyPath({ dbPath, tyrumHome: params.tyrumHome }));
  const keyId = keyIdForMasterKey(masterKey);

  return {
    secretProviderForTenant: (tenantId: string) =>
      new DbSecretProvider(params.db, {
        tenantId,
        masterKey,
        keyId,
      }),
    keyId,
  };
}
