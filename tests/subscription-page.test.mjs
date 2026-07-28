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

test("subscription result avoids redundant labels while keeping secondary detail as an open ledger", () => {
  assert.doesNotMatch(js, /<p class="eyebrow">单个 AT<\/p>/u);
  assert.match(css, /\.subscription-detail-panel\s*\{[^}]*background:\s*transparent/u);
  assert.match(css, /\.subscription-detail-panel\s*\{[^}]*border:\s*0/u);
  assert.match(css, /\.subscription-detail-panel\s*\{[^}]*padding:\s*0 2px/u);
  assert.match(css, /\.subscription-facts\s*\{[^}]*border-top:\s*1px solid/u);
  assert.match(css, /\.subscription-facts\s*\{[^}]*border-bottom:\s*1px solid/u);
  assert.match(css, /\.subscription-facts div\s*\{[^}]*border-left:\s*0/u);
});

test("subscription input quiets down after a successful result while staying editable", () => {
  assert.match(js, /dataset\.hasResult/u);
  assert.match(css, /\.subscription-shell\[data-has-result="true"\] \.subscription-query/u);
  assert.match(css, /\.subscription-shell\[data-has-result="true"\] \.subscription-query textarea/u);
  assert.match(css, /\.subscription-shell\[data-has-result="true"\] \.subscription-query:focus-within textarea/u);
});

test("subscription finished state keeps utility chrome lighter than the result", () => {
  assert.match(css, /\.subscription-shell\[data-has-result="true"\] \.network-boundary\s*\{[^}]*display:\s*none/u);
  assert.match(css, /\.subscription-shell\[data-has-result="true"\] \.subscription-query\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto/u);
  assert.match(css, /\.subscription-shell\[data-has-result="true"\] \.subscription-query textarea\s*\{[^}]*min-height:\s*48px/u);
  assert.match(css, /\.subscription-shell\[data-has-result="true"\] \.subscription-query textarea\s*\{[^}]*max-height:\s*48px/u);
  assert.match(css, /\.subscription-shell\[data-has-result="true"\] \.subscription-query:focus-within textarea\s*\{[^}]*max-height:\s*220px/u);
  assert.match(css, /\.subscription-shell\[data-has-result="true"\] \.subscription-query \.input-actions\s*\{[^}]*margin-top:\s*0/u);
  assert.match(css, /\.subscription-json\s*\{[^}]*padding:\s*10px 2px 0/u);
});

test("subscription finished dock hides redundant visual-only helper chrome", () => {
  assert.match(css, /\.subscription-shell\[data-has-result="true"\] \.subscription-label\s*\{[^}]*position:\s*absolute/u);
  assert.match(css, /\.subscription-shell\[data-has-result="true"\] \.subscription-label\s*\{[^}]*clip:\s*rect\(0,\s*0,\s*0,\s*0\)/u);
  assert.match(css, /\.subscription-shell\[data-has-result="true"\] \.subscription-query \.keyboard-hint\s*\{[^}]*position:\s*absolute/u);
  assert.match(css, /\.subscription-shell\[data-has-result="true"\] \.subscription-query \.input-actions \.keyboard-hint\s*\{[^}]*position:\s*absolute/u);
  assert.match(css, /\.subscription-shell\[data-has-result="true"\] \.subscription-query\s*\{[^}]*gap:\s*0 12px/u);
});

test("subscription finished input row drops the extra outer card", () => {
  assert.match(css, /\.subscription-shell\[data-has-result="true"\] \.subscription-query\s*\{[^}]*background:\s*transparent/u);
  assert.match(css, /\.subscription-shell\[data-has-result="true"\] \.subscription-query\s*\{[^}]*border:\s*0/u);
  assert.match(css, /\.subscription-shell\[data-has-result="true"\] \.subscription-query\s*\{[^}]*border-radius:\s*0/u);
  assert.match(css, /\.subscription-shell\[data-has-result="true"\] \.subscription-query\s*\{[^}]*padding:\s*0/u);
});

test("subscription raw JSON disclosure stays visually subordinate to the result card", () => {
  assert.match(css, /\.subscription-json\s*\{[^}]*background:\s*transparent/u);
  assert.match(css, /\.subscription-json\s*\{[^}]*border:\s*0/u);
  assert.match(css, /\.subscription-json\s*\{[^}]*border-top:\s*1px solid/u);
  assert.match(css, /\.subscription-json summary\s*\{[^}]*font-size:\s*0\.82rem/u);
});

test("inactive subscription status reads as neutral instead of warning", () => {
  assert.match(css, /\.subscription-status-pill\s*\{[^}]*color:\s*var\(--muted\)/u);
  assert.match(css, /\.subscription-status-pill\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--surface-subtle\)/u);
  assert.doesNotMatch(css, /\.subscription-status-pill\s*\{[^}]*var\(--warning\)/u);
  assert.match(css, /\.subscription-status-pill\[data-active="true"\]\s*\{[^}]*color:\s*var\(--primary-strong\)/u);
});

test("subscription mobile layout gives long metric values room", () => {
  assert.match(css, /@media \(max-width: 520px\) \{[^}]*\.subscription-grid\s*\{\s*grid-template-columns:\s*1fr/u);
  assert.match(css, /\.subscription-metric\s*\{[^}]*border-radius:\s*10px/u);
  assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*\.subscription-shell\[data-has-result="true"\] \.subscription-query textarea\s*\{[^}]*min-height:\s*72px/u);
});

test("subscription metrics read as quiet tiles instead of a bordered table", () => {
  assert.match(css, /\.subscription-grid\s*\{[^}]*gap:\s*8px/u);
  assert.match(css, /\.subscription-grid\s*\{[^}]*background:\s*transparent/u);
  assert.match(css, /\.subscription-grid\s*\{[^}]*border:\s*0/u);
  assert.match(css, /\.subscription-metric\s*\{[^}]*border:\s*1px solid/u);
  assert.doesNotMatch(css, /\.subscription-metric\s*\{[^}]*border-left:/u);
});
