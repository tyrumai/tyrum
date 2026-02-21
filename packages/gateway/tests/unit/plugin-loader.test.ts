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
      capabilities: ["tools"],
      permissions: ["fs.read"],
    };
    writeFileSync(join(tempDir, "plugin.json"), JSON.stringify(manifest));

    const loaded = loadPlugin(tempDir);

    expect(loaded.manifest.id).toBe("test-plugin");
    expect(loaded.manifest.name).toBe("Test Plugin");
    expect(loaded.manifest.version).toBe("1.0.0");
    expect(loaded.manifest.description).toBe("A test plugin");
    expect(loaded.manifest.entry).toBe("index.js");
    expect(loaded.manifest.capabilities).toEqual(["tools"]);
    expect(loaded.manifest.permissions).toEqual(["fs.read"]);
    expect(loaded.directory).toBe(tempDir);
    expect(loaded.loaded_at).toBeTruthy();
  });

  it("loads manifest with defaults for optional arrays", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-plugin-test-"));
    const manifest = {
      id: "minimal",
      name: "Minimal",
      version: "0.1.0",
      entry: "main.js",
    };
    writeFileSync(join(tempDir, "plugin.json"), JSON.stringify(manifest));

    const loaded = loadPlugin(tempDir);

    expect(loaded.manifest.id).toBe("minimal");
    expect(loaded.manifest.description).toBeUndefined();
    expect(loaded.manifest.entry).toBe("main.js");
    expect(loaded.manifest.capabilities).toEqual([]);
    expect(loaded.manifest.permissions).toEqual([]);
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

  it("throws on missing required field via Zod", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-plugin-test-"));
    writeFileSync(
      join(tempDir, "plugin.json"),
      JSON.stringify({ name: "No ID", version: "1.0.0", entry: "x.js" }),
    );

    expect(() => loadPlugin(tempDir)).toThrow();
  });

  it("throws on invalid capability enum value", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-plugin-test-"));
    writeFileSync(
      join(tempDir, "plugin.json"),
      JSON.stringify({
        id: "bad-cap",
        name: "Bad",
        version: "1.0.0",
        entry: "x.js",
        capabilities: ["invalid_capability"],
      }),
    );

    expect(() => loadPlugin(tempDir)).toThrow();
  });

  it("throws when manifest is not an object", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-plugin-test-"));
    writeFileSync(join(tempDir, "plugin.json"), JSON.stringify("a string"));

    expect(() => loadPlugin(tempDir)).toThrow();
  });
});
