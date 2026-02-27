import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "src",
  base: "/ui/",
  plugins: [tailwindcss(), react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
