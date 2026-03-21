import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

describe("generated API artifacts", () => {
  it("match the generator output", async () => {
    const generator = await import(
      pathToFileURL(resolve(repoRoot, "scripts/api/generator-lib.mjs")).href
    );
    const generated = await generator.generateApiArtifacts();

    for (const file of generated.files as Array<{ path: string; content: string }>) {
      const existing = await readFile(file.path, "utf8");
      expect(existing).toBe(file.content);
    }
  });
});
