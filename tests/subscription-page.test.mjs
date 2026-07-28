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

test("subscription result keeps subscription status and AT validity separate", () => {
  assert.match(js, /剩余时间/u);
  assert.match(js, /AT 有效期/u);
  assert.match(js, /token_days_left/u);
  assert.match(js, /eligible_promos/u);
});

test("subscription page has compact result cards matching current visual system", () => {
  assert.match(css, /\.subscription-card\s*\{/u);
  assert.match(css, /\.subscription-grid\s*\{/u);
  assert.match(css, /\.subscription-status-pill/u);
  assert.match(css, /\.network-boundary/u);
});

test("subscription result card separates header, metrics, details, and offers", () => {
  assert.match(js, /subscription-card__account/u);
  assert.match(js, /subscription-detail-panel/u);
  assert.match(js, /subscription-offers/u);
  assert.match(css, /\.subscription-card__account/u);
  assert.match(css, /\.subscription-detail-panel\s*\{/u);
  assert.match(css, /\.subscription-offers\s*\{/u);
});

test("subscription detail area reads as one quiet panel instead of split widgets", () => {
  assert.match(css, /\.subscription-detail-panel\s*\{[^}]*padding:/u);
  assert.match(css, /\.subscription-list-block\s*\{[^}]*border-top:/u);
  assert.doesNotMatch(css, /\.subscription-detail-panel\s*\{[^}]*grid-template-columns:\s*minmax\(270px/u);
  assert.match(css, /\.subscription-query\s*\{[^}]*box-shadow:\s*0 6px 18px/u);
});

test("subscription input quiets down after a successful result while staying editable", () => {
  assert.match(js, /dataset\.hasResult/u);
  assert.match(css, /\.subscription-shell\[data-has-result="true"\] \.subscription-query/u);
  assert.match(css, /\.subscription-shell\[data-has-result="true"\] \.subscription-query textarea/u);
  assert.match(css, /\.subscription-shell\[data-has-result="true"\] \.subscription-query:focus-within textarea/u);
});
