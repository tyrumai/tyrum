import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const stageGatewayBinPath = join(__dirname, "..", "scripts", "stage-gateway-bin.mjs");
const desktopPackageJsonPath = join(__dirname, "..", "package.json");

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
    expect(script).toContain("const prebuildInstallEntry = betterSqlite3Require.resolve");
    expect(script).toContain("const nodeGypScript = resolveWorkspaceNodeGypScript();");
    expect(script).toContain("process.execPath,");
  });

  it("uses Windows shell handling for pnpm deploy and preserves spawn diagnostics", () => {
    const script = readFileSync(stageGatewayBinPath, "utf8");

    expect(script).toContain('const isWindows = process.platform === "win32";');
    expect(script).toContain("shell: isWindows");
    expect(script).toContain("function formatDeployFailure(result)");
    expect(script).toContain("result.error ? `spawn error:");
    expect(script).toContain("function formatNativeBuildFailure(prefix, result)");
    expect(script).toContain("result.signal ? `signal:");
    expect(script).toContain("result.error ? `spawn error:");
  });

  it("deploys gateway deps with injected workspace packages instead of legacy mode", () => {
    const script = readFileSync(stageGatewayBinPath, "utf8");

    expect(script).toContain('"--config.inject-workspace-packages=true"');
    expect(script).not.toContain('"--legacy"');
    expect(script).not.toContain("ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE");
  });

  it("fails staging early when the runtime-node-control bundle was not built", () => {
    const script = readFileSync(stageGatewayBinPath, "utf8");

    expect(script).toContain("node_modules/@tyrum/runtime-node-control/dist/index.mjs");
    expect(script).toContain("pnpm --filter @tyrum/runtime-node-control build");
  });

  it("fails staging early when the runtime-execution bundle was not built", () => {
    const script = readFileSync(stageGatewayBinPath, "utf8");

    expect(script).toContain("node_modules/@tyrum/runtime-execution/dist/index.mjs");
    expect(script).toContain("pnpm --filter @tyrum/runtime-execution build");
  });

  it("invokes prebuild-install from its resolved JS entrypoint", () => {
    const script = readFileSync(stageGatewayBinPath, "utf8");

    expect(script).toContain('import { createRequire } from "node:module";');
    expect(script).toContain("realpathSync");
    expect(script).toContain("const betterSqlite3PackageRoot = realpathSync(betterSqlite3Dir);");
    expect(script).toContain(
      'const betterSqlite3Require = createRequire(join(betterSqlite3PackageRoot, "package.json"));',
    );
    expect(script).toContain(
      'const prebuildInstallEntry = betterSqlite3Require.resolve("prebuild-install/bin.js");',
    );
    expect(script).toContain("process.execPath");
    expect(script).not.toContain("node_modules/.bin/prebuild-install");
  });

  it("builds runtime-policy before staging the embedded gateway", () => {
    const packageJson = JSON.parse(readFileSync(desktopPackageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    const buildGateway = packageJson.scripts?.["build:gateway"] ?? "";
    const pretest = packageJson.scripts?.["pretest"] ?? "";

    expect(buildGateway).toContain("pnpm --filter @tyrum/runtime-policy build");
    expect(buildGateway.indexOf("pnpm --filter @tyrum/runtime-policy build")).toBeLessThan(
      buildGateway.indexOf("pnpm --filter @tyrum/gateway build"),
    );
    expect(pretest).toContain("pnpm --filter @tyrum/runtime-policy build");
  });

  it("builds runtime-node-control before desktop gateway staging and tests", () => {
    const packageJson = JSON.parse(readFileSync(desktopPackageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.pretest).toContain("@tyrum/runtime-node-control build");
    expect(packageJson.scripts?.["build:gateway"]).toContain("@tyrum/runtime-node-control build");
  });

  it("builds runtime-execution before desktop gateway staging and tests", () => {
    const packageJson = JSON.parse(readFileSync(desktopPackageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.pretest).toContain("@tyrum/runtime-execution build");
    expect(packageJson.scripts?.["build:gateway"]).toContain("@tyrum/runtime-execution build");
  });
});
