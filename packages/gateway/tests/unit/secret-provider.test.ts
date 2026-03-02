import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  EnvSecretProvider,
  FileSecretProvider,
  KeychainSecretProvider,
} from "../../src/modules/secret/provider.js";

describe("EnvSecretProvider", () => {
  let provider: EnvSecretProvider;

  beforeEach(() => {
    provider = new EnvSecretProvider();
  });

  it("store creates a handle with correct fields", async () => {
    const handle = await provider.store("MY_API_KEY", "secret-value");
    expect(handle.handle_id).toBeTruthy();
    expect(handle.provider).toBe("env");
    expect(handle.scope).toBe("MY_API_KEY");
    expect(handle.created_at).toBeTruthy();
  });

  it("resolve reads from process.env", async () => {
    process.env["TEST_SECRET_XYZ"] = "hello-world";
    const handle = await provider.store("TEST_SECRET_XYZ", "ignored");
    const value = await provider.resolve(handle);
    expect(value).toBe("hello-world");
    delete process.env["TEST_SECRET_XYZ"];
  });

  it("resolve returns null for missing env var", async () => {
    delete process.env["NONEXISTENT_VAR_12345"];
    const handle = await provider.store("NONEXISTENT_VAR_12345", "ignored");
    const value = await provider.resolve(handle);
    expect(value).toBeNull();
  });

  it("revoke removes handle", async () => {
    const handle = await provider.store("KEY", "val");
    const removed = await provider.revoke(handle.handle_id);
    expect(removed).toBe(true);

    const list = await provider.list();
    expect(list).toHaveLength(0);
  });

  it("revoke returns false for unknown handle", async () => {
    const removed = await provider.revoke("nonexistent-id");
    expect(removed).toBe(false);
  });

  it("list returns all handles", async () => {
    await provider.store("A", "v1");
    await provider.store("B", "v2");
    const list = await provider.list();
    expect(list).toHaveLength(2);
    expect(list.map((h) => h.scope).sort()).toEqual(["A", "B"]);
  });
});

