import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import config from "../vite.config.js";

const sourceHtml = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const resolvedConfig = typeof config === "function"
  ? config({ command: "serve", mode: "development" })
  : config;

function runIndexTransform(plugin, html) {
  const hook = plugin?.transformIndexHtml;
  if (typeof hook === "function") return hook(html);
  if (typeof hook?.handler === "function") return hook.handler(html);
  return html;
}

test("dev server strips the offline CSP before Vite injects module assets", () => {
  const plugin = resolvedConfig.plugins.find(candidate => candidate?.name === "strip-offline-csp-in-dev");

  assert.equal(plugin?.apply, "serve");
  assert.match(sourceHtml, /http-equiv="Content-Security-Policy"/u);
  assert.doesNotMatch(runIndexTransform(plugin, sourceHtml), /http-equiv="Content-Security-Policy"/u);
});
