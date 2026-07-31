import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");
const subscriptionHtml = readFileSync(new URL("../dist/subscription.html", import.meta.url), "utf8");
const publishedHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("build emits a self-contained offline parser HTML", () => {
  assert.match(html, /<style[\s>]/u);
  assert.match(html, /<script[^>]*>[\s\S]+<\/script>/u);
  assert.doesNotMatch(html, /<script[^>]+src=/iu);
  assert.doesNotMatch(html, /<link[^>]+rel=["']stylesheet["']/iu);
  assert.match(html, /connect-src 'none'/u);
  assert.doesNotMatch(html, /sourceMappingURL/u);
  assert.doesNotMatch(html, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/u);
});

test("build emits a local-service subscription page", () => {
  assert.match(subscriptionHtml, /<style[\s>]/u);
  assert.match(subscriptionHtml, /<script[^>]*>[\s\S]+<\/script>/u);
  assert.match(subscriptionHtml, /connect-src 'self'/u);
  assert.match(subscriptionHtml, /\/api\/subscription/u);
  assert.doesNotMatch(subscriptionHtml, /chatgpt\.com|chat\.openai\.com/u);
});

test("the standard test command rebuilds the generated artifact first", () => {
  assert.match(packageJson.scripts.test, /npm run build/u);
});

test("the committed root entry is byte-identical to the generated artifact", () => {
  assert.equal(publishedHtml, html);
});
