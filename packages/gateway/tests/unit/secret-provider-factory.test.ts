import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { createSecretProviderFromEnv } from "../../src/modules/secret/create-secret-provider.js";
import { EnvSecretProvider, FileSecretProvider } from "../../src/modules/secret/provider.js";

const ENV_KEYS = ["TYRUM_SECRET_PROVIDER", "KUBERNETES_SERVICE_HOST"] as const;

function snapshotEnv(): Record<(typeof ENV_KEYS)[number], string | undefined> {
  const snapshot = {} as Record<(typeof ENV_KEYS)[number], string | undefined>;
  for (const key of ENV_KEYS) snapshot[key] = process.env[key];
  return snapshot;
}

function restoreEnv(snapshot: Record<(typeof ENV_KEYS)[number], string | undefined>): void {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("createSecretProviderFromEnv", () => {
  let homeDir: string;
  let envSnapshot: Record<(typeof ENV_KEYS)[number], string | undefined>;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
    homeDir = mkdtempSync(join(tmpdir(), "tyrum-secret-provider-factory-"));
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("defaults to file provider outside Kubernetes", async () => {
    delete process.env["TYRUM_SECRET_PROVIDER"];
    delete process.env["KUBERNETES_SERVICE_HOST"];

    const provider = await createSecretProviderFromEnv(homeDir, "test-admin-token");
    expect(provider).toBeInstanceOf(FileSecretProvider);
  });

  it("defaults to env provider inside Kubernetes", async () => {
    delete process.env["TYRUM_SECRET_PROVIDER"];
    process.env["KUBERNETES_SERVICE_HOST"] = "1";

    const provider = await createSecretProviderFromEnv(homeDir, undefined);
    expect(provider).toBeInstanceOf(EnvSecretProvider);
  });

  it("honors TYRUM_SECRET_PROVIDER=env", async () => {
    process.env["TYRUM_SECRET_PROVIDER"] = "env";
    delete process.env["KUBERNETES_SERVICE_HOST"];

    const provider = await createSecretProviderFromEnv(homeDir, undefined);
    expect(provider).toBeInstanceOf(EnvSecretProvider);
  });

  it("throws when selecting file provider without a non-empty token", async () => {
    process.env["TYRUM_SECRET_PROVIDER"] = "file";
    await expect(() => createSecretProviderFromEnv(homeDir, " ")).rejects.toThrow(
      /non-empty admin token/i,
    );
  });

  it("throws when selecting keychain provider outside Electron", async () => {
    process.env["TYRUM_SECRET_PROVIDER"] = "keychain";
    await expect(() => createSecretProviderFromEnv(homeDir, "token")).rejects.toThrow(
      /safeStorage/i,
    );
  });
});
