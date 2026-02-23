import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TokenStore } from "../../src/modules/auth/token-store.js";

describe("TokenStore", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tyrum-token-test-"));
    delete process.env["GATEWAY_TOKEN"];
  });

  afterEach(async () => {
    delete process.env["GATEWAY_TOKEN"];
    await rm(tempDir, { recursive: true, force: true });
  });

  it("generates a new token when no file or env var exists", async () => {
    const store = new TokenStore(tempDir);
    const token = await store.initialize();

    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    // Token should be persisted to file
    const fileContent = await readFile(join(tempDir, ".admin-token"), "utf-8");
    expect(fileContent.trim()).toBe(token);
  });

  it("generates a 64-character hex token (256-bit entropy)", async () => {
    const store = new TokenStore(tempDir);
    const token = await store.initialize();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reads token from GATEWAY_TOKEN env var", async () => {
    process.env["GATEWAY_TOKEN"] = "env-token-123";

    const store = new TokenStore(tempDir);
    const token = await store.initialize();

    expect(token).toBe("env-token-123");
  });

  it("reads token from .admin-token file", async () => {
    await writeFile(join(tempDir, ".admin-token"), "file-token-456\n");

    const store = new TokenStore(tempDir);
    const token = await store.initialize();

    expect(token).toBe("file-token-456");
  });

  it("env var takes precedence over file", async () => {
    process.env["GATEWAY_TOKEN"] = "env-wins";
    await writeFile(join(tempDir, ".admin-token"), "file-loses\n");

    const store = new TokenStore(tempDir);
    const token = await store.initialize();

    expect(token).toBe("env-wins");
  });

  it("validates correct token", async () => {
    const store = new TokenStore(tempDir);
    const token = await store.initialize();

    expect(store.validate(token)).toBe(true);
  });

  it("rejects incorrect token", async () => {
    const store = new TokenStore(tempDir);
    await store.initialize();

    expect(store.validate("wrong-token")).toBe(false);
  });

  it("rejects empty string", async () => {
    const store = new TokenStore(tempDir);
    await store.initialize();

    expect(store.validate("")).toBe(false);
  });

  it("returns false from validate() before initialization", () => {
    const store = new TokenStore(tempDir);
    expect(store.validate("anything")).toBe(false);
  });

  it("getToken() returns undefined before initialization", () => {
    const store = new TokenStore(tempDir);
    expect(store.getToken()).toBeUndefined();
  });

  it("getToken() returns token after initialization", async () => {
    const store = new TokenStore(tempDir);
    const token = await store.initialize();
    expect(store.getToken()).toBe(token);
  });

  it("creates parent directory if it does not exist", async () => {
    const nested = join(tempDir, "nested", "dir");
    const store = new TokenStore(nested);
    const token = await store.initialize();

    expect(token).toBeTruthy();
    const fileContent = await readFile(join(nested, ".admin-token"), "utf-8");
    expect(fileContent.trim()).toBe(token);
  });

  it("issues a device token with role and scope claims", async () => {
    const store = new TokenStore(tempDir);
    await store.initialize();

    const issued = await store.issueDeviceToken({
      deviceId: "dev_client_1",
      role: "client",
      scopes: ["operator.read", "operator.write", "operator.read"],
      ttlSeconds: 300,
    });

    expect(issued.token).toContain("tyrum-device.v1.");
    expect(issued.role).toBe("client");
    expect(issued.device_id).toBe("dev_client_1");
    expect(issued.scopes).toEqual(["operator.read", "operator.write"]);

    const claims = store.authenticate(issued.token, {
      expectedRole: "client",
      expectedDeviceId: "dev_client_1",
    });
    expect(claims).toMatchObject({
      token_kind: "device",
      token_id: issued.token_id,
      role: "client",
      device_id: "dev_client_1",
      scopes: ["operator.read", "operator.write"],
    });
    expect(store.authenticate(issued.token, { expectedRole: "node" })).toBeNull();
    expect(store.authenticate(issued.token, { expectedDeviceId: "dev_other" })).toBeNull();
    expect(store.validate(issued.token)).toBe(false);
  });

  it("revokes a device token and invalidates it immediately", async () => {
    const store = new TokenStore(tempDir);
    await store.initialize();

    const issued = await store.issueDeviceToken({
      deviceId: "dev_client_2",
      role: "client",
      scopes: ["operator.read"],
      ttlSeconds: 300,
    });

    expect(store.validate(issued.token)).toBe(false);
    await expect(store.revokeDeviceToken(issued.token)).resolves.toBe(true);
    await expect(store.revokeDeviceToken(issued.token)).resolves.toBe(false);
    expect(store.validate(issued.token)).toBe(false);
    expect(store.authenticate(issued.token)).toBeNull();
  });

  it("persists revoked device token ids across restarts", async () => {
    const store = new TokenStore(tempDir);
    await store.initialize();
    const issued = await store.issueDeviceToken({
      deviceId: "dev_client_4",
      role: "client",
      scopes: ["operator.read"],
      ttlSeconds: 300,
    });
    await expect(store.revokeDeviceToken(issued.token)).resolves.toBe(true);

    const reloaded = new TokenStore(tempDir);
    await reloaded.initialize();
    expect(reloaded.validate(issued.token)).toBe(false);
    expect(reloaded.authenticate(issued.token)).toBeNull();
  });

  it("persists revoked device token ids when overwriting the revocations file fails on Windows", async () => {
    const store = new TokenStore(tempDir);
    await store.initialize();
    const issued1 = await store.issueDeviceToken({
      deviceId: "dev_client_win_1",
      role: "client",
      scopes: ["operator.read"],
      ttlSeconds: 300,
    });
    await expect(store.revokeDeviceToken(issued1.token)).resolves.toBe(true);

    const issued2 = await store.issueDeviceToken({
      deviceId: "dev_client_win_2",
      role: "client",
      scopes: ["operator.read"],
      ttlSeconds: 300,
    });

    const storeWithPrivates = store as unknown as {
      renameFile: (from: string, to: string) => Promise<void>;
    };
    const originalRename = storeWithPrivates.renameFile.bind(store);
    const renameSpy = vi
      .spyOn(storeWithPrivates, "renameFile")
      .mockImplementationOnce(async () => {
        const err = new Error("EPERM: operation not permitted") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      })
      .mockImplementation(originalRename);

    try {
      await expect(store.revokeDeviceToken(issued2.token)).resolves.toBe(true);
    } finally {
      renameSpy.mockRestore();
    }

    const reloaded = new TokenStore(tempDir);
    await reloaded.initialize();
    expect(reloaded.authenticate(issued2.token)).toBeNull();
  });

  it("does not revoke a device token if persisting the revocation fails", async () => {
    const store = new TokenStore(tempDir);
    await store.initialize();

    const issued = await store.issueDeviceToken({
      deviceId: "dev_client_5",
      role: "client",
      scopes: ["operator.read"],
      ttlSeconds: 300,
    });
    expect(store.authenticate(issued.token, { expectedRole: "client" })).not.toBeNull();

    const storeWithPrivates = store as unknown as {
      persistRevokedDeviceTokenIds: (ids?: Iterable<string>) => Promise<void>;
    };
    const originalPersist = storeWithPrivates.persistRevokedDeviceTokenIds.bind(store);
    const persistSpy = vi
      .spyOn(storeWithPrivates, "persistRevokedDeviceTokenIds")
      .mockImplementationOnce(async () => {
        throw new Error("disk full");
      })
      .mockImplementation(originalPersist);

    try {
      await expect(store.revokeDeviceToken(issued.token)).rejects.toThrow("disk full");
      await expect(store.revokeDeviceToken(issued.token)).resolves.toBe(true);
    } finally {
      persistSpy.mockRestore();
    }

    expect(store.authenticate(issued.token)).toBeNull();
  });

  it("fails initialization if revoked device token ids file is corrupted (fail closed)", async () => {
    const store = new TokenStore(tempDir);
    await store.initialize();

    const issued = await store.issueDeviceToken({
      deviceId: "dev_client_corrupt",
      role: "client",
      scopes: ["operator.read"],
      ttlSeconds: 300,
    });
    await expect(store.revokeDeviceToken(issued.token)).resolves.toBe(true);

    await writeFile(join(tempDir, ".device-token-revocations.json"), "{not-json");

    const reloaded = new TokenStore(tempDir);
    await expect(reloaded.initialize()).rejects.toThrow();
  });

  it("does not lose revocations when revokeDeviceToken is called concurrently", async () => {
    const store = new TokenStore(tempDir);
    await store.initialize();

    const token1 = await store.issueDeviceToken({
      deviceId: "dev_client_concurrent_1",
      role: "client",
      scopes: ["operator.read"],
      ttlSeconds: 300,
    });
    const token2 = await store.issueDeviceToken({
      deviceId: "dev_client_concurrent_2",
      role: "client",
      scopes: ["operator.read"],
      ttlSeconds: 300,
    });

    const storeWithPrivates = store as unknown as {
      persistRevokedDeviceTokenIds: (ids?: Iterable<string>) => Promise<void>;
    };
    const originalPersist = storeWithPrivates.persistRevokedDeviceTokenIds.bind(store);

    let calls = 0;
    const persistSpy = vi
      .spyOn(storeWithPrivates, "persistRevokedDeviceTokenIds")
      .mockImplementation(async (ids) => {
        calls += 1;
        if (calls === 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        await originalPersist(ids);
      });

    try {
      const [revoked1, revoked2] = await Promise.all([
        store.revokeDeviceToken(token1.token),
        store.revokeDeviceToken(token2.token),
      ]);
      expect(revoked1).toBe(true);
      expect(revoked2).toBe(true);
    } finally {
      persistSpy.mockRestore();
    }

    const reloaded = new TokenStore(tempDir);
    await reloaded.initialize();
    expect(reloaded.authenticate(token1.token)).toBeNull();
    expect(reloaded.authenticate(token2.token)).toBeNull();
  });

  it("loads revoked device token ids from backup when the revocations file is missing", async () => {
    const store = new TokenStore(tempDir);
    const adminToken = await store.initialize();

    const issued = await store.issueDeviceToken({
      deviceId: "dev_client_backup_1",
      role: "client",
      scopes: ["operator.read"],
      ttlSeconds: 300,
    });
    await expect(store.revokeDeviceToken(issued.token)).resolves.toBe(true);

    const revocationPath = join(tempDir, ".device-token-revocations.json");
    await rename(revocationPath, `${revocationPath}.bak`);
    await expect(readFile(revocationPath, "utf-8")).rejects.toMatchObject({ code: "ENOENT" });

    const reloaded = new TokenStore(tempDir);
    await expect(reloaded.initialize()).resolves.toBe(adminToken);
    await expect(readFile(revocationPath, "utf-8")).resolves.toBeTruthy();
    await expect(readFile(`${revocationPath}.bak`, "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(tempDir, ".admin-token"), "utf-8")).resolves.toContain(adminToken);
    expect(reloaded.authenticate(issued.token)).toBeNull();
  });

  it("rejects expired device tokens", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-23T00:00:00.000Z"));
    try {
      const store = new TokenStore(tempDir);
      await store.initialize();
      const issued = await store.issueDeviceToken({
        deviceId: "dev_client_3",
        role: "client",
        scopes: ["operator.read"],
        ttlSeconds: 60,
      });

      vi.setSystemTime(new Date("2026-02-23T00:02:00.000Z"));
      expect(store.validate(issued.token)).toBe(false);
      expect(store.authenticate(issued.token)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("authenticates admin bootstrap token with admin claims", async () => {
    const store = new TokenStore(tempDir);
    const token = await store.initialize();

    const claims = store.authenticate(token);
    expect(claims).toMatchObject({
      token_kind: "admin",
      role: "admin",
      scopes: ["*"],
    });
  });
});
