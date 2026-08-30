import { Globe, Radar, ShieldCheck, Trash2, createIcons } from "lucide";
import "./styles.css";
import { readLocalServiceJson } from "./core/local-response.js";
import { buildEligibilityDisplay, hasTrialEligibility } from "./core/subscription-eligibility.js";
import {
  createIncompleteSubscriptionResult,
  isSubscriptionBatchComplete,
  missingSubscriptionIndexes,
  subscriptionResultNeedsRetry,
} from "./core/subscription-batch.js";
import { extractAccessTokens } from "./core/token-extract.js";
import { configureToolNavigation } from "./ui/tool-navigation.js";

createIcons({
  icons: {
    Globe,
    Radar,
    ShieldCheck,
    Trash2,
  },
});

const input = document.getElementById("subscriptionInput");
const runButton = document.getElementById("subscriptionRunButton");
const clearButton = document.getElementById("subscriptionClearButton");
const ipButton = document.getElementById("subscriptionIpButton");
const errorBox = document.getElementById("subscriptionError");
const resultArea = document.getElementById("subscriptionResult");
const ipStatus = document.getElementById("subscriptionIpStatus");
const statusText = document.getElementById("subscriptionStatus");
const shell = document.querySelector(".subscription-shell");
let lastSubscriptionBatchTokens = [];
let lastSubscriptionBatchState = null;
let lastSubscriptionSingleToken = "";
let activeSubscriptionRequestId = 0;
let activeSubscriptionController = null;

configureToolNavigation();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function valueOrDash(value) {
  return value === undefined || value === null || value === "" ? "—" : String(value);
}

function titleCase(value) {
  const text = valueOrDash(value);
  if (text === "—") return text;
  return text.slice(0, 1).toUpperCase() + text.slice(1);
}

