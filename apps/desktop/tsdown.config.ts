import { defineConfig } from "tsdown";

const externalElectron = {
  neverBundle: ["electron"],
} as const;

export default defineConfig([
  {
    name: "desktop-main",
    entry: ["src/main/bootstrap.ts", "src/main/index.ts", "src/main/desktop-screenshot-helper.ts"],
    format: "esm",
    outDir: "dist/main",
    deps: externalElectron,
  },
  {
    name: "desktop-preload",
    entry: ["src/preload/index.ts"],
    format: "cjs",
    outDir: "dist/preload",
    deps: externalElectron,
  },
]);
