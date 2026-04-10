import { defineConfig } from "vitest/config";
import { mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pnpmStoreDir = resolve(__dirname, "node_modules/.pnpm");
const operatorUiRequire = createRequire(resolve(__dirname, "packages/operator-ui/package.json"));

function resolvePnpmPackageDir(packageName: string): string {
  try {
    const packageJsonPath = operatorUiRequire.resolve(`${packageName}/package.json`);
    return dirname(packageJsonPath);
  } catch {
    // Fall back to the pnpm store scan for packages that are not reachable from operator-ui.
  }
  const packagePrefix = `${packageName.replaceAll("/", "+")}@`;
  const entry = readdirSync(pnpmStoreDir).find((candidate) => candidate.startsWith(packagePrefix));
  if (!entry) {
    throw new Error(`Unable to resolve pnpm package dir for ${packageName}`);
  }
  return resolve(pnpmStoreDir, entry, "node_modules", packageName);
}

function readVitestShardId(): string | null {
  for (let index = 0; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === "--shard") {
      const shardId = process.argv[index + 1];
      return typeof shardId === "string" && shardId.length > 0 ? shardId : null;
    }
    if (argument.startsWith("--shard=")) {
      const shardId = argument.slice("--shard=".length);
      return shardId.length > 0 ? shardId : null;
    }
  }
  return null;
}

const vitestShardId = readVitestShardId();
const isVitestShardRun = process.env.VITEST_SHARD_RUN === "1" || vitestShardId !== null;

if (vitestShardId) {
  // Vitest coverage shards write partial results under coverage/.tmp-<shard>.
  // Create it eagerly so shard runs do not fail before the merge job combines reports.
  mkdirSync(resolve(__dirname, "coverage", `.tmp-${vitestShardId.replace("/", "-")}`), {
    recursive: true,
  });
}

const enforceCoverageThresholds = !isVitestShardRun;
const coverageThresholds = {
  lines: 75,
  functions: 75,
  branches: 68,
  statements: 75,
  "packages/contracts/src/**": {
    lines: 97,
    statements: 97,
    functions: 99,
    branches: 90,
  },
  "packages/gateway/src/**": {
    lines: 80,
    statements: 78,
    functions: 84,
    branches: 67,
  },
  "packages/operator-app/src/**": {
    lines: 89,
    statements: 84,
    functions: 88,
    branches: 68,
  },
  "packages/operator-ui/src/**": {
    lines: 74,
    statements: 71,
    functions: 74,
    branches: 68,
  },
  "packages/cli/src/**": {
    lines: 74,
    statements: 65,
    functions: 93,
    branches: 55,
  },
  "packages/tui/src/**": {
    lines: 75,
    statements: 72,
    functions: 75,
    branches: 60,
  },
  "apps/desktop/src/**": {
    lines: 76,
    statements: 74,
    functions: 78,
    branches: 65,
  },
  "apps/web/src/**": {
    lines: 92,
    statements: 90,
    functions: 80,
    branches: 88,
  },
} as const;

export default defineConfig({
  resolve: {
    alias: {
      "@tyrum/contracts": resolve(__dirname, "packages/contracts/src/index.ts"),
      "@tyrum/node-sdk/browser": resolve(__dirname, "packages/node-sdk/src/browser.ts"),
      "@tyrum/node-sdk/node": resolve(__dirname, "packages/node-sdk/src/node.ts"),
      "@tyrum/node-sdk": resolve(__dirname, "packages/node-sdk/src/index.ts"),
      "@tyrum/transport-sdk/browser": resolve(__dirname, "packages/transport-sdk/src/browser.ts"),
      "@tyrum/transport-sdk/node": resolve(__dirname, "packages/transport-sdk/src/node.ts"),
      "@tyrum/transport-sdk": resolve(__dirname, "packages/transport-sdk/src/index.ts"),
      "@tyrum/runtime-policy": resolve(__dirname, "packages/runtime-policy/src/index.ts"),
      "@tyrum/runtime-agent": resolve(__dirname, "packages/runtime-agent/src/index.ts"),
      "@tyrum/cli-utils": resolve(__dirname, "packages/cli-utils/src/index.ts"),
      "@tyrum/runtime-node-control": resolve(
        __dirname,
        "packages/runtime-node-control/src/index.ts",
      ),
      "@tyrum/runtime-execution": resolve(__dirname, "packages/runtime-execution/src/index.ts"),
      "@tyrum/gateway": resolve(__dirname, "packages/gateway/src/index.ts"),
      "@tyrum/desktop-node": resolve(__dirname, "packages/desktop-node/src/index.ts"),
      "@tyrum/operator-app/browser": resolve(__dirname, "packages/operator-app/src/browser.ts"),
      "@tyrum/operator-app/node": resolve(__dirname, "packages/operator-app/src/node.ts"),
      "@tyrum/operator-app": resolve(__dirname, "packages/operator-app/src/index.ts"),
      "@tyrum/operator-ui/globals.css": resolve(__dirname, "packages/operator-ui/src/globals.css"),
      "@tyrum/operator-ui": resolve(__dirname, "packages/operator-ui/src/index.ts"),
      "@tyrum/cli": resolve(__dirname, "packages/cli/src/index.ts"),
      "@tyrum/tui": resolve(__dirname, "packages/tui/src/index.ts"),
      react: resolvePnpmPackageDir("react"),
      "react/jsx-runtime": resolve(resolvePnpmPackageDir("react"), "jsx-runtime.js"),
      "react/jsx-dev-runtime": resolve(resolvePnpmPackageDir("react"), "jsx-dev-runtime.js"),
      "react-dom": resolvePnpmPackageDir("react-dom"),
      "react-dom/client": resolve(resolvePnpmPackageDir("react-dom"), "client.js"),
      "@capacitor/camera": resolve(__dirname, "apps/mobile/tests/stubs/capacitor-camera.ts"),
      "@capacitor/core": resolve(__dirname, "apps/mobile/tests/stubs/capacitor-core.ts"),
      "@capacitor/geolocation": resolve(
        __dirname,
        "apps/mobile/tests/stubs/capacitor-geolocation.ts",
      ),
      "@capacitor/preferences": resolve(
        __dirname,
        "apps/mobile/tests/stubs/capacitor-preferences.ts",
      ),
      "@aparajita/capacitor-secure-storage": resolve(
        __dirname,
        "apps/mobile/tests/stubs/capacitor-secure-storage.ts",
      ),
    },
  },
  test: {
    include: ["packages/*/tests/**/*.test.ts", "apps/*/tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "packages/*/src/**/*.ts",
        "packages/*/src/**/*.tsx",
        "packages/*/src/**/*.js",
        "packages/*/src/**/*.jsx",
        "apps/*/src/**/*.ts",
        "apps/*/src/**/*.tsx",
        "apps/*/src/**/*.js",
        "apps/*/src/**/*.jsx",
      ],
      exclude: ["**/*.d.ts", "apps/web/src/layout-harness*.ts", "apps/web/src/layout-harness*.tsx"],
      thresholds: enforceCoverageThresholds ? coverageThresholds : undefined,
    },
  },
});
