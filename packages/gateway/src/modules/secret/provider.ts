import { randomUUID, createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SecretHandle as SecretHandleT } from "@tyrum/schemas";

/** Interface for all secret providers. */
export interface SecretProvider {
  resolve(handle: SecretHandleT): Promise<string | null>;
  store(scope: string, value: string): Promise<SecretHandleT>;
  revoke(handleId: string): Promise<boolean>;
  list(): Promise<SecretHandleT[]>;
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** Environment variable-based secret provider (no persistence). */
export class EnvSecretProvider implements SecretProvider {
  private handles = new Map<string, SecretHandleT>();
  private revokedHandleIds = new Set<string>();

  private normalizeScope(scope: string): string {
    const trimmed = scope.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
      throw new Error(
        `Invalid env secret scope '${scope}'. Expected an environment variable name like MY_API_KEY.`,
      );
    }
    return trimmed;
  }

  async resolve(handle: SecretHandleT): Promise<string | null> {
    if (this.revokedHandleIds.has(handle.handle_id)) return null;
    const stored = this.handles.get(handle.handle_id);
    const scope = this.normalizeScope(stored?.scope ?? handle.scope);
    return process.env[scope] ?? null;
  }

  async store(scope: string, _value: string): Promise<SecretHandleT> {
    const normalizedScope = this.normalizeScope(scope);
    const handle: SecretHandleT = {
      handle_id: randomUUID(),
      provider: "env",
      scope: normalizedScope,
      created_at: new Date().toISOString(),
    };
    this.handles.set(handle.handle_id, handle);
    this.revokedHandleIds.delete(handle.handle_id);
    return handle;
  }

  async revoke(handleId: string): Promise<boolean> {
    this.revokedHandleIds.add(handleId);
    return this.handles.delete(handleId);
  }

  async list(): Promise<SecretHandleT[]> {
    return [...this.handles.values()];
  }
}

// --- Internal types for KeychainSecretProvider ---

interface KeychainEncryptedEntry {
  handle: SecretHandleT;
  ciphertext_b64: string;
}

interface KeychainSecretStore {
  handles: Record<string, KeychainEncryptedEntry>;
}

