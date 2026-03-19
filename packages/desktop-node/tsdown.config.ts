import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  dts: true,
  deps: {
    // This package runs under Node/Electron and should load runtime deps from
    // Node resolution instead of bundling them into ESM chunks.
    skipNodeModulesBundle: true,
  },
});
