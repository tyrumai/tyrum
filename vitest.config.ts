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
    },
  },
  test: {
    include: ["packages/*/tests/**/*.test.ts", "apps/*/tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**", "apps/desktop/src/**"],
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 75,
        statements: 75,
      },
    },
  },
});
