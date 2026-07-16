import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const capacitorCli = resolve(
  dirname(require.resolve("@capacitor/cli/package.json")),
  "bin/capacitor",
);

describe("Capacitor configuration", () => {
  it("loads the typed config with the TypeScript compatibility API", () => {
    const output = execFileSync(process.execPath, [capacitorCli, "ls"], {
      cwd: mobileRoot,
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(output).toContain("Found 9 Capacitor plugins for android");
    expect(output).toContain("Found 9 Capacitor plugins for ios");
  });
});
