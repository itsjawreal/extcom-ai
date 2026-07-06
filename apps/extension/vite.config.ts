import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

function copyManifest(): Plugin {
  return {
    name: "copy-extension-manifest",
    writeBundle() {
      mkdirSync(resolve(import.meta.dirname, "dist"), { recursive: true });
      copyFileSync(
        resolve(import.meta.dirname, "manifest.json"),
        resolve(import.meta.dirname, "dist/manifest.json"),
      );
    },
  };
}

export default defineConfig({
  plugins: [copyManifest()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        content: resolve(import.meta.dirname, "src/content/index.ts"),
        serviceWorker: resolve(
          import.meta.dirname,
          "src/background/serviceWorker.ts",
        ),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith(".css") ? "content.css" : "assets/[name][extname]",
      },
    },
  },
});
