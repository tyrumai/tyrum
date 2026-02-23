import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "../..");

describe("gateway dev-start stale dist guard", () => {
  it("runs start via the CLI wrapper (so it can rebuild dist when running from source)", async () => {
    const pkgPath = resolve(PACKAGE_ROOT, "package.json");
    const pkgRaw = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };

    expect(pkg.scripts?.start).toBe("node bin/tyrum.mjs");
  });

  it("does not statically import dist in the CLI wrapper (must be able to build before loading)", async () => {
    const binPath = resolve(PACKAGE_ROOT, "bin/tyrum.mjs");
    const bin = await readFile(binPath, "utf-8");

    expect(bin).not.toContain('from "../dist/index.mjs"');
    expect(bin).toContain("await import");
  });
});

