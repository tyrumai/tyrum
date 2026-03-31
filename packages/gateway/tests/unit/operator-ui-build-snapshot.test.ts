import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hasCompleteOperatorUiSnapshot,
  listOperatorUiReferencedPaths,
} from "../helpers/operator-ui-build-snapshot.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("operator-ui-build-snapshot", () => {
  it("lists unique referenced UI asset paths from index html", () => {
    const indexHtml = `<!doctype html>
      <link rel="icon" href="/ui/favicon.ico" />
      <script type="module" src="/ui/assets/index-abc123.js"></script>
      <link rel="modulepreload" href="/ui/assets/index-abc123.js" />
      <link rel="stylesheet" href="/ui/assets/index-abc123.css" />`;

    expect(listOperatorUiReferencedPaths(indexHtml)).toEqual([
      "favicon.ico",
      "assets/index-abc123.js",
      "assets/index-abc123.css",
    ]);
  });

  it("requires every asset referenced by index html to exist in the snapshot", async () => {
    const assetsDir = await createTempDir("tyrum-operator-ui-snapshot-");
    await mkdir(join(assetsDir, "assets"), { recursive: true });
    await writeFile(
      join(assetsDir, "index.html"),
      `<!doctype html>
        <link rel="icon" href="/ui/favicon.ico" />
        <script type="module" src="/ui/assets/index-abc123.js"></script>
        <link rel="stylesheet" href="/ui/assets/index-abc123.css" />`,
    );
    await writeFile(join(assetsDir, "favicon.ico"), "icon");
    await writeFile(join(assetsDir, "assets", "index-abc123.js"), "console.log('ok');");

    await expect(hasCompleteOperatorUiSnapshot(assetsDir)).resolves.toBe(false);

    await writeFile(join(assetsDir, "assets", "index-abc123.css"), "body {}");

    await expect(hasCompleteOperatorUiSnapshot(assetsDir)).resolves.toBe(true);
  });
});
