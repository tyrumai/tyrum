import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";
import type { SqlDb } from "../../statestore/types.js";
import { isPostgresDbUri } from "../../statestore/db-uri.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";
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
  const override = process.env["TYRUM_SECRETS_MASTER_KEY_PATH"]?.trim();
  if (override) return override;

  const dbPath = params.dbPath.trim();
  if (isPostgresDbUri(dbPath) || dbPath === ":memory:") {
    return join(params.tyrumHome, "secrets.master.key");
  }

  return `${resolvePath(dbPath)}.secrets.key`;
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
  tenantId?: string;
}): Promise<DbSecretProvider> {
  const dbPath = params.dbPath.trim();
  const override = process.env["TYRUM_SECRETS_MASTER_KEY_PATH"]?.trim();

  const masterKey = override
    ? await loadOrCreateMasterKey(override)
    : dbPath === ":memory:"
      ? randomBytes(32)
      : await loadOrCreateMasterKey(resolveMasterKeyPath({ dbPath, tyrumHome: params.tyrumHome }));
  const keyId = keyIdForMasterKey(masterKey);

  return new DbSecretProvider(params.db, {
    tenantId: params.tenantId ?? DEFAULT_TENANT_ID,
    masterKey,
    keyId,
  });
}
