import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import config from "../vite.config.js";

const readText = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
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
  const sourceHtml = readText("../src/index.html");

  assert.equal(plugin?.apply, "serve");
  assert.match(sourceHtml, /http-equiv="Content-Security-Policy"/u);
  assert.doesNotMatch(runIndexTransform(plugin, sourceHtml), /http-equiv="Content-Security-Policy"/u);
});

test("dev server combines Vite source serving with the local subscription APIs", () => {
  const devServerUrl = new URL("../server/dev-server.mjs", import.meta.url);
  assert.equal(existsSync(devServerUrl), true);

  const source = readText("../server/dev-server.mjs");
  assert.match(source, /createViteServer/u);
  assert.match(source, /middlewareMode:\s*true/u);
  assert.match(source, /getPageByRoute/u);
  assert.match(source, /page\.source/u);
  assert.match(source, /transformIndexHtml/u);
  assert.match(source, /\/api\/subscription/u);
  assert.match(source, /\/api\/subscriptions\/batch/u);
  assert.match(source, /\/api\/subscriptions\/stream/u);
  assert.match(source, /\/api\/at-live/u);
  assert.match(source, /\/api\/at-live\/batch/u);
  assert.match(source, /\/api\/ip-info/u);
  assert.match(source, /createSubscriptionHandler/u);
  assert.match(source, /createSubscriptionBatchHandler/u);
  assert.match(source, /createSubscriptionBatchStream/u);
  assert.match(source, /createIpInfoHandler/u);
  assert.match(source, /createAtLiveHandler/u);
  assert.match(source, /createAtLiveBatchHandler/u);
  assert.match(source, /createProxyFetch/u);
});

test("dev server shares the configurable request body limit with the local service", () => {
  const source = readText("../server/dev-server.mjs");

  assert.match(source, /readRequestJson/u);
  assert.match(source, /bodyLimitBytes/u);
  assert.doesNotMatch(source, /请求体超过 64 KiB/u);
  assert.doesNotMatch(source, /BODY_LIMIT_BYTES\s*=\s*64\s*\*\s*1024/u);
});

test("package exposes a dev service command for Docker and local debugging", () => {
  const packageJson = JSON.parse(readText("../package.json"));

  assert.match(packageJson.scripts["dev:service"], /node --watch-path=server --watch-path=src\/core server\/dev-server\.mjs/u);
});
