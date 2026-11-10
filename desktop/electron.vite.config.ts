import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    build: {
      outDir: "out/main",
      externalizeDeps: true,
      rollupOptions: { input: { index: resolve(__dirname, "src/main/index.ts") } },
    },
  },
  preload: {
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    build: { outDir: "out/renderer", rollupOptions: { input: resolve(__dirname, "src/renderer/index.html") } },
    plugins: [react()],
    // The shared theme (../shared/theme: theme.css, fonts, mark) lives outside desktop/.
    server: { fs: { allow: [resolve(__dirname, "..")] } },
  },
});
