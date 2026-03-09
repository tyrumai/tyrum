import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

describe("Activity docs (Issue #1158)", () => {
  it("documents the Activity experience for operators and contributors", async () => {
    const doc = await readFile(resolve(repoRoot, "docs/activity.md"), "utf8");

    expect(doc).toMatch(/^# Activity/m);
    expect(doc).toMatch(/^## What The Activity Page Shows/m);
    expect(doc).toMatch(/^## Workstreams Use Key \+ Lane Identity/m);
    expect(doc).toMatch(/key \+ lane/);
    expect(doc).toMatch(/^## Persona Semantics/m);
    expect(doc).toMatch(/\bpersona\b/i);
  });

  it("links the Activity docs from the public docs entry points", async () => {
    const docsIndex = await readFile(resolve(repoRoot, "docs/index.md"), "utf8");
    const sidebars = await readFile(resolve(repoRoot, "apps/docs/sidebars.ts"), "utf8");

    expect(docsIndex).toMatch(/\[Activity\]\(\.\/activity\.md\)/);
    expect(sidebars).toMatch(/"activity"/);
  });
});