describe("FileSecretProvider", () => {
  let tempDir: string;
  let secretsPath: string;
  let saltPath: string;
  const adminToken = "test-admin-token-for-testing";
  const legacySalt = "tyrum-secrets-v1";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-secret-test-"));
    secretsPath = join(tempDir, ".secrets.enc");
    saltPath = join(tempDir, ".salt");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

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
    entry: { iv: string; authTag: string; ciphertext: string },
  ): string {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(entry.iv, "hex"));
    decipher.setAuthTag(Buffer.from(entry.authTag, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(entry.ciphertext, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  }

  it("encrypt/decrypt round-trip via store and resolve", async () => {
    const provider = await FileSecretProvider.create(secretsPath, adminToken);
    const handle = await provider.store("DB_PASSWORD", "super-secret-123");

    expect(handle.provider).toBe("file");
    expect(handle.scope).toBe("DB_PASSWORD");

    const resolved = await provider.resolve(handle);
    expect(resolved).toBe("super-secret-123");
  });

  it("generates an instance-specific salt file", async () => {
    const provider = await FileSecretProvider.create(secretsPath, adminToken);
    await provider.store("A", "a");

    expect(existsSync(saltPath)).toBe(true);
    const salt1 = readFileSync(saltPath);
    expect(salt1).toHaveLength(32);

    const tempDir2 = mkdtempSync(join(tmpdir(), "tyrum-secret-test-"));
    const secretsPath2 = join(tempDir2, ".secrets.enc");
    const saltPath2 = join(tempDir2, ".salt");
    try {
      const provider2 = await FileSecretProvider.create(secretsPath2, adminToken);
      await provider2.store("B", "b");
      const salt2 = readFileSync(saltPath2);
      expect(salt2).toHaveLength(32);
      expect(salt1.equals(salt2)).toBe(false);
    } finally {
      rmSync(tempDir2, { recursive: true, force: true });
    }
  });

  it("creates the salt file with restrictive permissions", async () => {
    const provider = await FileSecretProvider.create(secretsPath, adminToken);
    await provider.store("A", "a");

    expect(existsSync(saltPath)).toBe(true);

    if (process.platform !== "win32") {
      const mode = statSync(saltPath).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("migrates legacy secrets when the salt file is missing", async () => {
    const handle = {
      handle_id: "legacy-handle",
      provider: "file" as const,
      scope: "LEGACY",
      created_at: new Date().toISOString(),
    };

    const legacyKey = pbkdf2Sync(adminToken, legacySalt, 100_000, 32, "sha256");
    const legacyEncrypted = encryptWithKey(legacyKey, "legacy-value");
    const legacyStore = { handles: { [handle.handle_id]: { handle, ...legacyEncrypted } } };
    writeFileSync(secretsPath, JSON.stringify(legacyStore), { mode: 0o600 });

    const before = readFileSync(secretsPath, "utf8");

    const provider = await FileSecretProvider.create(secretsPath, adminToken);

    expect(existsSync(saltPath)).toBe(true);
    expect(await provider.resolve(handle)).toBe("legacy-value");

    const after = readFileSync(secretsPath, "utf8");
    expect(after).not.toBe(before);

    const migrated = JSON.parse(after) as {
      handles: Record<string, { iv: string; authTag: string; ciphertext: string }>;
    };
    const migratedEntry = migrated.handles[handle.handle_id];

    const instanceSalt = readFileSync(saltPath);
    const instanceKey = pbkdf2Sync(adminToken, instanceSalt, 100_000, 32, "sha256");

    expect(() => decryptWithKey(legacyKey, migratedEntry)).toThrow();
    expect(decryptWithKey(instanceKey, migratedEntry)).toBe("legacy-value");
  });

  it("falls back to the legacy key when migration cannot write the store", async () => {
    if (process.platform === "win32") return;

    const handle = {
      handle_id: "legacy-handle-with-salt",
      provider: "file" as const,
      scope: "LEGACY",
      created_at: new Date().toISOString(),
    };

    const legacyKey = pbkdf2Sync(adminToken, legacySalt, 100_000, 32, "sha256");
    const legacyEncrypted = encryptWithKey(legacyKey, "legacy-value");
    const legacyStore = { handles: { [handle.handle_id]: { handle, ...legacyEncrypted } } };
    writeFileSync(secretsPath, JSON.stringify(legacyStore), { mode: 0o600 });

    writeFileSync(saltPath, randomBytes(32), { mode: 0o600 });
    chmodSync(secretsPath, 0o400);

    try {
      const provider = await FileSecretProvider.create(secretsPath, adminToken);
      expect(await provider.resolve(handle)).toBe("legacy-value");
    } finally {
      chmodSync(secretsPath, 0o600);
    }
  });

  it("store persists to disk", async () => {
    const provider = await FileSecretProvider.create(secretsPath, adminToken);
    await provider.store("KEY1", "value1");

    expect(existsSync(secretsPath)).toBe(true);

    // Re-create provider from same file (simulates restart)
    const provider2 = await FileSecretProvider.create(secretsPath, adminToken);
    const list = await provider2.list();
    expect(list).toHaveLength(1);
    expect(list[0].scope).toBe("KEY1");
  });

  it("resolve returns value after restart", async () => {
    const provider = await FileSecretProvider.create(secretsPath, adminToken);
    const handle = await provider.store("PERSIST_KEY", "persist-value");

    const provider2 = await FileSecretProvider.create(secretsPath, adminToken);
    const value = await provider2.resolve(handle);
    expect(value).toBe("persist-value");
  });

  it("revoke removes handle from store", async () => {
    const provider = await FileSecretProvider.create(secretsPath, adminToken);
    const handle = await provider.store("TO_REVOKE", "temporary");

    const removed = await provider.revoke(handle.handle_id);
    expect(removed).toBe(true);

    const list = await provider.list();
    expect(list).toHaveLength(0);

    const value = await provider.resolve(handle);
    expect(value).toBeNull();
  });

  it("revoke returns false for unknown handle", async () => {
    const provider = await FileSecretProvider.create(secretsPath, adminToken);
    const removed = await provider.revoke("nonexistent");
    expect(removed).toBe(false);
  });

  it("handles missing file gracefully", async () => {
    const provider = await FileSecretProvider.create(secretsPath, adminToken);
    const list = await provider.list();
    expect(list).toHaveLength(0);
  });

  it("surfaces corrupted secrets stores (fail closed)", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(secretsPath, "not-valid-json!!!", "utf8");

    await expect(FileSecretProvider.create(secretsPath, adminToken)).rejects.toThrow();
  });

  it("stores multiple secrets independently", async () => {
    const provider = await FileSecretProvider.create(secretsPath, adminToken);
    const h1 = await provider.store("KEY_A", "value-a");
    const h2 = await provider.store("KEY_B", "value-b");

    expect(await provider.resolve(h1)).toBe("value-a");
    expect(await provider.resolve(h2)).toBe("value-b");
    expect(await provider.list()).toHaveLength(2);
  });

  it("rejects truncated GCM authentication tags (fail closed)", async () => {
    const provider = await FileSecretProvider.create(secretsPath, adminToken);
    const handle = await provider.store("SECRET", "classified");

    const raw = readFileSync(secretsPath, "utf8");
    const store = JSON.parse(raw) as {
      handles: Record<string, { authTag: string }>;
    };
    store.handles[handle.handle_id].authTag = store.handles[handle.handle_id].authTag.slice(0, 16);
    writeFileSync(secretsPath, JSON.stringify(store), { mode: 0o600 });

    await expect(provider.resolve(handle)).rejects.toThrow();
  });

  it("different admin tokens cannot decrypt", async () => {
    const provider1 = await FileSecretProvider.create(secretsPath, "token-alpha");
    const handle = await provider1.store("SECRET", "classified");

    const provider2 = await FileSecretProvider.create(secretsPath, "token-beta");
    await expect(() => provider2.resolve(handle)).rejects.toThrow();
  });
});

describe("KeychainSecretProvider", () => {
  let tempDir: string;
  let secretsPath: string;

  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, "utf8"),
    decryptString: (buf: Buffer) => {
      const raw = buf.toString("utf8");
      if (!raw.startsWith("enc:")) {
        throw new Error("invalid ciphertext");
      }
      return raw.slice("enc:".length);
    },
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-keychain-secret-test-"));
    secretsPath = join(tempDir, ".secrets.keychain.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("stores and resolves secrets via safeStorage-backed encryption", async () => {
    const provider = await KeychainSecretProvider.create(secretsPath, safeStorage);
    const handle = await provider.store("API_KEY", "super-secret");
    expect(handle.provider).toBe("keychain");
    expect(handle.scope).toBe("API_KEY");
    expect(await provider.resolve(handle)).toBe("super-secret");
  });

  it("persists handles to disk and survives restart", async () => {
    const provider1 = await KeychainSecretProvider.create(secretsPath, safeStorage);
    const handle = await provider1.store("DB_PASS", "p@ss");

    const provider2 = await KeychainSecretProvider.create(secretsPath, safeStorage);
    expect((await provider2.list()).map((h) => h.handle_id)).toContain(handle.handle_id);
    expect(await provider2.resolve(handle)).toBe("p@ss");
  });

  it("revoke removes handle", async () => {
    const provider = await KeychainSecretProvider.create(secretsPath, safeStorage);
    const handle = await provider.store("X", "y");
    expect(await provider.revoke(handle.handle_id)).toBe(true);
    expect(await provider.resolve(handle)).toBeNull();
    expect(await provider.list()).toHaveLength(0);
  });

  it("throws when encryption is unavailable", async () => {
    const providerPromise = KeychainSecretProvider.create(secretsPath, {
      ...safeStorage,
      isEncryptionAvailable: () => false,
    });
    await expect(providerPromise).rejects.toThrow(/encryption/i);
  });

  it("surfaces corrupted secrets stores (fail closed)", async () => {
    writeFileSync(secretsPath, "not-valid-json!!!", "utf8");
    const provider = await KeychainSecretProvider.create(secretsPath, safeStorage);
    await expect(provider.list()).rejects.toThrow();
  });
});
