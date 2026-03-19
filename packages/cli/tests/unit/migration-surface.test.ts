import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(__dirname, "../..");

describe("@tyrum/cli migration surface", () => {
  it("routes shared operator flows through @tyrum/operator-app/node", async () => {
    const [packageJson, readme, operatorClientsSource, elevatedModeSource, operatorStateSource] =
      await Promise.all([
        readFile(resolve(cliRoot, "package.json"), "utf8"),
        readFile(resolve(cliRoot, "README.md"), "utf8"),
        readFile(resolve(cliRoot, "src/operator-clients.ts"), "utf8"),
        readFile(resolve(cliRoot, "src/handlers/elevated-mode.ts"), "utf8"),
        readFile(resolve(cliRoot, "src/operator-state.ts"), "utf8"),
      ]);

    expect(packageJson).toContain('"@tyrum/operator-app": "workspace:*"');
    expect(packageJson).not.toContain('"@tyrum/client"');
    expect(readme).not.toContain("@tyrum/client");

    expect(operatorClientsSource).toContain('from "@tyrum/operator-app/node"');
    expect(operatorClientsSource).not.toContain('from "@tyrum/client"');

    expect(elevatedModeSource).toContain('from "@tyrum/operator-app/node"');
    expect(operatorStateSource).toContain('from "@tyrum/operator-app/node"');
  });
});
