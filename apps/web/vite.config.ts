import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import { createTyrumManualChunk } from "../../scripts/vite/manual-chunks.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

export default defineConfig({
  root: "src",
  publicDir: "../public",
  base: "/ui/",
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@tyrum/contracts": resolve(repoRoot, "packages/contracts/src/index.ts"),
      "@tyrum/node-sdk/browser": resolve(repoRoot, "packages/node-sdk/src/browser.ts"),
      "@tyrum/node-sdk/node": resolve(repoRoot, "packages/node-sdk/src/node.ts"),
      "@tyrum/node-sdk": resolve(repoRoot, "packages/node-sdk/src/index.ts"),
      "@tyrum/transport-sdk/browser": resolve(repoRoot, "packages/transport-sdk/src/browser.ts"),
      "@tyrum/transport-sdk/node": resolve(repoRoot, "packages/transport-sdk/src/node.ts"),
      "@tyrum/transport-sdk": resolve(repoRoot, "packages/transport-sdk/src/index.ts"),
      "@tyrum/client/browser": resolve(repoRoot, "packages/client/src/browser.ts"),
      "@tyrum/client/node": resolve(repoRoot, "packages/client/src/node.ts"),
      "@tyrum/client": resolve(repoRoot, "packages/client/src/index.ts"),
      "@tyrum/gateway": resolve(repoRoot, "packages/gateway/src/index.ts"),
      "@tyrum/desktop-node": resolve(repoRoot, "packages/desktop-node/src/index.ts"),
      "@tyrum/operator-core/browser": resolve(repoRoot, "packages/operator-core/src/browser.ts"),
      "@tyrum/operator-core/node": resolve(repoRoot, "packages/operator-core/src/node.ts"),
      "@tyrum/operator-core": resolve(repoRoot, "packages/operator-core/src/index.ts"),
      "@tyrum/operator-ui/globals.css": resolve(repoRoot, "packages/operator-ui/src/globals.css"),
      "@tyrum/operator-ui": resolve(repoRoot, "packages/operator-ui/src/index.ts"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: createTyrumManualChunk,
      },
    },
  },
});
