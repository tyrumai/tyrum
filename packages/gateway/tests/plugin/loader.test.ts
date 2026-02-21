import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPlugin } from "../../src/modules/plugin/loader.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "tyrum-plugin-test-"));
}

describe("loadPlugin", () => {
  it("loads a valid plugin manifest", () => {
    const dir = makeTmpDir();
    writeFileSync(
      join(dir, "plugin.json"),
      JSON.stringify({
        id: "my-plugin",
        name: "My Plugin",
        version: "1.0.0",
        entry: "index.js",
        capabilities: ["tools"],
        permissions: ["fs.read"],
      }),
    );
    writeFileSync(join(dir, "index.js"), "export default {};");

    const loaded = loadPlugin(dir);
    expect(loaded.manifest.id).toBe("my-plugin");
    expect(loaded.manifest.entry).toBe("index.js");
    expect(loaded.manifest.capabilities).toEqual(["tools"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects entry path with traversal", () => {
    const dir = makeTmpDir();
    writeFileSync(
      join(dir, "plugin.json"),
      JSON.stringify({
        id: "evil",
        name: "Evil",
        version: "1.0.0",
        entry: "../../etc/passwd",
      }),
    );

    expect(() => loadPlugin(dir)).toThrow("must not contain '..'");
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws when manifest is missing", () => {
    const dir = makeTmpDir();
    expect(() => loadPlugin(dir)).toThrow("Plugin manifest not found");
    rmSync(dir, { recursive: true, force: true });
  });
});
