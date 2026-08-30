import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../src/subscription.html", import.meta.url), "utf8");
const js = readFileSync(new URL("../src/subscription.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const eligibility = readFileSync(new URL("../src/core/subscription-eligibility.js", import.meta.url), "utf8");

test("subscription page declares local-service network boundary", () => {
  assert.match(html, /ChatGPT 订阅查询/u);
  assert.match(html, /本地服务 · 会联网/u);
  assert.match(html, /不保存输入/u);
  assert.match(html, /connect-src 'self'/u);
  assert.match(html, /id="subscriptionInput"/u);
  assert.match(html, /id="subscriptionRunButton"/u);
});

test("subscription initial query surface removes developer and duplicate safety noise", () => {
  assert.doesNotMatch(html, /data-dev-smoke|Docker dev hot reload/u);
  assert.doesNotMatch(html, /<footer/u);
  assert.doesNotMatch(html, /本页通过本地服务查询/u);
  assert.match(html, /class="subscription-query__heading"/u);
  assert.match(html, /<label[^>]*>粘贴 AT<\/label>/u);
  assert.match(html, /class="query-privacy"[^>]*>不保存输入<\/span>/u);
  assert.match(html, /placeholder="每行一个 AT；也支持 session JSON 或 email----pwd----2fa----at"/u);
  assert.match(css, /\.subscription-query__heading\s*\{/u);
  assert.match(css, /\.query-privacy\s*\{/u);
  assert.doesNotMatch(css, /\.dev-smoke-badge\s*\{/u);
});

test("subscription page exposes inline current IP feedback beside the debug button", () => {
  assert.match(html, /id="subscriptionIpButton"/u);
  assert.match(html, /id="subscriptionIpStatus"/u);
  assert.match(html, /出口国家/u);
  assert.doesNotMatch(html, /id="subscriptionIpPanel"/u);
  assert.match(js, /fetch\("\/api\/ip-info"/u);
  assert.match(js, /renderIpInlineStatus/u);
  assert.match(js, /ipStatus\.textContent/u);
  assert.match(js, /data\.ip/u);
  assert.match(js, /data\.country/u);
  assert.doesNotMatch(js, /renderIpInfoField/u);
  assert.doesNotMatch(js, /ipPanel/u);
  assert.match(css, /\.ip-inline-status\s*\{/u);
  assert.doesNotMatch(css, /\.ip-info-panel\s*\{/u);
});

test("subscription page participates in the shared tool navigation", () => {
  assert.match(html, /<nav class="tool-nav" aria-label="AT 工具" data-tool-navigation data-current-page="subscription"><\/nav>/u);
  assert.doesNotMatch(html, /返回本地解析/u);
  assert.match(js, /configureToolNavigation/u);
});

test("subscription controller calls only the local subscription endpoint", () => {
  assert.match(js, /fetch\("\/api\/subscription"/u);
  assert.doesNotMatch(js, /chatgpt\.com|chat\.openai\.com/u);
  assert.match(js, /extractAccessTokens/u);
  assert.match(js, /renderSubscriptionResult/u);
});

test("subscription page supports batch subscription lookups without leaving the local service", () => {
  assert.match(html, /批量查看套餐、试用资格与有效期/u);
  assert.doesNotMatch(html, /最多 20 个/u);
  assert.match(html, /email----pwd----2fa----at/u);
  assert.doesNotMatch(js, /tokens\.length\s*>\s*20/u);
  assert.doesNotMatch(js, /最多一次查询 20 个 AT/u);
  assert.match(js, /fetch\("\/api\/subscriptions\/batch"/u);
  assert.match(js, /tokens\.length === 1/u);
  assert.match(js, /renderSubscriptionBatchResult/u);
  assert.match(js, /fetch\("\/api\/subscriptions\/stream"/u);
  assert.match(js, /renderSubscriptionBatchItem/u);
  assert.match(js, /subscription-batch-summary/u);
  assert.match(js, /state\.partial/u);
  assert.match(js, /subscriptionResultNeedsRetry/u);
  assert.match(css, /\.subscription-batch-summary\s*\{/u);
  assert.match(css, /\.subscription-batch-list\s*\{/u);
  assert.match(css, /\.subscription-card--error\s*\{/u);
});

test("subscription batch results use a compact eligibility table instead of repeated large cards", () => {
  assert.match(js, /renderSubscriptionBatchRow/u);
  assert.match(js, /renderSubscriptionBatchHeader/u);
  assert.match(js, /buildEligibilityDisplay/u);
  assert.match(js, /renderSubscriptionStage/u);
  assert.match(js, /class="subscription-batch-table subscription-batch-list"/u);
  assert.match(js, /class="subscription-row__trial"/u);
  assert.match(js, /class="subscription-row__stage"/u);
  assert.match(js, /class="subscription-row__timing"/u);
  assert.match(js, /renderTiming/u);
  assert.match(js, /优惠未确认/u);
  assert.doesNotMatch(js, /renderSubscriptionCard\(item,\s*\{\s*indexLabel/u);
  assert.match(css, /\.subscription-batch-table\s*\{/u);
  assert.match(css, /\.subscription-row--header\s*\{/u);
  assert.match(css, /\.subscription-row\s*\{/u);
  assert.match(css, /\.subscription-row__trial\[data-state="available"\]/u);
  assert.match(css, /\.subscription-row__trial strong, \.subscription-row__trial small\s*\{[^}]*text-overflow:\s*ellipsis/u);
  assert.match(css, /\.subscription-row__stage\s*\{/u);
});

test("subscription failed rows keep local JWT identity and a more specific auth diagnosis visible", () => {
  assert.match(js, /localSubscriptionIdentity/u);
  assert.match(js, /renderAuthFailureStage/u);
  assert.match(js, /auth_failure_hint/u);
  assert.match(js, /local_token_status/u);
  assert.match(js, /upstream_error_code/u);
  assert.match(js, /upstream_error_message/u);
  assert.match(js, /JWT 已过期/u);
  assert.match(js, /账号封禁/u);
  assert.match(js, /Token 失效/u);
  assert.match(js, /上游拒认/u);
  assert.match(js, /data-state="auth"/u);
});

test("subscription input keeps the original content and reports extraction accounting", () => {
  assert.match(html, /id="subscriptionInput"[\s\S]*wrap="off"/u);
  assert.doesNotMatch(js, /input\.value = formatSubscriptionInputLines\(tokens\)/u);
  assert.match(js, /input_line_count/u);
  assert.match(js, /duplicate_count/u);
  assert.match(js, /unrecognized_line_count/u);
  assert.match(js, /已识别/u);
  assert.match(js, /一行一个/u);
  assert.doesNotMatch(js, /runSubscriptionQuery[\s\S]*input\.value = "";\s*try/u);
});

test("subscription batch summary highlights trial eligibility counts", () => {
  assert.match(js, /availablePromoCount/u);
  assert.match(js, /activeSubscriptionCount/u);
  assert.match(js, /renderBatchStat/u);
  assert.match(js, /class="subscription-batch-stats"/u);
  assert.match(js, /data-kind="trial"/u);
  assert.match(js, /renderBatchStat\("可用优惠",\s*trial/u);
  assert.match(css, /\.subscription-batch-stats\s*\{/u);
  assert.match(css, /\.subscription-batch-stat\s*\{/u);
  assert.match(css, /\.subscription-batch-stat\[data-kind="trial"\]\s*\{/u);
});

test("subscription batch summary can retry incomplete items without keeping raw tokens in the DOM", () => {
  assert.match(js, /lastSubscriptionBatchTokens/u);
  assert.match(js, /retryIncompleteSubscriptionItems/u);
  assert.match(js, /data-retry-incomplete/u);
  assert.match(js, /重试未完成项/u);
  assert.match(js, /subscriptionResultNeedsRetry/u);
  assert.match(js, /runSubscriptionBatchStream\(retryTokens/u);
  assert.doesNotMatch(js, /data-token=/u);
  assert.match(css, /\.subscription-batch-retry\s*\{/u);
});

test("every subscription result keeps an egress location and per-item retest control without exposing AT values", () => {
  assert.match(js, /egress_country/u);
  assert.match(js, /formatEgressCountry/u);
  assert.match(js, /subscription-row__egress/u);
  assert.match(js, /出口国家/u);
  assert.match(js, /当前出口国家/u);
  assert.match(js, /renderResultRetryButton/u);
  assert.match(js, /retrySubscriptionResult/u);
  assert.match(js, /data-retry-single/u);
  assert.match(js, /data-retry-index/u);
  assert.match(js, /lastSubscriptionSingleToken/u);
  assert.doesNotMatch(js, /data-token=/u);
  assert.match(css, /\.subscription-row__egress/u);
  assert.match(css, /\.subscription-result-retry\s*\{/u);
});

test("subscription batch table shares one aligned column grid", () => {
  assert.match(css, /--subscription-row-columns:/u);
  assert.match(css, /\.subscription-row\s*\{[^}]*grid-template-columns:\s*var\(--subscription-row-columns\)/u);
  assert.match(css, /\.subscription-row > :nth-child\(3\)/u);
  assert.match(css, /\.subscription-row > :nth-child\(6\)/u);
  assert.match(css, /\.subscription-row__account\s*\{[^}]*justify-self:\s*stretch/u);
  assert.match(css, /\.subscription-row__account strong\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal/u);
  assert.match(css, /\.subscription-page \.app-bar__inner, \.subscription-page \.app-shell, \.subscription-page \.app-footer\s*\{[^}]*width:\s*min\(100% - 40px,\s*1180px\)/u);
  assert.match(css, /\.subscription-row \.subscription-status-pill\s*\{[^}]*min-width:/u);
});

test("subscription row JSON expansion stays bounded inside the batch table", () => {
  assert.match(css, /\.subscription-row__json\[open\]\s*\{[^}]*grid-column:\s*1 \/ -1/u);
  assert.match(css, /\.subscription-row__json\[open\]\s*\{[^}]*min-width:\s*0/u);
  assert.match(css, /\.subscription-row__json\[open\]\s*\{[^}]*justify-self:\s*stretch/u);
  assert.match(css, /\.subscription-row__json pre\s*\{[^}]*box-sizing:\s*border-box/u);
  assert.match(css, /\.subscription-row__json pre\s*\{[^}]*max-width:\s*100%/u);
  assert.match(css, /\.subscription-row__json pre\s*\{[^}]*white-space:\s*pre-wrap/u);
  assert.match(css, /\.subscription-row__json pre\s*\{[^}]*overflow-wrap:\s*anywhere/u);
});

test("subscription streaming batch rows stay in original input order", () => {
  assert.match(js, /sortSubscriptionResults/u);
  assert.match(js, /renderSubscriptionBatchRows/u);
  assert.match(js, /items:\s*\[\]/u);
  assert.match(js, /sortSubscriptionResults\(results\)/u);
  assert.doesNotMatch(js, /list\.insertAdjacentHTML\("beforeend",\s*renderSubscriptionBatchRow\(item\)\)/u);
});

test("subscription streaming verifies done and retries missing indexes once", () => {
  assert.match(js, /receivedDone/u);
  assert.match(js, /doneCount/u);
  assert.match(js, /missingSubscriptionIndexes/u);
  assert.match(js, /createIncompleteSubscriptionResult/u);
  assert.match(js, /consumeSubscriptionBatchAttempt/u);
  assert.match(js, /retryMissing/u);
  assert.match(js, /stream-incomplete/u);
  assert.match(js, /已保留上一次结果/u);
  assert.match(js, /integrityConfirmed/u);
  assert.match(js, /批量结果待确认/u);
});

test("subscription queries abort stale streams and ignore stale rendering", () => {
  assert.match(js, /activeSubscriptionRequestId/u);
  assert.match(js, /activeSubscriptionController/u);
  assert.match(js, /new AbortController\(\)/u);
  assert.match(js, /signal/u);
  assert.match(js, /isActiveSubscriptionRequest/u);
  assert.match(js, /activeSubscriptionController\?\.abort\(\)/u);
});

test("subscription summary separates complete, partial, and hard failure results", () => {
  assert.match(js, /state\.partial/u);
  assert.match(js, /renderBatchStat\("待补查"/u);
  assert.match(js, /subscriptionResultNeedsRetry/u);
  assert.match(js, /subscription_detail_status/u);
  assert.match(js, /offers_status/u);
  assert.match(js, /eligibility_unconfirmed_due_to_egress/u);
  assert.match(js, /出口漂移/u);
  assert.match(eligibility, /eligible_promos/u);
  assert.match(css, /\.subscription-batch-stat\[data-kind="partial"\] strong/u);
});

test("subscription result keeps subscription status and AT validity separate", () => {
  assert.match(js, /剩余时间/u);
  assert.match(js, /AT 有效期/u);
  assert.match(js, /token_days_left/u);
  assert.match(js, /eligible_promos/u);
  assert.match(eligibility, /is_eligible_for_free_trial/u);
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
  assert.match(css, /\.subscription-query\s*\{[^}]*box-shadow:\s*0 8px 24px/u);
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

test("subscription result card reads as a lighter report below the stable input", () => {
  assert.match(css, /\.subscription-result\s*\{[^}]*margin-top:\s*-2px/u);
  assert.match(css, /\.subscription-card\s*\{[^}]*background:\s*var\(--surface\)/u);
  assert.match(css, /\.subscription-card\s*\{[^}]*border:\s*1px solid color-mix\(in srgb,\s*var\(--line\) 88%/u);
  assert.match(css, /\.subscription-card\s*\{[^}]*box-shadow:\s*0 14px 34px rgba\(27,\s*42,\s*34,\s*0\.04\)/u);
  assert.doesNotMatch(css, /\.subscription-card\s*\{[^}]*var\(--primary/u);
});

test("subscription input stays visually identical after a successful result", () => {
  assert.match(js, /dataset\.hasResult/u);
  assert.match(js, /renderInputTokenStatus\(extracted,\s*data\?\.ok\s*\?\s*"查询完成 · 保留"\s*:\s*"查询失败 · 保留"\)/u);
  assert.match(css, /\.subscription-query\s*\{[^}]*padding:\s*18px/u);
  assert.match(css, /\.subscription-query textarea\s*\{[^}]*min-height:\s*118px/u);
  assert.match(css, /\.subscription-query textarea\s*\{[^}]*margin-top:\s*10px/u);
  assert.match(css, /\.subscription-query textarea\s*\{[^}]*white-space:\s*pre/u);
  assert.doesNotMatch(css, /\.subscription-shell\[data-has-result="true"\]\s*\{/u);
  assert.doesNotMatch(css, /\.subscription-shell\[data-has-result="true"\]\s+\.subscription-query/u);
  assert.doesNotMatch(css, /\.subscription-shell\[data-has-result="true"\]\s+\.network-boundary/u);
});

test("subscription privacy copy stays short and visually subordinate", () => {
  assert.match(css, /\.query-privacy\s*\{[^}]*color:\s*var\(--muted\)/u);
  assert.match(css, /\.query-privacy\s*\{[^}]*font-size:\s*0\.74rem/u);
  assert.doesNotMatch(html, /不保存、不记录原始 AT/u);
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
  assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*\.subscription-query\s*\{[^}]*padding:\s*16px/u);
  assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*\.subscription-query textarea\s*\{[^}]*white-space:\s*pre-wrap/u);
  assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*\.subscription-query textarea\s*\{[^}]*overflow-x:\s*hidden/u);
  assert.doesNotMatch(css, /@media \(max-width: 700px\) \{[\s\S]*\.subscription-shell\[data-has-result="true"\] \.subscription-query/u);
});

test("subscription metrics read as quiet tiles instead of a bordered table", () => {
  assert.match(css, /\.subscription-grid\s*\{[^}]*gap:\s*8px/u);
  assert.match(css, /\.subscription-grid\s*\{[^}]*background:\s*transparent/u);
  assert.match(css, /\.subscription-grid\s*\{[^}]*border:\s*0/u);
  assert.match(css, /\.subscription-metric\s*\{[^}]*border:\s*1px solid/u);
  assert.doesNotMatch(css, /\.subscription-metric\s*\{[^}]*border-left:/u);
});
