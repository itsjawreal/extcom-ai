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

// content.js and pageInsert.js are loaded as classic (non-module) scripts, so
// they must not share ES-module chunks with other entries. The popup (a real
// module page) is built in a second pass (--mode popup) to keep the main
// entries self-contained.
export default defineConfig(({ mode }) => {
  const isPopupBuild = mode === "popup";

  return {
    plugins: isPopupBuild ? [] : [copyManifest()],
    build: {
      outDir: "dist",
      emptyOutDir: !isPopupBuild,
      sourcemap: true,
      rollupOptions: {
        input: isPopupBuild
          ? { popup: resolve(import.meta.dirname, "popup.html") }
          : {
              content: resolve(import.meta.dirname, "src/content/index.ts"),
              pageInsert: resolve(import.meta.dirname, "src/page/pageInsert.ts"),
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
  };
});