async function loadElectronSafeStorage(): Promise<SafeStorageLike | null> {
  try {
    const electron = (await import("electron")) as unknown as {
      safeStorage?: SafeStorageLike;
    };
    if (
      electron.safeStorage &&
      typeof electron.safeStorage.isEncryptionAvailable === "function" &&
      typeof electron.safeStorage.encryptString === "function" &&
      typeof electron.safeStorage.decryptString === "function"
    ) {
      return electron.safeStorage;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Keychain-backed secret provider.
 *
 * Uses Electron's `safeStorage` (Keychain/DPAPI/libsecret) for encryption, and
 * persists ciphertext + handle metadata in a local file.
 */
export class KeychainSecretProvider implements SecretProvider {
  private constructor(
    private readonly secretsPath: string,
    private readonly safeStorage: SafeStorageLike,
  ) {}

  static async create(
    secretsPath: string,
    safeStorage?: SafeStorageLike,
  ): Promise<KeychainSecretProvider> {
    const resolved = safeStorage ?? (await loadElectronSafeStorage());
    if (!resolved) {
      throw new Error(
        "KeychainSecretProvider requires Electron safeStorage (not available in this runtime)",
      );
    }
    if (!resolved.isEncryptionAvailable()) {
      throw new Error("KeychainSecretProvider encryption is not available on this host");
    }
    return new KeychainSecretProvider(secretsPath, resolved);
  }

  async resolve(handle: SecretHandleT): Promise<string | null> {
    const store = await this.readStore();
    const entry = store.handles[handle.handle_id];
    if (!entry) return null;
    return this.safeStorage.decryptString(Buffer.from(entry.ciphertext_b64, "base64"));
  }

  async store(scope: string, value: string): Promise<SecretHandleT> {
    const handle: SecretHandleT = {
      handle_id: randomUUID(),
      provider: "keychain",
      scope,
      created_at: new Date().toISOString(),
    };

    const encrypted = this.safeStorage.encryptString(value);
    const store = await this.readStore();
    store.handles[handle.handle_id] = {
      handle,
      ciphertext_b64: encrypted.toString("base64"),
    };
    await this.writeStore(store);

    return handle;
  }

  async revoke(handleId: string): Promise<boolean> {
    const store = await this.readStore();
    if (!(handleId in store.handles)) return false;
    delete store.handles[handleId];
    await this.writeStore(store);
    return true;
  }

  async list(): Promise<SecretHandleT[]> {
    const store = await this.readStore();
    return Object.values(store.handles).map((e) => e.handle);
  }

  private async readStore(): Promise<KeychainSecretStore> {
    try {
      await access(this.secretsPath);
    } catch {
      return { handles: {} };
    }
    try {
      const raw = await readFile(this.secretsPath, "utf8");
      return JSON.parse(raw) as KeychainSecretStore;
    } catch {
      return { handles: {} };
    }
  }

  private async writeStore(store: KeychainSecretStore): Promise<void> {
    await writeFile(this.secretsPath, JSON.stringify(store), { mode: 0o600 });
  }
}

// --- Internal types for FileSecretProvider ---

interface EncryptedEntry {
  handle: SecretHandleT;
  iv: string; // hex-encoded
  authTag: string; // hex-encoded
  ciphertext: string; // hex-encoded
}

interface SecretStore {
  handles: Record<string, EncryptedEntry>;
}

const FILE_SECRET_PBKDF2_ITERATIONS = 100_000;
const FILE_SECRET_PBKDF2_KEY_LENGTH_BYTES = 32;
const FILE_SECRET_PBKDF2_DIGEST = "sha256";
const FILE_SECRET_LEGACY_PBKDF2_SALT = "tyrum-secrets-v1";

function resolveFileSecretSaltPath(secretsPath: string): string {
  return join(dirname(secretsPath), ".salt");
}

function deriveFileSecretKey(adminToken: string, salt: Buffer | string): Buffer {
  return pbkdf2Sync(
    adminToken,
    salt,
    FILE_SECRET_PBKDF2_ITERATIONS,
    FILE_SECRET_PBKDF2_KEY_LENGTH_BYTES,
    FILE_SECRET_PBKDF2_DIGEST,
  );
}

function encryptWithKey(
  key: Buffer,
  data: string,
): { iv: string; authTag: string; ciphertext: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    ciphertext: encrypted.toString("hex"),
  };
}

function decryptWithKey(
  key: Buffer,
  entry: Pick<EncryptedEntry, "iv" | "authTag" | "ciphertext">,
): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(entry.iv, "hex"));
  decipher.setAuthTag(Buffer.from(entry.authTag, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(entry.ciphertext, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/** File-based encrypted secret provider using AES-256-GCM. */
export class FileSecretProvider implements SecretProvider {
  private constructor(
    private readonly secretsPath: string,
    private readonly encryptionKey: Buffer,
  ) {}

  /** Create a FileSecretProvider with PBKDF2-derived key. */
  static async create(secretsPath: string, adminToken: string): Promise<FileSecretProvider> {
    const saltPath = resolveFileSecretSaltPath(secretsPath);

    let storedSalt: Buffer | null = null;
    try {
      storedSalt = await readFile(saltPath);
    } catch {
      // ignore missing salt file
    }

    const store = await FileSecretProvider.readStoreFromPath(secretsPath);
    const legacyKey = deriveFileSecretKey(adminToken, FILE_SECRET_LEGACY_PBKDF2_SALT);
    const entries = Object.entries(store.handles);

    if (entries.length === 0) {
      if (!storedSalt) {
        storedSalt = randomBytes(32);
        await writeFile(saltPath, storedSalt, { mode: 0o600 });
      }
      return new FileSecretProvider(secretsPath, deriveFileSecretKey(adminToken, storedSalt));
    }

    const instanceKey = storedSalt ? deriveFileSecretKey(adminToken, storedSalt) : null;
    const firstEntry = entries[0];
    if (!firstEntry) {
      return new FileSecretProvider(secretsPath, instanceKey ?? legacyKey);
    }
    const [, sample] = firstEntry;

    if (instanceKey) {
      try {
        decryptWithKey(instanceKey, sample);
        return new FileSecretProvider(secretsPath, instanceKey);
      } catch {
        // fall through
      }
    }

    try {
      decryptWithKey(legacyKey, sample);

      let saltToUse = storedSalt;
      if (!saltToUse) {
        saltToUse = randomBytes(32);
        await writeFile(saltPath, saltToUse, { mode: 0o600 });
      }

      const migratedKey = deriveFileSecretKey(adminToken, saltToUse);
      const migrated: SecretStore = { handles: {} };

      for (const [handleId, existing] of entries) {
        const plaintext = decryptWithKey(legacyKey, existing);
        const encrypted = encryptWithKey(migratedKey, plaintext);
        migrated.handles[handleId] = { handle: existing.handle, ...encrypted };
      }

      await FileSecretProvider.writeStoreToPath(secretsPath, migrated);
      return new FileSecretProvider(secretsPath, migratedKey);
    } catch {
      if (instanceKey) {
        return new FileSecretProvider(secretsPath, instanceKey);
      }
      return new FileSecretProvider(secretsPath, legacyKey);
    }
  }

  async resolve(handle: SecretHandleT): Promise<string | null> {
    const store = await this.readStore();
    const entry = store.handles[handle.handle_id];
    if (!entry) return null;
    return this.decrypt(entry);
  }

  async store(scope: string, value: string): Promise<SecretHandleT> {
    const handle: SecretHandleT = {
      handle_id: randomUUID(),
      provider: "file",
      scope,
      created_at: new Date().toISOString(),
    };

    const encrypted = this.encrypt(value);
    const store = await this.readStore();
    store.handles[handle.handle_id] = { handle, ...encrypted };
    await this.writeStore(store);

    return handle;
  }

  async revoke(handleId: string): Promise<boolean> {
    const store = await this.readStore();
    if (!(handleId in store.handles)) return false;
    delete store.handles[handleId];
    await this.writeStore(store);
    return true;
  }

  async list(): Promise<SecretHandleT[]> {
    const store = await this.readStore();
    return Object.values(store.handles).map((e) => e.handle);
  }

  private encrypt(data: string): { iv: string; authTag: string; ciphertext: string } {
    return encryptWithKey(this.encryptionKey, data);
  }

  private decrypt(entry: EncryptedEntry): string {
    return decryptWithKey(this.encryptionKey, entry);
  }

  private async readStore(): Promise<SecretStore> {
    return await FileSecretProvider.readStoreFromPath(this.secretsPath);
  }

  private async writeStore(store: SecretStore): Promise<void> {
    await FileSecretProvider.writeStoreToPath(this.secretsPath, store);
  }

  private static async readStoreFromPath(secretsPath: string): Promise<SecretStore> {
    try {
      await access(secretsPath);
    } catch {
      return { handles: {} };
    }
    try {
      const raw = await readFile(secretsPath, "utf8");
      return JSON.parse(raw) as SecretStore;
    } catch {
      return { handles: {} };
    }
  }

  private static async writeStoreToPath(secretsPath: string, store: SecretStore): Promise<void> {
    await writeFile(secretsPath, JSON.stringify(store), { mode: 0o600 });
  }
}
