import { randomUUID, createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
import type { SecretHandle as SecretHandleT } from "@tyrum/schemas";

/** Interface for all secret providers. */
export interface SecretProvider {
  resolve(handle: SecretHandleT): Promise<string | null>;
  store(scope: string, value: string): Promise<SecretHandleT>;
  revoke(handleId: string): Promise<boolean>;
  list(): Promise<SecretHandleT[]>;
}

/** Environment variable-based secret provider (no persistence). */
export class EnvSecretProvider implements SecretProvider {
  private handles = new Map<string, SecretHandleT>();

  async resolve(handle: SecretHandleT): Promise<string | null> {
    return process.env[handle.scope] ?? null;
  }

  async store(scope: string, _value: string): Promise<SecretHandleT> {
    const handle: SecretHandleT = {
      handle_id: randomUUID(),
      provider: "env",
      scope,
      created_at: new Date().toISOString(),
    };
    this.handles.set(handle.handle_id, handle);
    return handle;
  }

  async revoke(handleId: string): Promise<boolean> {
    return this.handles.delete(handleId);
  }

  async list(): Promise<SecretHandleT[]> {
    return [...this.handles.values()];
  }
}

// --- Internal types for FileSecretProvider ---

interface EncryptedEntry {
  handle: SecretHandleT;
  iv: string;       // hex-encoded
  authTag: string;  // hex-encoded
  ciphertext: string; // hex-encoded
}

interface SecretStore {
  handles: Record<string, EncryptedEntry>;
}

/** File-based encrypted secret provider using AES-256-GCM. */
export class FileSecretProvider implements SecretProvider {
  private constructor(
    private readonly secretsPath: string,
    private readonly encryptionKey: Buffer,
  ) {}

  /** Create a FileSecretProvider with PBKDF2-derived key. */
  static async create(secretsPath: string, adminToken: string): Promise<FileSecretProvider> {
    const key = pbkdf2Sync(adminToken, "tyrum-secrets-v1", 100_000, 32, "sha256");
    return new FileSecretProvider(secretsPath, key);
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
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      iv: iv.toString("hex"),
      authTag: authTag.toString("hex"),
      ciphertext: encrypted.toString("hex"),
    };
  }

  private decrypt(entry: EncryptedEntry): string {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.encryptionKey,
      Buffer.from(entry.iv, "hex"),
    );
    decipher.setAuthTag(Buffer.from(entry.authTag, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(entry.ciphertext, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  }

  private async readStore(): Promise<SecretStore> {
    try {
      await access(this.secretsPath);
    } catch {
      return { handles: {} };
    }
    try {
      const raw = await readFile(this.secretsPath, "utf8");
      return JSON.parse(raw) as SecretStore;
    } catch {
      return { handles: {} };
    }
  }

  private async writeStore(store: SecretStore): Promise<void> {
    await writeFile(this.secretsPath, JSON.stringify(store), { mode: 0o600 });
  }
}
