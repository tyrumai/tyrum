import { defineConfig } from "vitest/config";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pnpmStoreDir = resolve(__dirname, "node_modules/.pnpm");

function resolvePnpmPackageDir(packageName: string): string {
  const packagePrefix = `${packageName.replaceAll("/", "+")}@`;
  const entry = readdirSync(pnpmStoreDir).find((candidate) => candidate.startsWith(packagePrefix));
  if (!entry) {
    throw new Error(`Unable to resolve pnpm package dir for ${packageName}`);
  }
  return resolve(pnpmStoreDir, entry, "node_modules", packageName);
}

const enforceCoverageThresholds = process.env.VITEST_SHARD_RUN !== "1";
const coverageThresholds = {
  lines: 75,
  functions: 75,
  branches: 62,
  statements: 75,
  "packages/schemas/src/**": {
    lines: 97,
    statements: 97,
    functions: 99,
    branches: 90,
  },
  "packages/gateway/src/**": {
    lines: 80,
    statements: 78,
    functions: 84,
    branches: 65,
  },
  "packages/client/src/**": {
    lines: 82,
    statements: 81,
    functions: 86,
    branches: 68,
  },
  "packages/operator-core/src/**": {
    lines: 89,
    statements: 84,
    functions: 88,
    branches: 62,
  },
  "packages/operator-ui/src/**": {
    lines: 76,
    statements: 72,
    functions: 77,
    branches: 63,
  },
  "packages/cli/src/**": {
    lines: 74,
    statements: 65,
    functions: 93,
    branches: 52,
  },
  "packages/tui/src/**": {
    lines: 75,
    statements: 72,
    functions: 75,
    branches: 58,
  },
  "apps/desktop/src/**": {
    lines: 76,
    statements: 74,
    functions: 78,
    branches: 62,
  },
  "apps/web/src/**": {
    lines: 92,
    statements: 90,
    functions: 80,
    branches: 85,
  },
} as const;

export default defineConfig({
  resolve: {
    alias: {
      "@tyrum/schemas": resolve(__dirname, "packages/schemas/src/index.ts"),
      "@tyrum/client/browser": resolve(__dirname, "packages/client/src/browser.ts"),
      "@tyrum/client/node": resolve(__dirname, "packages/client/src/node.ts"),
      "@tyrum/client": resolve(__dirname, "packages/client/src/index.ts"),
      "@tyrum/gateway": resolve(__dirname, "packages/gateway/src/index.ts"),
      "@tyrum/desktop-node": resolve(__dirname, "packages/desktop-node/src/index.ts"),
      "@tyrum/operator-core/browser": resolve(__dirname, "packages/operator-core/src/browser.ts"),
      "@tyrum/operator-core/node": resolve(__dirname, "packages/operator-core/src/node.ts"),
      "@tyrum/operator-core": resolve(__dirname, "packages/operator-core/src/index.ts"),
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
