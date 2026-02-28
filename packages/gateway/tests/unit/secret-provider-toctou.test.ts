import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.unmock("node:fs/promises");
});

async function importProvidersWithDisappearingSecretsPath(secretsPath: string): Promise<{
  FileSecretProvider: typeof import("../../src/modules/secret/provider.js").FileSecretProvider;
  KeychainSecretProvider: typeof import("../../src/modules/secret/provider.js").KeychainSecretProvider;
}> {
  vi.doMock("node:fs/promises", async () => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

    return {
      ...actual,
      access: async (...args: Parameters<typeof actual.access>) => {
        const path = args[0];
        if (path === secretsPath) return;
        return await actual.access(...args);
      },
      readFile: async (...args: Parameters<typeof actual.readFile>) => {
        const path = args[0];
        if (path === secretsPath) {
          const error = new Error("ENOENT") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        }
        return await actual.readFile(...args);
      },
    };
  });

  const { FileSecretProvider, KeychainSecretProvider } = await import(
    "../../src/modules/secret/provider.js"
  );
  return { FileSecretProvider, KeychainSecretProvider };
}

describe("Secret providers (TOCTOU)", () => {
  it("treats ENOENT during readFile as missing store (FileSecretProvider)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tyrum-secret-toctou-"));
    try {
      const secretsPath = join(dir, ".secrets.enc");
      const { FileSecretProvider } = await importProvidersWithDisappearingSecretsPath(secretsPath);
      const provider = await FileSecretProvider.create(secretsPath, "test-admin-token");
      await expect(provider.list()).resolves.toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats ENOENT during readFile as missing store (KeychainSecretProvider)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tyrum-keychain-secret-toctou-"));
    try {
      const secretsPath = join(dir, ".secrets.keychain.json");
      const { KeychainSecretProvider } =
        await importProvidersWithDisappearingSecretsPath(secretsPath);
      const provider = await KeychainSecretProvider.create(secretsPath, {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(`enc:${value}`, "utf8"),
        decryptString: (buf) => buf.toString("utf8").slice("enc:".length),
      });
      await expect(provider.list()).resolves.toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
