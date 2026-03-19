import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(__dirname, "..");

describe("@tyrum/mobile migration surface", () => {
  it("routes the operator shell through @tyrum/operator-app and the local node through @tyrum/node-sdk", async () => {
    const [
      packageJson,
      readme,
      operatorCoreSource,
      nodeSource,
      locationStreamSource,
      configSource,
    ] = await Promise.all([
      readFile(resolve(mobileRoot, "package.json"), "utf8"),
      readFile(resolve(mobileRoot, "README.md"), "utf8"),
      readFile(resolve(mobileRoot, "src/use-mobile-operator-core.ts"), "utf8"),
      readFile(resolve(mobileRoot, "src/use-mobile-node.ts"), "utf8"),
      readFile(resolve(mobileRoot, "src/mobile-location-stream.ts"), "utf8"),
      readFile(resolve(mobileRoot, "src/mobile-config.ts"), "utf8"),
    ]);

    expect(packageJson).toContain('"@tyrum/operator-app": "workspace:*"');
    expect(packageJson).toContain('"@tyrum/node-sdk": "workspace:*"');
    expect(packageJson).not.toContain('"@tyrum/client"');
    expect(packageJson).not.toContain('"@tyrum/transport-sdk"');

    expect(readme).toContain("@tyrum/operator-app");
    expect(readme).toContain("@tyrum/node-sdk");

    expect(operatorCoreSource).toContain('from "@tyrum/operator-app/browser"');
    expect(operatorCoreSource).not.toContain('from "@tyrum/transport-sdk');

    expect(nodeSource).toContain('from "@tyrum/node-sdk/browser"');
    expect(nodeSource).not.toContain('from "@tyrum/client"');
    expect(nodeSource).not.toContain('from "@tyrum/transport-sdk');

    expect(locationStreamSource).toContain('from "@tyrum/node-sdk/browser"');
    expect(locationStreamSource).not.toContain('from "@tyrum/transport-sdk');

    expect(configSource).not.toContain('from "@tyrum/client"');
    expect(configSource).not.toContain('from "@tyrum/transport-sdk');
  });
});