function formatBoolean(value) {
  if (value === true) return "是";
  if (value === false) return "否";
  return "—";
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return valueOrDash(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatRemaining(data) {
  if (Number.isFinite(data?.days_left)) {
    if (data.days_left <= 0) return "已到期";
    if (data.days_left >= 1) return `${data.days_left} 天`;
  }
  if (Number.isFinite(data?.hours_left)) return `${data.hours_left} 小时`;
  return "—";
}

function renderTiming(milliseconds) {
  if (!Number.isFinite(milliseconds)) return "—";
  if (milliseconds < 1000) return `${Math.max(0, Math.round(milliseconds))} ms`;
  const seconds = milliseconds / 1000;
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
}

function subscriptionStageState(data) {
  if (!data?.ok && data?.reason === "upstream-auth-failed") return "auth";
  if (!data?.ok) return "failed";
  if (data.eligibility_unconfirmed_due_to_egress === true) return "partial";
  if (data.subscription_detail_status === "failed" || data.offers_status === "unknown") return "partial";
  if (data.subscription_detail_status === "not_found") return "quiet";
  if (Number(data.retry_count) > 0) return "retried";
  return "ok";
}

function renderAuthFailureStage(data) {
  if (data?.reason !== "upstream-auth-failed") return "账号失败";
  if (data.auth_failure_kind === "account_disabled") return "账号封禁";
  if (data.auth_failure_kind === "token_invalidated") return "Token 失效";
  if (data.local_token_status === "expired") return "JWT 已过期";
  if (data.local_token_status === "not_yet_valid") return "尚未生效";
  if (data.local_token_status === "parse_failed") return "格式异常";
  return "上游拒认";
}

function renderSubscriptionStage(data) {
  if (!data?.ok) return renderAuthFailureStage(data);
  if (data.eligibility_unconfirmed_due_to_egress === true) {
    return data.egress_consistency_status === "drifted" ? "出口漂移" : "出口未确认";
  }
  if (data.subscription_detail_status === "failed" || data.offers_status === "unknown") return "优惠未确认";
  if (data.subscription_detail_status === "not_found") return "无订阅详情";
  if (Number(data.retry_count) > 0) return `已重试 ${data.retry_count}`;
  return "订阅已查";
}

function stageStateAttribute(stageState) {
  if (stageState === "auth") return 'data-state="auth"';
  return `data-state="${escapeHtml(stageState)}"`;
}

function localSubscriptionIdentity(data) {
  return {
    primary: valueOrDash(data?.email ?? data?.token_hint),
    secondary: valueOrDash(data?.account_id ?? data?.user_id ?? data?.upstream_error_message ?? data?.auth_failure_hint ?? data?.message ?? data?.reason),
  };
}

function renderInputTokenStatus(extracted, prefix = "已识别") {
  const tokens = Array.isArray(extracted?.tokens) ? extracted.tokens : [];
  if (!Array.isArray(tokens) || tokens.length === 0) {
    statusText.textContent = input.value.trim() ? "未识别 AT · 一行一个 AT" : "";
    return;
  }
  const parts = [
    `${prefix} ${tokens.length} 个 AT`,
    `输入 ${Number(extracted?.input_line_count) || tokens.length} 行`,
  ];
  if (Number(extracted?.duplicate_count) > 0) parts.push(`重复 ${extracted.duplicate_count}`);
  if (Number(extracted?.unrecognized_line_count) > 0) parts.push(`未识别 ${extracted.unrecognized_line_count} 行`);
  parts.push("一行一个");
  statusText.textContent = parts.join(" · ");
}

function beginSubscriptionRequest() {
  activeSubscriptionController?.abort();
  activeSubscriptionRequestId += 1;
  activeSubscriptionController = new AbortController();
  return {
    requestId: activeSubscriptionRequestId,
    controller: activeSubscriptionController,
  };
}

function isActiveSubscriptionRequest(requestId) {
  return requestId === activeSubscriptionRequestId
    && activeSubscriptionController?.signal.aborted !== true;
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

function redactLocalToken(token) {
  const value = String(token ?? "");
  if (!value) return "";
  if (value.length <= 18) return `${value.slice(0, 4)}…`;
  return `${value.slice(0, 12)}…${value.slice(-6)}`;
}

function formatPlan(data) {
  return titleCase(data?.plan_type ?? data?.subscription_plan);
}

function formatTagLabel(item) {
  return typeof item === "string"
    ? item
    : item?.id ?? item?.title ?? item?.promo_campaign_id ?? JSON.stringify(item);
}

function renderTagList(items, emptyText) {
  if (!Array.isArray(items) || items.length === 0) {
    return `<span class="subscription-muted">${escapeHtml(emptyText)}</span>`;
  }
  return items
    .map(item => `<span class="subscription-tag">${escapeHtml(formatTagLabel(item))}</span>`)
    .join("");
}

function formatEgressCountry(data) {
  const before = String(data?.egress_before_country ?? "").trim();
  const after = String(data?.egress_after_country ?? data?.egress_country ?? "").trim();
  if (before && after && before !== after) return `${before}→${after}`;
  const country = String(data?.egress_country ?? "").trim();
  return country || after || before || "未确认";
}

function egressLocationTitle(data) {
  if (data?.egress_consistency_status === "drifted") {
    return `查询前后出口国家发生变化：${data.egress_before_country ?? "未确认"} → ${data.egress_after_country ?? "未确认"}`;
  }
  if (data?.egress_consistency_status === "unconfirmed") {
    return data?.egress_ip_message ?? "查询前后出口国家未能完整确认。";
  }
  if (data?.egress_country) {
    const ip = data.egress_ip ? ` · ${data.egress_ip}` : "";
    const location = [...new Set([
      data.egress_city,
      data.egress_region,
    ].filter(value => typeof value === "string" && value.trim()))].join(" · ");
    return `本次查询出口国家：${formatEgressCountry(data)}${location ? ` · ${location}` : ""}${ip}`;
  }
  return data?.egress_ip_message ?? "本次查询未能确认出口国家。";
}

function renderResultRetryButton({ index } = {}) {
  const attribute = Number.isInteger(index)
    ? `data-retry-index="${escapeHtml(index)}"`
    : "data-retry-single";
  return `<button class="subscription-result-retry" type="button" ${attribute}>复测</button>`;
}

function setIpInlineStatus(text, state = "idle", title = "") {
  ipStatus.textContent = text;
  ipStatus.dataset.state = state;
  ipStatus.title = title || text;
  ipStatus.hidden = false;
}

export function renderIpInlineStatus(data) {
  if (data?.pending) {
    setIpInlineStatus("检测中…", "loading");
    return;
  }

  if (data?.ok === true) {
    const country = valueOrDash(data.country);
    const ip = valueOrDash(data.ip);
    setIpInlineStatus(country, "ok", `当前出口国家：${country}，IP：${ip}`);
    return;
  }

  setIpInlineStatus("国家未确认", "error", data?.message ?? "出口国家查询失败。");
}

function setError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.textContent = "";
  errorBox.hidden = true;
}

function setHasResult(hasResult) {
  if (!shell) return;
  shell.dataset.hasResult = hasResult ? "true" : "false";
}

function renderSubscriptionCard(data, { indexLabel = "" } = {}) {
  const active = data.has_active_subscription === true;
  const plan = formatPlan(data);
  const rawJson = escapeHtml(JSON.stringify(data.raw ?? {}, null, 2));
  const stageState = subscriptionStageState(data);
  const stageText = renderSubscriptionStage(data);
  const offersEmptyText = data.offers_status === "unknown" ? "优惠未确认" : "未返回";
  const promoEmptyText = data.offers_status === "unknown" ? "优惠未确认" : "暂无";
  return `
    <article class="subscription-card">
      <header class="subscription-card__top">
        <div class="subscription-card__identity">
          ${indexLabel ? `<p class="subscription-card__index">${escapeHtml(indexLabel)}</p>` : ""}
          <h2>${escapeHtml(plan)}</h2>
          <p class="subscription-card__account">${escapeHtml(valueOrDash(data.email))}${data.account_id ? ` · ${escapeHtml(data.account_id)}` : ""}</p>
        </div>
        <div class="subscription-card__actions">
          <span class="subscription-status-pill" data-active="${active ? "true" : "false"}">${active ? "有效订阅" : "无活跃订阅"}</span>
          ${renderResultRetryButton()}
        </div>
      </header>
      <p class="subscription-stage-note" ${stageStateAttribute(stageState)}>${escapeHtml(stageText)}</p>

      <section class="subscription-grid" aria-label="订阅概览">
        <div class="subscription-metric">
          <span>剩余时间</span>
          <strong>${escapeHtml(formatRemaining(data))}</strong>
        </div>
        <div class="subscription-metric">
          <span>套餐 ID</span>
          <strong>${escapeHtml(valueOrDash(data.subscription_plan))}</strong>
        </div>
        <div class="subscription-metric">
          <span>续费</span>
          <strong>${escapeHtml(formatBoolean(data.will_renew))}</strong>
        </div>
        <div class="subscription-metric">
          <span>渠道</span>
          <strong>${escapeHtml(valueOrDash(data.purchase_origin_platform))}</strong>
        </div>
      </section>

      <section class="subscription-detail-panel" aria-label="订阅详情">
        <dl class="subscription-facts">
          <div><dt>订阅开始</dt><dd>${escapeHtml(formatDate(data.active_start))}</dd></div>
          <div><dt>订阅结束</dt><dd>${escapeHtml(formatDate(data.expires_at))}</dd></div>
          <div><dt>曾付费</dt><dd>${escapeHtml(formatBoolean(data.has_previously_paid_subscription))}</dd></div>
          <div><dt>AT 有效期</dt><dd>${escapeHtml(formatRemaining({ days_left: data.token_days_left, hours_left: data.token_hours_left }))}</dd></div>
          <div title="${escapeHtml(egressLocationTitle(data))}"><dt>出口国家</dt><dd>${escapeHtml(formatEgressCountry(data))}</dd></div>
        </dl>

        <div class="subscription-offers">
          <div class="subscription-list-block">
            <span>已应用优惠</span>
            <div>${renderTagList(data.applied_discounts, "暂无")}</div>
          </div>
          <div class="subscription-list-block">
            <span>可用优惠</span>
            <div>${renderTagList(data.eligible_promos, promoEmptyText)}</div>
          </div>
          <div class="subscription-list-block">
            <span>资格状态</span>
            <div>${renderEligibilityStatus(data)}</div>
          </div>
          <div class="subscription-list-block">
            <span>可购买套餐</span>
            <div>${renderTagList(data.eligible_offers, offersEmptyText)}</div>
          </div>
        </div>
      </section>

      <details class="json-disclosure subscription-json">
        <summary>查看原始 JSON</summary>
        <pre tabindex="0">${rawJson}</pre>
      </details>
    </article>
  `;
}

function renderSubscriptionErrorCard(data) {
  const index = Number.isFinite(data?.index) ? `第 ${data.index} 个 AT` : "AT";
  const identity = localSubscriptionIdentity(data);
  const stageState = subscriptionStageState(data);
  const stageText = renderSubscriptionStage(data);
  return `
    <article class="subscription-card subscription-card--error">
      <header class="subscription-card__top">
        <div class="subscription-card__identity">
          <p class="subscription-card__index">${escapeHtml(index)}</p>
          <h2>查询失败</h2>
          <p class="subscription-card__account">${escapeHtml(identity.primary)} · ${escapeHtml(identity.secondary)}</p>
        </div>
        <div class="subscription-card__actions">
          <span class="subscription-status-pill">失败</span>
          ${renderResultRetryButton()}
        </div>
      </header>
      <p class="subscription-stage-note" ${stageStateAttribute(stageState)}>${escapeHtml(stageText)}</p>
      <p class="subscription-error-message">${escapeHtml(data?.message ?? "订阅查询失败。")}</p>
      <dl class="subscription-facts subscription-facts--compact">
        <div><dt>原因</dt><dd>${escapeHtml(valueOrDash(data?.reason))}</dd></div>
        <div><dt>状态</dt><dd>${escapeHtml(valueOrDash(data?.status))}</dd></div>
        <div><dt>本地判断</dt><dd>${escapeHtml(valueOrDash(data?.auth_failure_hint ?? data?.local_token_status_label))}</dd></div>
        <div><dt>上游码</dt><dd>${escapeHtml(valueOrDash(data?.upstream_error_code))}</dd></div>
        <div><dt>上游说明</dt><dd>${escapeHtml(valueOrDash(data?.upstream_error_message ?? data?.upstream_error_body_excerpt))}</dd></div>
        <div title="${escapeHtml(egressLocationTitle(data))}"><dt>出口国家</dt><dd>${escapeHtml(formatEgressCountry(data))}</dd></div>
      </dl>
    </article>
  `;
}

function renderEligibilityStatus(data) {
  const eligibility = buildEligibilityDisplay(data);
  return `<span class="subscription-tag" title="${escapeHtml(eligibility.title)}">${escapeHtml(`${eligibility.primary} · ${eligibility.secondary}`)}</span>`;
}

function trialEligibilityState(data) {
  if (!data?.ok) return "unknown";
  return buildEligibilityDisplay(data).state;
}

function trialEligibleCount(results) {
  return results.filter(item => item?.ok && hasTrialEligibility(item)).length;
}

function activeSubscriptionCount(results) {
  return results.filter(item => item?.ok && item.has_active_subscription === true).length;
}

function renderSubscriptionBatchHeader() {
  return `
    <div class="subscription-row subscription-row--header" aria-hidden="true">
      <span>#</span>
      <span>账号</span>
      <span>套餐</span>
      <span>资格</span>
      <span>AT</span>
      <span>订阅</span>
      <span>阶段</span>
      <span>国家</span>
      <span>耗时</span>
      <span>操作</span>
      <span>详情</span>
    </div>
  `;
}

function sortSubscriptionResults(results) {
  return [...results].sort((left, right) => {
    const leftIndex = Number.isFinite(left?.index) ? left.index : Number.MAX_SAFE_INTEGER;
    const rightIndex = Number.isFinite(right?.index) ? right.index : Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
}

function renderSubscriptionBatchRows(results) {
  return sortSubscriptionResults(results)
    .map(item => renderSubscriptionBatchRow(item))
    .join("");
}

function upsertSubscriptionBatchItem(items, item) {
  const next = Array.isArray(items) ? items : [];
  if (!Number.isFinite(item?.index)) {
    next.push(item);
    return next;
  }

  const existingIndex = next.findIndex(entry => entry?.index === item.index);
  if (existingIndex >= 0) next[existingIndex] = item;
  else next.push(item);
  return next;
}

function renderSubscriptionBatchRow(data) {
  const ok = data?.ok === true;
  const active = ok && data.has_active_subscription === true;
  const trialState = trialEligibilityState(data);
  const rawJson = escapeHtml(JSON.stringify(data?.raw ?? data ?? {}, null, 2));
  const localIdentity = localSubscriptionIdentity(data);
  const identity = ok ? valueOrDash(data.email) : localIdentity.primary;
  const secondary = ok ? valueOrDash(data.account_id) : localIdentity.secondary;
  const stageState = subscriptionStageState(data);
  const stageText = renderSubscriptionStage(data);
  const planText = ok ? formatPlan(data) : titleCase(data?.plan_type ?? data?.plan_type_jwt ?? "查询失败");
  const eligibility = ok
    ? buildEligibilityDisplay(data)
    : { primary: "失败", secondary: "—", title: "未返回资格信息", state: "unknown" };

  return `
    <article class="subscription-row${ok ? "" : " subscription-row--error"}" data-active="${active ? "true" : "false"}" data-trial="${trialState}" role="listitem">
      <span class="subscription-row__index">#${escapeHtml(data?.index ?? "—")}</span>
      <div class="subscription-row__account">
        <strong>${escapeHtml(identity)}</strong>
        <span>${escapeHtml(secondary)}</span>
      </div>
      <div class="subscription-row__meta">
        <span>套餐</span>
        <strong>${escapeHtml(planText)}</strong>
      </div>
      <div class="subscription-row__trial" data-trial="${trialState}" data-state="${escapeHtml(eligibility.state)}" title="${escapeHtml(eligibility.title)}">
        <span>资格</span>
        <strong>${escapeHtml(eligibility.primary)}</strong>
        <small>${escapeHtml(eligibility.secondary)}</small>
      </div>
      <div class="subscription-row__meta">
        <span>AT</span>
        <strong>${escapeHtml(ok ? formatRemaining({ days_left: data.token_days_left, hours_left: data.token_hours_left }) : "—")}</strong>
      </div>
      <span class="subscription-status-pill" data-active="${active ? "true" : "false"}">${escapeHtml(ok ? active ? "有效订阅" : "无活跃订阅" : "失败")}</span>
      <div class="subscription-row__stage" ${stageStateAttribute(stageState)} title="${escapeHtml(valueOrDash(data?.retry_message ?? data?.auth_failure_hint ?? data?.subscription_detail_message ?? data?.subscription_detail_reason ?? stageText))}">
        <span>阶段</span>
        <strong>${escapeHtml(stageText)}</strong>
      </div>
      <div class="subscription-row__egress" title="${escapeHtml(egressLocationTitle(data))}">
        <span>出口</span>
        <strong>${escapeHtml(formatEgressCountry(data))}</strong>
      </div>
      <div class="subscription-row__timing" title="${escapeHtml(ok ? `accounts ${renderTiming(data.accounts_ms)} · subscription ${renderTiming(data.subscription_ms)}` : valueOrDash(data?.reason))}">
        <span>耗时</span>
        <strong>${escapeHtml(renderTiming(data?.total_ms))}</strong>
      </div>
      ${renderResultRetryButton({ index: Number(data?.index) })}
      <details class="subscription-row__json">
        <summary>JSON</summary>
        <pre tabindex="0">${rawJson}</pre>
      </details>
    </article>
  `;
}

function renderBatchStat(label, value, { kind = "" } = {}) {
  const kindAttrs = {
    trial: ' data-kind="trial"',
    active: ' data-kind="active"',
    success: ' data-kind="success"',
    partial: ' data-kind="partial"',
    failure: ' data-kind="failure"',
  };
  const kindAttribute = kindAttrs[kind] ?? "";
  return `
    <span class="subscription-batch-stat"${kindAttribute}>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </span>
  `;
}

function renderBatchSummary({
  total = 0,
  completed = 0,
  success = 0,
  failure = 0,
  partial = 0,
  active = 0,
  trial = 0,
  done = false,
  integrityConfirmed = true,
  retrying = false,
} = {}) {
  const canRetryIncomplete = done && (failure + partial) > 0 && !retrying;
  const progressLabel = !done
    ? "批量查询中"
    : integrityConfirmed
    ? "批量查询完成"
    : "批量结果待确认";
  return `
    <section class="subscription-batch-summary" aria-label="批量查询摘要">
      <div class="subscription-batch-progress">
        <strong>${progressLabel}</strong>
        <span>${escapeHtml(completed)}/${escapeHtml(total)} 已完成</span>
      </div>
      <div class="subscription-batch-stats">
        ${renderBatchStat("可试用", trial, { kind: "trial" })}
        ${renderBatchStat("订阅中", active, { kind: "active" })}
        ${renderBatchStat("成功", success, { kind: "success" })}
        ${renderBatchStat("待补查", partial, { kind: "partial" })}
        ${renderBatchStat("失败", failure, { kind: "failure" })}
        ${renderBatchStat("总数", total)}
        ${canRetryIncomplete ? '<button class="subscription-batch-retry" type="button" data-retry-incomplete>重试未完成项</button>' : ""}
      </div>
    </section>
  `;
}

function updateBatchStateCounts(state) {
  const items = Array.isArray(state?.items) ? state.items : [];
  state.completed = items.length;
  state.success = items.filter(item => item?.ok === true && !subscriptionResultNeedsRetry(item)).length;
  state.partial = items.filter(item => item?.ok === true && subscriptionResultNeedsRetry(item)).length;
  state.failure = items.filter(item => item?.ok !== true).length;
  state.active = activeSubscriptionCount(items);
  state.trial = trialEligibleCount(items);
  return state;
}

function attachRetryIncompleteButton() {
  const button = resultArea.querySelector("[data-retry-incomplete]");
  if (button) button.addEventListener("click", retryIncompleteSubscriptionItems);
}

function attachResultRetryButtons() {
  const singleRetry = resultArea.querySelector("[data-retry-single]");
  if (singleRetry) singleRetry.addEventListener("click", () => retrySubscriptionResult());
  for (const button of resultArea.querySelectorAll("[data-retry-index]")) {
    button.addEventListener("click", () => retrySubscriptionResult(Number(button.dataset.retryIndex)));
  }
}

function replaceBatchSummary(state) {
  resultArea.querySelector(".subscription-batch-summary")?.remove();
  resultArea.insertAdjacentHTML("afterbegin", renderBatchSummary(state));
  attachRetryIncompleteButton();
  attachResultRetryButtons();
}

export function renderSubscriptionResult(data) {
  if (!data?.ok) {
    resultArea.innerHTML = renderSubscriptionErrorCard(data);
    resultArea.hidden = false;
    setHasResult(true);
    setError(data?.message ?? "订阅查询失败。");
    attachResultRetryButtons();
    return;
  }

  resultArea.innerHTML = renderSubscriptionCard(data);
  resultArea.hidden = false;
  setHasResult(true);
  attachResultRetryButtons();
}

export function renderSubscriptionBatchResult(data) {
  if (!data?.ok) {
    resultArea.hidden = true;
    setHasResult(false);
    setError(data?.message ?? "批量订阅查询失败。");
    return;
  }

  const results = Array.isArray(data.results) ? data.results : [];
  const state = updateBatchStateCounts({
    total: data.count ?? results.length,
    items: results,
    done: true,
    integrityConfirmed: true,
  });
  lastSubscriptionBatchState = state;
  const rows = renderSubscriptionBatchRows(results);
  resultArea.innerHTML = `
    ${renderBatchSummary(state)}
    <div class="subscription-batch-table subscription-batch-list" role="list">
      ${renderSubscriptionBatchHeader()}
      ${rows}
    </div>
  `;
  resultArea.hidden = false;
  setHasResult(true);
  attachRetryIncompleteButton();
  attachResultRetryButtons();
}

function renderSubscriptionBatchStart(total, state = {
    total,
    completed: 0,
    success: 0,
    failure: 0,
    partial: 0,
    active: 0,
    trial: 0,
    items: [],
    done: false,
    integrityConfirmed: false,
    retrying: false,
  }) {
  state.total = total;
  state.completed = 0;
  state.success = 0;
  state.failure = 0;
  state.partial = 0;
  state.active = 0;
  state.trial = 0;
  state.items = [];
  state.done = false;
  state.integrityConfirmed = false;
  state.retrying = false;
  lastSubscriptionBatchState = state;
  resultArea.innerHTML = `
    ${renderBatchSummary(state)}
    <div class="subscription-batch-table subscription-batch-list" data-batch-list role="list">
      ${renderSubscriptionBatchHeader()}
    </div>
  `;
  resultArea.hidden = false;
  setHasResult(true);
  attachRetryIncompleteButton();
  attachResultRetryButtons();
  return state;
}

export function renderSubscriptionBatchItem(item, state) {
  const list = resultArea.querySelector("[data-batch-list]");
  if (!list) return;
  state.items = upsertSubscriptionBatchItem(state.items, item);
  list.innerHTML = `
    ${renderSubscriptionBatchHeader()}
    ${renderSubscriptionBatchRows(state.items)}
  `;
  updateBatchStateCounts(state);
  replaceBatchSummary(state);
  attachResultRetryButtons();
}

function postSingleSubscription(token, signal) {
  return fetch("/api/subscription", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
    signal,
  });
}

async function retrySubscriptionResult(index) {
  const isBatchItem = Number.isInteger(index) && index > 0;
  const token = isBatchItem
    ? lastSubscriptionBatchTokens[index - 1]
    : lastSubscriptionSingleToken;
  if (!token) return;

  clearError();
  const { requestId, controller } = beginSubscriptionRequest();
  const button = isBatchItem
    ? resultArea.querySelector(`[data-retry-index="${index}"]`)
    : resultArea.querySelector("[data-retry-single]");
  runButton.disabled = true;
  if (button) button.disabled = true;
  statusText.textContent = isBatchItem ? `复测第 ${index} 个 AT…` : "复测中…";

  try {
    const response = await postSingleSubscription(token, controller.signal);
    const data = await readLocalServiceJson(response, { serviceName: "订阅复测接口" });
    if (!isActiveSubscriptionRequest(requestId)) return;
    if (!response.ok && !data?.message) {
      throw new Error(`本机服务返回 HTTP ${response.status}`);
    }
    if (isBatchItem && lastSubscriptionBatchState) {
      renderSubscriptionBatchItem({ ...data, index }, lastSubscriptionBatchState);
      lastSubscriptionBatchState.done = true;
      updateBatchStateCounts(lastSubscriptionBatchState);
      replaceBatchSummary(lastSubscriptionBatchState);
    } else {
      renderSubscriptionResult(data);
    }
    statusText.textContent = "";
  } catch (error) {
    if (!isAbortError(error) && isActiveSubscriptionRequest(requestId)) {
      setError(error instanceof Error ? error.message : "订阅复测失败。");
      statusText.textContent = "复测失败";
    }
  } finally {
    if (requestId === activeSubscriptionRequestId) {
      runButton.disabled = false;
      activeSubscriptionController = null;
    }
  }
}

function postBatchSubscriptions(tokens) {
  return fetch("/api/subscriptions/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tokens }),
  });
}

function streamBatchSubscriptions(tokens, signal) {
  return fetch("/api/subscriptions/stream", {
    method: "POST",
    headers: {
      accept: "text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({ tokens }),
    signal,
  });
}

function getIpInfo() {
  return fetch("/api/ip-info", {
    method: "GET",
    headers: { accept: "application/json" },
  });
}

async function* readEventStream(response) {
  if (!response.body) throw new Error("本机服务没有返回可读取的流。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let splitIndex = buffer.search(/\r?\n\r?\n/u);
    while (splitIndex >= 0) {
      const delimiterMatch = buffer.match(/\r?\n\r?\n/u);
      const rawEvent = buffer.slice(0, splitIndex);
      buffer = buffer.slice(splitIndex + (delimiterMatch?.[0]?.length ?? 2));
      const lines = rawEvent.split(/\r?\n/u);
      const event = lines.find(line => line.startsWith("event: "))?.slice(7) ?? "message";
      const dataText = lines
        .filter(line => line.startsWith("data: "))
        .map(line => line.slice(6))
        .join("\n");
      yield {
        event,
        data: dataText ? JSON.parse(dataText) : {},
      };
      splitIndex = buffer.search(/\r?\n\r?\n/u);
    }
    if (done) break;
  }
}

async function runIpInfoQuery() {
  clearError();
  ipButton.disabled = true;
  renderIpInlineStatus({ pending: true });

  try {
    const response = await getIpInfo();
    const data = await readLocalServiceJson(response, { serviceName: "IP 信息接口" });
    if (!response.ok && !data?.message) {
      throw new Error(`本机服务返回 HTTP ${response.status}`);
    }
    renderIpInlineStatus(data);
  } catch (error) {
    renderIpInlineStatus({
      ok: false,
      reason: "ip-info-request-failed",
      status: 500,
      message: error instanceof Error
        ? `${error.message}。请确认本地服务正在运行。`
        : "IP 信息查询失败。请确认本地服务正在运行。",
    });
  } finally {
    ipButton.disabled = false;
  }
}

function collectIncompleteSubscriptionEntries() {
  const items = Array.isArray(lastSubscriptionBatchState?.items) ? lastSubscriptionBatchState.items : [];
  return sortSubscriptionResults(items)
    .filter(item => subscriptionResultNeedsRetry(item) && Number.isFinite(item?.index))
    .map(item => ({
      index: item.index,
      token: lastSubscriptionBatchTokens[item.index - 1],
    }))
    .filter(entry => entry.token);
}

async function retryIncompleteSubscriptionItems() {
  clearError();
  const incompleteEntries = collectIncompleteSubscriptionEntries();
  const retryTokens = incompleteEntries.map(entry => entry.token);
  if (retryTokens.length === 0 || !lastSubscriptionBatchState) return;

  const { requestId, controller } = beginSubscriptionRequest();
  runButton.disabled = true;
  const retryButton = resultArea.querySelector("[data-retry-incomplete]");
  if (retryButton) retryButton.disabled = true;
  statusText.textContent = `重试未完成项 ${retryTokens.length} 个…`;

  try {
    await runSubscriptionBatchStream(retryTokens, {
      mergeIntoState: lastSubscriptionBatchState,
      indexMap: incompleteEntries.map(entry => entry.index),
      requestId,
      signal: controller.signal,
    });
  } catch (error) {
    if (!isAbortError(error) && isActiveSubscriptionRequest(requestId)) {
      setError(error instanceof Error ? error.message : "重试未完成项失败。");
    }
  } finally {
    if (requestId === activeSubscriptionRequestId) {
      runButton.disabled = false;
      activeSubscriptionController = null;
    }
  }
}

async function consumeSubscriptionBatchAttempt(tokens, {
  state,
  indexMap,
  requestId,
  signal,
} = {}) {
  const response = await streamBatchSubscriptions(tokens, signal);
  if (!response.ok) {
    const data = await readLocalServiceJson(response, { serviceName: "批量订阅流接口" });
    throw new Error(data?.message ?? `本机服务返回 HTTP ${response.status}`);
  }

  let receivedDone = false;
  let doneCount = null;
  const receivedItems = [];

  for await (const message of readEventStream(response)) {
    if (!isActiveSubscriptionRequest(requestId)) {
      throw Object.assign(new Error("查询已取消。"), { name: "AbortError" });
    }
    if (message.event === "start") continue;
    if (message.event === "item") {
      const localIndex = Number(message.data?.index);
      if (!Number.isInteger(localIndex) || localIndex < 1 || localIndex > tokens.length) continue;
      receivedItems.push({ index: localIndex });
      const originalIndex = Array.isArray(indexMap) ? indexMap[localIndex - 1] : localIndex;
      if (!Number.isInteger(originalIndex) || originalIndex < 1) continue;
      renderSubscriptionBatchItem({ ...message.data, index: originalIndex }, state);
      statusText.textContent = `查询中 ${state.completed}/${state.total}`;
      continue;
    }
    if (message.event === "error") {
      throw new Error(message.data?.message ?? "批量订阅查询失败。");
    }
    if (message.event === "done") {
      receivedDone = true;
      doneCount = Number(message.data?.count);
    }
  }

  return {
    receivedDone,
    doneCount,
    items: receivedItems,
    missingIndexes: missingSubscriptionIndexes(tokens.length, receivedItems),
    complete: isSubscriptionBatchComplete({
      expectedCount: tokens.length,
      receivedDone,
      doneCount,
      items: receivedItems,
    }),
  };
}

async function runSubscriptionBatchStream(tokens, {
  mergeIntoState = null,
  indexMap = null,
  requestId = activeSubscriptionRequestId,
  signal = activeSubscriptionController?.signal,
  retryMissing = true,
} = {}) {
  const state = mergeIntoState ?? {
    total: tokens.length,
    completed: 0,
    success: 0,
    failure: 0,
    partial: 0,
    active: 0,
    trial: 0,
    items: [],
    done: false,
    retrying: false,
  };
  state.retrying = Boolean(mergeIntoState);
  state.done = false;
  if (mergeIntoState) replaceBatchSummary(state);
  else renderSubscriptionBatchStart(tokens.length, state);
  lastSubscriptionBatchState = state;

  let attempt;
  try {
    attempt = await consumeSubscriptionBatchAttempt(tokens, {
      state,
      indexMap,
      requestId,
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    attempt = {
      receivedDone: false,
      doneCount: null,
      items: [],
      missingIndexes: missingSubscriptionIndexes(tokens.length, []),
      complete: false,
      error,
    };
  }

  let unresolvedIndexes = attempt.missingIndexes;
  let recoveredMissing = false;
  let recoveryConfirmed = false;
  if (retryMissing && unresolvedIndexes.length > 0 && isActiveSubscriptionRequest(requestId)) {
    const retryTokens = unresolvedIndexes.map(index => tokens[index - 1]);
    const retryIndexMap = unresolvedIndexes.map(index => (
      Array.isArray(indexMap) ? indexMap[index - 1] : index
    ));
    statusText.textContent = `补查缺失项 ${retryTokens.length} 个…`;
    try {
      const recovery = await consumeSubscriptionBatchAttempt(retryTokens, {
        state,
        indexMap: retryIndexMap,
        requestId,
        signal,
      });
      unresolvedIndexes = recovery.missingIndexes.map(index => retryIndexMap[index - 1]);
      recoveredMissing = unresolvedIndexes.length === 0;
      recoveryConfirmed = recovery.complete;
    } catch (error) {
      if (isAbortError(error)) throw error;
      unresolvedIndexes = retryIndexMap;
    }
  } else {
    unresolvedIndexes = unresolvedIndexes.map(index => (
      Array.isArray(indexMap) ? indexMap[index - 1] : index
    ));
  }

  for (const originalIndex of unresolvedIndexes) {
    const token = lastSubscriptionBatchTokens[originalIndex - 1]
      ?? tokens[(Array.isArray(indexMap) ? indexMap.indexOf(originalIndex) : originalIndex - 1)];
    const previousResult = state.items.find(item => Number(item?.index) === originalIndex);
    const incompleteResult = previousResult
      ? {
          ...previousResult,
          index: originalIndex,
          retry_reason: "stream-incomplete",
          retry_message: "补查流提前结束，已保留上一次结果。",
        }
      : createIncompleteSubscriptionResult(originalIndex, redactLocalToken(token));
    renderSubscriptionBatchItem(
      incompleteResult,
      state,
    );
  }

  state.done = true;
  state.integrityConfirmed = attempt.complete || (recoveredMissing && recoveryConfirmed);
  state.retrying = false;
  updateBatchStateCounts(state);
  replaceBatchSummary(state);
  const hasStreamIncomplete = state.items.some(item => (
    item?.reason === "stream-incomplete" || item?.retry_reason === "stream-incomplete"
  ));
  if (hasStreamIncomplete) {
    setError("部分流式结果未返回，缺失项已明确标记，可使用“重试未完成项”继续补查。");
  } else if (!state.integrityConfirmed) {
    setError("流式结束确认不完整，但已收到全部结果；建议关注代理或本地服务稳定性。");
  }
  statusText.textContent = "";
  return {
    complete: state.integrityConfirmed && !hasStreamIncomplete,
    recoveredMissing,
    state,
  };
}

async function runSubscriptionQuery() {
  clearError();
  const extracted = extractAccessTokens(input.value);
  const tokens = extracted.tokens;
  if (tokens.length === 0) {
    setError("没有找到有效的三段式 AT。");
    return;
  }
  const { requestId, controller } = beginSubscriptionRequest();
  runButton.disabled = true;
  statusText.textContent = tokens.length === 1 ? "查询中…" : `查询中 ${tokens.length} 个…`;

  try {
    const isSingleToken = tokens.length === 1;
    if (!isSingleToken) {
      lastSubscriptionBatchTokens = [...tokens];
      lastSubscriptionBatchState = null;
      lastSubscriptionSingleToken = "";
      await runSubscriptionBatchStream(tokens, {
        requestId,
        signal: controller.signal,
      });
      if (isActiveSubscriptionRequest(requestId)) {
        renderInputTokenStatus(extracted, "查询完成 · 保留");
      }
      return;
    }
    lastSubscriptionBatchTokens = [];
    lastSubscriptionBatchState = null;
    lastSubscriptionSingleToken = tokens[0];
    const response = await postSingleSubscription(tokens[0], controller.signal);
    const data = await readLocalServiceJson(response, { serviceName: "订阅查询接口" });
    if (!isActiveSubscriptionRequest(requestId)) return;
    if (!response.ok && !data?.message) {
      throw new Error(`本机服务返回 HTTP ${response.status}`);
    }
    renderSubscriptionResult(data);
    renderInputTokenStatus(extracted, data?.ok ? "查询完成 · 保留" : "查询失败 · 保留");
  } catch (error) {
    if (isAbortError(error) || !isActiveSubscriptionRequest(requestId)) return;
    const hasPartialResults = Array.isArray(lastSubscriptionBatchState?.items)
      && lastSubscriptionBatchState.items.length > 0;
    if (!hasPartialResults) {
      resultArea.hidden = true;
      setHasResult(false);
    }
    setError(error instanceof Error
      ? `${error.message}。请确认已通过 npm start 打开本地服务页面。`
      : "查询失败。请确认本地服务正在运行。");
    renderInputTokenStatus(extracted, "查询失败 · 保留");
  } finally {
    if (requestId === activeSubscriptionRequestId) {
      runButton.disabled = false;
      activeSubscriptionController = null;
    }
  }
}

function clearAll() {
  activeSubscriptionController?.abort();
  activeSubscriptionController = null;
  activeSubscriptionRequestId += 1;
  runButton.disabled = false;
  input.value = "";
  statusText.textContent = "";
  clearError();
  resultArea.hidden = true;
  resultArea.innerHTML = "";
  lastSubscriptionBatchTokens = [];
  lastSubscriptionBatchState = null;
  lastSubscriptionSingleToken = "";
  ipStatus.hidden = true;
  ipStatus.textContent = "";
  ipStatus.removeAttribute("data-state");
  ipStatus.removeAttribute("title");
  setHasResult(false);
  input.focus();
}

runButton.addEventListener("click", runSubscriptionQuery);
clearButton.addEventListener("click", clearAll);
ipButton.addEventListener("click", runIpInfoQuery);
input.addEventListener("input", () => {
  renderInputTokenStatus(extractAccessTokens(input.value));
});
input.addEventListener("keydown", event => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    runSubscriptionQuery();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    clearAll();
  }
});
