import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createTyrumManualChunk } from "../../scripts/vite/manual-chunks.mjs";

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [tailwindcss(), react()],
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: createTyrumManualChunk,
      },
    },
  },
});
