import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type SilentCatchLocation = {
  file: string;
  line: number;
};

function getRepoRoot(): string {
  const filename = fileURLToPath(import.meta.url);
  const dirname = path.dirname(filename);
  return path.resolve(dirname, "../../../..");
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

async function listFilesRecursively(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(absolute)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(absolute);
    }
  }
  return files;
}

async function listSilentCatchLocations(): Promise<SilentCatchLocation[]> {
  const root = getRepoRoot();
  const routesDir = path.join(root, "packages/gateway/src/routes");
  const files = await listFilesRecursively(routesDir);

  const locations: SilentCatchLocation[] = [];
  for (const file of files) {
    const rel = toPosixPath(path.relative(root, file));
    const contents = await fs.readFile(file, "utf8");
    const lines = contents.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (/\bcatch\s*\{/.test(lines[index] ?? "")) {
        locations.push({ file: rel, line: index + 1 });
      }
    }
  }

  locations.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  return locations;
}

describe("Route handler catches", () => {
  it("contains no bare catch blocks in packages/gateway/src/routes", async () => {
    const locations = await listSilentCatchLocations();
    const formatted = locations.map((loc) => `${loc.file}:${String(loc.line)}`);

    expect(
      formatted,
      `Found bare catch blocks in route handlers:\n${formatted.join("\n")}`,
    ).toEqual([]);
  });
});
