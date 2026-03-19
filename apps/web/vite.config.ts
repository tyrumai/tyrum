import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import { createTyrumManualChunk } from "../../scripts/vite/manual-chunks.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const pnpmStoreDir = resolve(repoRoot, "node_modules/.pnpm");

function resolvePnpmPackageDir(packageName: string): string {
  const packagePrefix = `${packageName.replaceAll("/", "+")}@`;
  const entry = readdirSync(pnpmStoreDir).find((candidate) => candidate.startsWith(packagePrefix));
  if (!entry) {
    throw new Error(`Unable to resolve pnpm package dir for ${packageName}`);
  }
  return resolve(pnpmStoreDir, entry, "node_modules", packageName);
}

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
      "@tyrum/operator-app/browser": resolve(repoRoot, "packages/operator-app/src/browser.ts"),
      "@tyrum/operator-app/node": resolve(repoRoot, "packages/operator-app/src/node.ts"),
      "@tyrum/operator-app": resolve(repoRoot, "packages/operator-app/src/index.ts"),
      "@tyrum/operator-ui/globals.css": resolve(repoRoot, "packages/operator-ui/src/globals.css"),
      "@tyrum/operator-ui": resolve(repoRoot, "packages/operator-ui/src/index.ts"),
      mitt: resolvePnpmPackageDir("mitt"),
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
