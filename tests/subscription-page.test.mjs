import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../src/subscription.html", import.meta.url), "utf8");
const js = readFileSync(new URL("../src/subscription.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("subscription page declares local-service network boundary", () => {
  assert.match(html, /ChatGPT 订阅查询/u);
  assert.match(html, /本地服务/u);
  assert.match(html, /会联网查询/u);
  assert.match(html, /connect-src 'self'/u);
  assert.match(html, /id="subscriptionInput"/u);
  assert.match(html, /id="subscriptionRunButton"/u);
});

test("subscription controller calls only the local subscription endpoint", () => {
  assert.match(js, /fetch\("\/api\/subscription"/u);
  assert.doesNotMatch(js, /chatgpt\.com|chat\.openai\.com/u);
  assert.match(js, /extractAccessTokens/u);
  assert.match(js, /renderSubscriptionResult/u);
});

test("subscription page has compact result cards matching current visual system", () => {
  assert.match(css, /\.subscription-card\s*\{/u);
  assert.match(css, /\.subscription-grid\s*\{/u);
  assert.match(css, /\.subscription-status-pill/u);
  assert.match(css, /\.network-boundary/u);
});
