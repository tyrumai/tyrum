import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TokenStore } from "../../src/modules/auth/token-store.js";

describe("TokenStore", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tyrum-token-test-"));
    delete process.env["TYRUM_ADMIN_TOKEN"];
  });

  afterEach(async () => {
    delete process.env["TYRUM_ADMIN_TOKEN"];
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

  it("reads token from TYRUM_ADMIN_TOKEN env var", async () => {
    process.env["TYRUM_ADMIN_TOKEN"] = "env-token-123";

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
    process.env["TYRUM_ADMIN_TOKEN"] = "env-wins";
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
});
