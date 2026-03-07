import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const SHARED_MASTER_KEY_ENV_VAR = "TYRUM_SHARED_MASTER_KEY_B64";

export interface SecretKeyProvider {
  getActiveKey(): Promise<{ keyId: string; key: Buffer }>;
}

function isFsErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function keyIdForMasterKey(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function validateMasterKey(raw: string, source: string): Buffer {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(`${source} is empty`);
  }

  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length !== 32) {
    throw new Error(`${source} must decode to exactly 32 bytes`);
  }

  return decoded;
}

function resolveMasterKeyPath(params: { dbPath: string; tyrumHome: string }): string {
  const dbPath = params.dbPath.trim();
  if (dbPath === ":memory:") {
    return join(params.tyrumHome, "master.key");
  }

  return join(params.tyrumHome, "master.key");
}

async function loadOrCreateMasterKey(keyPath: string): Promise<Buffer> {
  await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 });

  const readKey = async (): Promise<Buffer> => {
    const raw = await readFile(keyPath, "utf8");
    return validateMasterKey(raw, "secrets master key file");
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

export function createLocalSecretKeyProvider(params: {
  dbPath: string;
  tyrumHome: string;
}): SecretKeyProvider {
  return {
    async getActiveKey(): Promise<{ keyId: string; key: Buffer }> {
      const dbPath = params.dbPath.trim();
      const key =
        dbPath === ":memory:"
          ? randomBytes(32)
          : await loadOrCreateMasterKey(resolveMasterKeyPath(params));
      return {
        key,
        keyId: keyIdForMasterKey(key),
      };
    },
  };
}

export function createSharedSecretKeyProvider(params?: {
  env?: NodeJS.ProcessEnv;
}): SecretKeyProvider {
  return {
    async getActiveKey(): Promise<{ keyId: string; key: Buffer }> {
      const env = params?.env ?? process.env;
      const raw = env[SHARED_MASTER_KEY_ENV_VAR];
      if (!raw) {
        throw new Error(
          `shared mode requires ${SHARED_MASTER_KEY_ENV_VAR} to be set to a base64-encoded 32-byte key`,
        );
      }

      const key = validateMasterKey(raw, SHARED_MASTER_KEY_ENV_VAR);
      return {
        key,
        keyId: keyIdForMasterKey(key),
      };
    },
  };
}
