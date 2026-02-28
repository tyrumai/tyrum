import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

describe("Issue #841 desktop docs", () => {
  it("adds desktop developer README", async () => {
    const readme = await readFile(resolve(repoRoot, "apps/desktop/README.md"), "utf8");

    expect(readme).toMatch(/^# Tyrum Desktop/m);
    expect(readme).toMatch(/^## Purpose/m);
    expect(readme).toMatch(/^## Prerequisites/m);
    expect(readme).toMatch(/^## Build/m);
    expect(readme).toMatch(/\bpnpm --filter tyrum-desktop build\b/);
    expect(readme).toMatch(/^## Development/m);
    expect(readme).toMatch(/\bpnpm --filter tyrum-desktop dev\b/);
    expect(readme).toMatch(/^## Architecture/m);
    expect(readme).toMatch(/apps\/desktop\/src\/main\//);
    expect(readme).toMatch(/apps\/desktop\/src\/renderer\//);
    expect(readme).toMatch(/apps\/desktop\/src\/preload\//);
  });

  it("adds desktop user docs", async () => {
    const doc = await readFile(resolve(repoRoot, "docs/desktop.md"), "utf8");

    expect(doc).toMatch(/^# Tyrum Desktop/m);
    expect(doc).toMatch(/^## Install/m);
    expect(doc).toMatch(/GitHub Releases/);
    expect(doc).toMatch(/^## First run/m);
    expect(doc).toMatch(/\bEmbedded\b/);
    expect(doc).toMatch(/\bRemote\b/);
    expect(doc).toMatch(/^## Troubleshooting/m);
  });

  it("links desktop docs in the docs sidebar", async () => {
    const sidebars = await readFile(resolve(repoRoot, "apps/docs/sidebars.ts"), "utf8");
    expect(sidebars).toMatch(/"desktop"/);
  });
});
