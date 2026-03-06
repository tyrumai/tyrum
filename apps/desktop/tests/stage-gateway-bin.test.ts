import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const stageGatewayBinPath = join(__dirname, "..", "scripts", "stage-gateway-bin.mjs");

describe("stage-gateway-bin script", () => {
  it("uses the sanitized Electron native build env for prebuild-install and node-gyp", () => {
    const script = readFileSync(stageGatewayBinPath, "utf8");

    expect(script).toContain(
      'import { createElectronNativeBuildEnv } from "./gateway-native-build-env.mjs";',
    );
    expect(script).toContain(
      "const electronNativeBuildEnv = createElectronNativeBuildEnv(process.env);",
    );
    expect(script).toContain("env: electronNativeBuildEnv");
  });
});
