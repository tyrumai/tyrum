import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@tyrum/schemas": resolve(__dirname, "packages/schemas/src/index.ts"),
      "@tyrum/client": resolve(__dirname, "packages/client/src/index.ts"),
      "@tyrum/gateway": resolve(__dirname, "packages/gateway/src/index.ts"),
      "@tyrum/desktop-node": resolve(__dirname, "packages/desktop-node/src/index.ts"),
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
      exclude: ["**/*.d.ts"],
      thresholds: {
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
          lines: 43,
          statements: 42,
          functions: 43,
          branches: 38,
        },
        "apps/desktop/src/**": {
          lines: 52,
          statements: 50,
          functions: 43,
          branches: 41,
        },
        "apps/web/src/**": {
          lines: 33,
          statements: 29,
          functions: 36,
          branches: 29,
        },
      },
    },
  },
});
