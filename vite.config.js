import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const pageEntries = {
  index: "src/index.html",
  subscription: "src/subscription.html",
};

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
  if (!pageEntries[page]) {
    throw new Error(`Unknown AT_INSPECTOR_PAGE: ${page}`);
  }

  return {
    root: "src",
    base: "./",
    plugins: [stripOfflineCspInDev(), viteSingleFile()],
    build: {
      outDir: "../dist",
      emptyOutDir: page === "index",
      cssCodeSplit: false,
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      sourcemap: false,
      modulePreload: { polyfill: false },
      rollupOptions: {
        input: resolve(projectRoot, pageEntries[page]),
      },
    },
  };
});
