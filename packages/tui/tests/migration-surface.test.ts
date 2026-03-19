import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tuiRoot = resolve(__dirname, "..");

describe("@tyrum/tui migration surface", () => {
  it("consumes node transport helpers through @tyrum/operator-app/node", async () => {
    const [packageJson, binSource, coreSource, configSource, runsViewSource] = await Promise.all([
      readFile(resolve(tuiRoot, "package.json"), "utf8"),
      readFile(resolve(tuiRoot, "bin/tyrum-tui.mjs"), "utf8"),
      readFile(resolve(tuiRoot, "src/core.ts"), "utf8"),
      readFile(resolve(tuiRoot, "src/config.ts"), "utf8"),
      readFile(resolve(tuiRoot, "src/runs-view.ts"), "utf8"),
    ]);

    expect(packageJson).not.toContain('"@tyrum/client"');
    expect(binSource).not.toContain('"@tyrum/client"');

    expect(coreSource).toContain('from "@tyrum/operator-app/node"');
    expect(configSource).toContain('from "@tyrum/operator-app/node"');
    expect(runsViewSource).toContain('from "@tyrum/operator-app/node"');
    expect(runsViewSource).not.toContain('from "@tyrum/client"');
  });
});
