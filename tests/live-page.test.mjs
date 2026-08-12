import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../src/live.html", import.meta.url), "utf8");
const js = readFileSync(new URL("../src/live.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("AT live page declares a local-service backend-api me check", () => {
  assert.match(html, /AT 测活/u);
  assert.match(html, /backend-api\/me/u);
  assert.match(html, /最多 100 个/u);
  assert.match(html, /connect-src 'self'/u);
  assert.match(html, /id="liveInput"/u);
  assert.match(html, /id="liveCountHint"/u);
  assert.match(html, /id="liveRunButton"/u);
  assert.match(html, /data-tool-navigation data-current-page="live"/u);
  assert.match(js, /fetch\("\/api\/at-live"/u);
  assert.match(js, /fetch\("\/api\/at-live\/batch"/u);
  assert.doesNotMatch(js, /chatgpt\.com|chat\.openai\.com/u);
});

test("AT live page uses the shared visual system", () => {
  assert.match(js, /renderLiveResult/u);
  assert.match(js, /renderLiveBatchResult/u);
  assert.match(css, /\.live-card\s*\{/u);
  assert.match(css, /\.live-status-pill/u);
  assert.match(css, /\.live-card__facts\s*\{/u);
});

test("AT live single result card keeps identity primary and metrics subordinate", () => {
  assert.match(js, /renderLiveFact/u);
  assert.match(js, /class="live-card__eyebrow"/u);
  assert.match(js, /class="live-card__facts"/u);
  assert.doesNotMatch(js, /<h2>\$\{escapeHtml\(statusLabel\(data\)\)\}<\/h2>/u);
  assert.doesNotMatch(css, /\.live-card__identity h2\s*\{[^}]*font-size:\s*1\.45rem/u);
  assert.match(css, /\.live-card__identity h2\s*\{[^}]*font-size:\s*1\.08rem/u);
  assert.match(css, /\.live-fact\s*\{/u);
  assert.match(css, /\.live-fact:not\(:first-child\)\s*\{/u);
});

test("AT live batch results render as a compact list instead of repeated large cards", () => {
  assert.match(js, /renderLiveBatchRow/u);
  assert.match(js, /class="live-table"/u);
  assert.doesNotMatch(js, /renderLiveCard\(item,\s*\{\s*indexLabel/u);
  assert.match(css, /\.live-table\s*\{/u);
  assert.match(css, /\.live-row\s*\{/u);
  assert.match(css, /\.live-row__json/u);
});

test("AT live batch card reads as one quiet table-like card", () => {
  assert.match(css, /\.live-table\s*\{[^}]*overflow:\s*hidden/u);
  assert.match(css, /\.live-row\s*\{[^}]*box-shadow:\s*none/u);
  assert.match(css, /\.live-row\s*\{[^}]*border:\s*0/u);
  assert.match(css, /\.live-row:not\(:last-child\)\s*\{/u);
  assert.match(css, /\.live-row__json\[open\]\s*\{/u);
  assert.match(css, /\.live-row:hover\s*\{/u);
});

test("AT live input keeps the initial state quiet and focused", () => {
  assert.doesNotMatch(html, /去订阅查询/u);
  assert.match(html, /for="liveInput">粘贴 AT/u);
  assert.match(css, /\.live-query textarea:focus-visible\s*\{[^}]*outline:\s*none/u);
  assert.match(css, /\.live-query textarea:focus\s*\{[^}]*box-shadow:\s*0 0 0 2px/u);
  assert.match(css, /\.live-query \.network-boundary\s*\{[^}]*font-size:\s*0\.76rem/u);
  assert.match(css, /\.input-counter\s*\{/u);
  assert.match(js, /liveCountHint/u);
  assert.match(js, /updateLiveCountHint/u);
  assert.match(js, /setLastLiveCountHint/u);
  assert.match(js, /addEventListener\("input",\s*updateLiveCountHint\)/u);
  assert.match(html, /一行一个 AT/u);
  assert.match(html, /等待粘贴/u);
  assert.doesNotMatch(html, /未识别 AT/u);
  assert.match(js, /上次测活 \$\{count\} 个 AT/u);
  assert.doesNotMatch(js, /最多一次测活 20 个 AT/u);
  assert.match(js, /MAX_BATCH_TOKENS\s*=\s*100/u);
  assert.match(js, /最多一次测活 \$\{MAX_BATCH_TOKENS\} 个 AT/u);
});
