import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPlugin } from "../../src/modules/plugin/loader.js";

describe("loadPlugin", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("reads manifest from plugin.json", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-plugin-test-"));
    const manifest = {
      id: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      description: "A test plugin",
      entry: "index.js",
      capabilities: ["read"],
      permissions: ["fs:read"],
    };
    writeFileSync(join(tempDir, "plugin.json"), JSON.stringify(manifest));

    const loaded = loadPlugin(tempDir);

    expect(loaded.manifest.id).toBe("test-plugin");
    expect(loaded.manifest.name).toBe("Test Plugin");
    expect(loaded.manifest.version).toBe("1.0.0");
    expect(loaded.manifest.description).toBe("A test plugin");
    expect(loaded.manifest.entry).toBe("index.js");
    expect(loaded.manifest.capabilities).toEqual(["read"]);
    expect(loaded.manifest.permissions).toEqual(["fs:read"]);
    expect(loaded.directory).toBe(tempDir);
    expect(loaded.loaded_at).toBeTruthy();
  });

  it("loads manifest with only required fields", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-plugin-test-"));
    const manifest = {
      id: "minimal",
      name: "Minimal",
      version: "0.1.0",
    };
    writeFileSync(join(tempDir, "plugin.json"), JSON.stringify(manifest));

    const loaded = loadPlugin(tempDir);

    expect(loaded.manifest.id).toBe("minimal");
    expect(loaded.manifest.description).toBeUndefined();
    expect(loaded.manifest.entry).toBeUndefined();
    expect(loaded.manifest.capabilities).toBeUndefined();
    expect(loaded.manifest.permissions).toBeUndefined();
  });

  it("throws on missing manifest", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-plugin-test-"));

    expect(() => loadPlugin(tempDir)).toThrow("Plugin manifest not found");
  });

  it("throws on invalid JSON", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-plugin-test-"));
    writeFileSync(join(tempDir, "plugin.json"), "not valid json {{{");

    expect(() => loadPlugin(tempDir)).toThrow("Invalid plugin manifest JSON");
  });

  it("throws on missing required field 'id'", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-plugin-test-"));
    writeFileSync(
      join(tempDir, "plugin.json"),
      JSON.stringify({ name: "No ID", version: "1.0.0" }),
    );

    expect(() => loadPlugin(tempDir)).toThrow("missing required field 'id'");
  });

  it("throws on missing required field 'name'", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-plugin-test-"));
    writeFileSync(
      join(tempDir, "plugin.json"),
      JSON.stringify({ id: "no-name", version: "1.0.0" }),
    );

    expect(() => loadPlugin(tempDir)).toThrow("missing required field 'name'");
  });

  it("throws on missing required field 'version'", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-plugin-test-"));
    writeFileSync(
      join(tempDir, "plugin.json"),
      JSON.stringify({ id: "no-ver", name: "No Version" }),
    );

    expect(() => loadPlugin(tempDir)).toThrow("missing required field 'version'");
  });

  it("throws when manifest is not an object", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-plugin-test-"));
    writeFileSync(join(tempDir, "plugin.json"), JSON.stringify("a string"));

    expect(() => loadPlugin(tempDir)).toThrow("is not an object");
  });
});
