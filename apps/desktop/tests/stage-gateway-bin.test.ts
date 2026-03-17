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

  it("uses Windows shell handling for pnpm deploy and preserves spawn diagnostics", () => {
    const script = readFileSync(stageGatewayBinPath, "utf8");

    expect(script).toContain('const isWindows = process.platform === "win32";');
    expect(script).toContain("shell: isWindows");
    expect(script).toContain("function formatDeployFailure(result)");
    expect(script).toContain("result.error ? `spawn error:");
  });
});
