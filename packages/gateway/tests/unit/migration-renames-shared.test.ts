import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, "../../src");

async function readSource(filename: string): Promise<string> {
  return await readFile(join(SRC_DIR, filename), "utf8");
}

describe("gateway migrations", () => {
  it("shares renamed-migration aliases across sqlite and postgres migrators", async () => {
    const sources = await Promise.all([
      readSource("migrate.ts"),
      readSource("migrate-postgres.ts"),
    ]);
    const importPattern = /from\s+["']\.\/migration-aliases\.js["']/;
    const localMapPattern = /new Map<\s*string\s*,\s*string\s*>\s*\(\s*\[/;

    for (const source of sources) {
      expect(source).toMatch(importPattern);
      expect(source).not.toMatch(localMapPattern);
    }
  });
});
