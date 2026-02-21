import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/app/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:8788",
      "/approvals": "http://localhost:8788",
      "/memory": "http://localhost:8788",
      "/watchers": "http://localhost:8788",
      "/playbooks": "http://localhost:8788",
      "/canvas": "http://localhost:8788",
      "/healthz": "http://localhost:8788",
    },
  },
});
