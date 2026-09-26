import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    target: "es2015",
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        clip: resolve(__dirname, "clip.html"),
      },
      output: {
        // Single chunk — no dynamic imports, no code splitting
        manualChunks: undefined,
      },
    },
  },
});
