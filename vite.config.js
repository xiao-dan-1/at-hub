import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

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

export default defineConfig({
  root: "src",
  base: "./",
  plugins: [stripOfflineCspInDev(), viteSingleFile()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    sourcemap: false,
    modulePreload: { polyfill: false },
  },
});
