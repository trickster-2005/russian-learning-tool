import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Relative base: works on GitHub Pages under /<repo>/ and locally.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", chunkSizeWarningLimit: 800 },
  test: { environment: "jsdom", include: ["src/**/*.test.ts"] },
});
