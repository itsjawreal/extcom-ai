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

// content.js and pageInsert.js are loaded as classic (non-module) scripts —
// they cannot contain `import` statements. The background service worker
// IS a real ES module (manifest.json sets background.type: "module") and
// the popup is a real module page, so both can safely use ES imports.
//
// Rollup shares a chunk across entries whenever they import the same
// module *within one build*. serviceWorker.ts and content/panel.ts both
// import from shared/constants.ts, so if they were bundled together Rollup
// would hoist that into a shared chunks/*.js file and inject an `import`
// into content.js — which throws "Cannot use import statement outside a
// module" at runtime, since content scripts load as classic scripts. Each
// group below gets its own separate `vite build` invocation so their
// module graphs never mix and nothing gets shared out into a chunk that a
// classic script would need to `import`.
export default defineConfig(({ mode }) => {
  const isPopupBuild = mode === "popup";
  const isServiceWorkerBuild = mode === "sw";
  const isMainBuild = !isPopupBuild && !isServiceWorkerBuild;

  return {
    plugins: isMainBuild ? [copyManifest()] : [],
    build: {
      outDir: "dist",
      emptyOutDir: isMainBuild,
      sourcemap: true,
      rollupOptions: {
        input: isPopupBuild
          ? { popup: resolve(import.meta.dirname, "popup.html") }
          : isServiceWorkerBuild
            ? { serviceWorker: resolve(import.meta.dirname, "src/background/serviceWorker.ts") }
            : {
                content: resolve(import.meta.dirname, "src/content/index.ts"),
                pageInsert: resolve(import.meta.dirname, "src/page/pageInsert.ts"),
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
