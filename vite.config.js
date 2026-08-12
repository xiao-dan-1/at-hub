import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { getPageById } from "./src/core/pages.js";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

function stripOfflineCspInDev() {
  return {
    name: "strip-offline-csp-in-dev",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace(
        /\s*<meta\s+http-equiv="Content-Security-Policy"[^>]*>\s*/iu,
        "\n",
      );
    },
  };
}

export default defineConfig(() => {
  const page = process.env.AT_INSPECTOR_PAGE ?? "index";
  const pageEntry = getPageById(page);
  if (!pageEntry) {
    throw new Error(`Unknown AT_INSPECTOR_PAGE: ${page}`);
  }

  return {
    root: "src",
    base: "./",
    plugins: [stripOfflineCspInDev(), viteSingleFile()],
    build: {
      outDir: "../dist",
      emptyOutDir: pageEntry.id === "index",
      cssCodeSplit: false,
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      sourcemap: false,
      modulePreload: { polyfill: false },
      rollupOptions: {
        input: resolve(projectRoot, pageEntry.source),
      },
    },
  };
});
