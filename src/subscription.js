import { Globe, Radar, ShieldCheck, Trash2, createIcons } from "lucide";
import "./styles.css";
import { readLocalServiceJson } from "./core/local-response.js";
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

function formatSubscriptionInputLines(tokens) {
  return tokens.join("\n");
}

function renderInputTokenStatus(tokens, prefix = "已识别") {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    statusText.textContent = input.value.trim() ? "未识别 AT · 一行一个 AT" : "";
    return;
  }
  statusText.textContent = `${prefix} ${tokens.length} 个 AT · 一行一个`;
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
    const ip = valueOrDash(data.ip);
    const country = valueOrDash(data.country);
    setIpInlineStatus(`${ip} · ${country}`, "ok", `当前出口：${ip}，国家：${country}`);
    return;
  }

  setIpInlineStatus("IP 查询失败", "error", data?.message ?? "IP 信息查询失败。");
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
        <span class="subscription-status-pill" data-active="${active ? "true" : "false"}">${active ? "有效订阅" : "无活跃订阅"}</span>
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
        <span class="subscription-status-pill">失败</span>
      </header>
      <p class="subscription-stage-note" ${stageStateAttribute(stageState)}>${escapeHtml(stageText)}</p>
      <p class="subscription-error-message">${escapeHtml(data?.message ?? "订阅查询失败。")}</p>
      <dl class="subscription-facts subscription-facts--compact">
        <div><dt>原因</dt><dd>${escapeHtml(valueOrDash(data?.reason))}</dd></div>
        <div><dt>状态</dt><dd>${escapeHtml(valueOrDash(data?.status))}</dd></div>
        <div><dt>本地判断</dt><dd>${escapeHtml(valueOrDash(data?.auth_failure_hint ?? data?.local_token_status_label))}</dd></div>
        <div><dt>上游码</dt><dd>${escapeHtml(valueOrDash(data?.upstream_error_code))}</dd></div>
        <div><dt>上游说明</dt><dd>${escapeHtml(valueOrDash(data?.upstream_error_message ?? data?.upstream_error_body_excerpt))}</dd></div>
      </dl>
    </article>
  `;
}

function hasTrialEligibility(data) {
  return Array.isArray(data?.eligible_promos) && data.eligible_promos.length > 0;
}

function renderTrialEligibility(data) {
  if (hasTrialEligibility(data)) {
    return data.eligible_promos.map(formatTagLabel).filter(Boolean).join(", ");
  }
  if (data?.has_previously_paid_subscription === true) return "已付费";
  return "—";
}

function trialEligibilityState(data) {
  if (!data?.ok) return "unknown";
  if (hasTrialEligibility(data)) return "true";
  if (data?.has_previously_paid_subscription === true) return "used";
  return "false";
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
      <span>试用资格</span>
      <span>AT</span>
      <span>订阅</span>
      <span>阶段</span>
      <span>耗时</span>
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
      <div class="subscription-row__trial" data-trial="${trialState}">
        <span>试用资格</span>
        <strong>${escapeHtml(ok ? renderTrialEligibility(data) : "—")}</strong>
      </div>
      <div class="subscription-row__meta">
        <span>AT</span>
        <strong>${escapeHtml(ok ? formatRemaining({ days_left: data.token_days_left, hours_left: data.token_hours_left }) : "—")}</strong>
      </div>
      <span class="subscription-status-pill" data-active="${active ? "true" : "false"}">${escapeHtml(ok ? active ? "有效订阅" : "无活跃订阅" : "失败")}</span>
      <div class="subscription-row__stage" ${stageStateAttribute(stageState)} title="${escapeHtml(valueOrDash(data?.auth_failure_hint ?? data?.subscription_detail_message ?? data?.subscription_detail_reason ?? stageText))}">
        <span>阶段</span>
        <strong>${escapeHtml(stageText)}</strong>
      </div>
      <div class="subscription-row__timing" title="${escapeHtml(ok ? `accounts ${renderTiming(data.accounts_ms)} · subscription ${renderTiming(data.subscription_ms)}` : valueOrDash(data?.reason))}">
        <span>耗时</span>
        <strong>${escapeHtml(renderTiming(data?.total_ms))}</strong>
      </div>
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
  success_count = success,
  failure_count = failure,
  active = 0,
  trial = 0,
  done = false,
  retrying = false,
} = {}) {
  const successTotal = Number.isFinite(success_count) ? success_count : success;
  const failureTotal = Number.isFinite(failure_count) ? failure_count : failure;
  const canRetryFailure = done && failureTotal > 0 && !retrying;
  return `
    <section class="subscription-batch-summary" aria-label="批量查询摘要">
      <div class="subscription-batch-progress">
        <strong>${done ? "批量查询完成" : "批量查询中"}</strong>
        <span>${escapeHtml(completed)}/${escapeHtml(total)} 已完成</span>
      </div>
      <div class="subscription-batch-stats">
        ${renderBatchStat("可试用", trial, { kind: "trial" })}
        ${renderBatchStat("订阅中", active, { kind: "active" })}
        ${renderBatchStat("成功", successTotal, { kind: "success" })}
        ${renderBatchStat("失败", failureTotal, { kind: "failure" })}
        ${renderBatchStat("总数", total)}
        ${canRetryFailure ? '<button class="subscription-batch-retry" type="button" data-retry-failed>只重试失败项</button>' : ""}
      </div>
    </section>
  `;
}

function updateBatchStateCounts(state) {
  const items = Array.isArray(state?.items) ? state.items : [];
  state.completed = items.length;
  state.success = items.filter(item => item?.ok === true).length;
  state.failure = items.filter(item => item?.ok !== true).length;
  state.active = activeSubscriptionCount(items);
  state.trial = trialEligibleCount(items);
  return state;
}

function attachRetryFailedButton() {
  const button = resultArea.querySelector("[data-retry-failed]");
  if (button) button.addEventListener("click", retryFailedSubscriptionItems);
}

function replaceBatchSummary(state) {
  resultArea.querySelector(".subscription-batch-summary")?.remove();
  resultArea.insertAdjacentHTML("afterbegin", renderBatchSummary(state));
  attachRetryFailedButton();
}

export function renderSubscriptionResult(data) {
  if (!data?.ok) {
    resultArea.innerHTML = renderSubscriptionErrorCard(data);
    resultArea.hidden = false;
    setHasResult(true);
    setError(data?.message ?? "订阅查询失败。");
    return;
  }

  resultArea.innerHTML = renderSubscriptionCard(data);
  resultArea.hidden = false;
  setHasResult(true);
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
  attachRetryFailedButton();
}

function renderSubscriptionBatchStart(total, state = {
    total,
    completed: 0,
    success: 0,
    failure: 0,
    active: 0,
    trial: 0,
    items: [],
    done: false,
    retrying: false,
  }) {
  state.total = total;
  state.completed = 0;
  state.success = 0;
  state.failure = 0;
  state.active = 0;
  state.trial = 0;
  state.items = [];
  state.done = false;
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
  attachRetryFailedButton();
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
}

function postSingleSubscription(token) {
  return fetch("/api/subscription", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

function postBatchSubscriptions(tokens) {
  return fetch("/api/subscriptions/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tokens }),
  });
}

function streamBatchSubscriptions(tokens) {
  return fetch("/api/subscriptions/stream", {
    method: "POST",
    headers: {
      accept: "text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({ tokens }),
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

function collectFailedSubscriptionEntries() {
  const items = Array.isArray(lastSubscriptionBatchState?.items) ? lastSubscriptionBatchState.items : [];
  return sortSubscriptionResults(items)
    .filter(item => item?.ok !== true && Number.isFinite(item?.index))
    .map(item => ({
      index: item.index,
      token: lastSubscriptionBatchTokens[item.index - 1],
    }))
    .filter(entry => entry.token);
}

async function retryFailedSubscriptionItems() {
  clearError();
  const failedEntries = collectFailedSubscriptionEntries();
  const retryTokens = failedEntries.map(entry => entry.token);
  if (retryTokens.length === 0 || !lastSubscriptionBatchState) return;

  runButton.disabled = true;
  const retryButton = resultArea.querySelector("[data-retry-failed]");
  if (retryButton) retryButton.disabled = true;
  statusText.textContent = `重试失败项 ${retryTokens.length} 个…`;

  try {
    await runSubscriptionBatchStream(retryTokens, {
      mergeIntoState: lastSubscriptionBatchState,
      indexMap: failedEntries.map(entry => entry.index),
    });
  } catch (error) {
    setError(error instanceof Error ? error.message : "重试失败项失败。");
  } finally {
    runButton.disabled = false;
  }
}

async function runSubscriptionBatchStream(tokens, { mergeIntoState = null, indexMap = null } = {}) {
  const response = await streamBatchSubscriptions(tokens);
  if (!response.ok) {
    const data = await readLocalServiceJson(response, { serviceName: "批量订阅流接口" });
    throw new Error(data?.message ?? `本机服务返回 HTTP ${response.status}`);
  }

  const state = mergeIntoState ?? {
    total: tokens.length,
    completed: 0,
    success: 0,
    failure: 0,
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

  for await (const message of readEventStream(response)) {
    if (message.event === "start") {
      if (!mergeIntoState) {
        state.total = message.data?.count ?? tokens.length;
        renderSubscriptionBatchStart(state.total, state);
      }
      continue;
    }
    if (message.event === "item") {
      const originalIndex = Array.isArray(indexMap) ? indexMap[message.data?.index - 1] : message.data?.index;
      renderSubscriptionBatchItem({ ...message.data, index: originalIndex }, state);
      statusText.textContent = `查询中 ${state.completed}/${state.total}`;
      continue;
    }
    if (message.event === "error") {
      throw new Error(message.data?.message ?? "批量订阅查询失败。");
    }
    if (message.event === "done") {
      state.done = true;
      state.retrying = false;
      if (!mergeIntoState) state.total = message.data?.count ?? state.total;
      updateBatchStateCounts(state);
      replaceBatchSummary(state);
      statusText.textContent = "";
    }
  }
}

async function runSubscriptionQuery() {
  clearError();
  const extracted = extractAccessTokens(input.value);
  const tokens = extracted.tokens;
  if (tokens.length === 0) {
    setError("没有找到有效的三段式 AT。");
    return;
  }
  runButton.disabled = true;
  statusText.textContent = tokens.length === 1 ? "查询中…" : `查询中 ${tokens.length} 个…`;
  input.value = formatSubscriptionInputLines(tokens);

  try {
    const isSingleToken = tokens.length === 1;
    if (!isSingleToken) {
      lastSubscriptionBatchTokens = [...tokens];
      lastSubscriptionBatchState = null;
      await runSubscriptionBatchStream(tokens);
      renderInputTokenStatus(tokens, "查询完成 · 保留");
      return;
    }
    lastSubscriptionBatchTokens = [];
    lastSubscriptionBatchState = null;
    const response = await postSingleSubscription(tokens[0]);
    const data = await readLocalServiceJson(response, { serviceName: "订阅查询接口" });
    if (!response.ok && !data?.message) {
      throw new Error(`本机服务返回 HTTP ${response.status}`);
    }
    renderSubscriptionResult(data);
    renderInputTokenStatus(tokens, data?.ok ? "查询完成 · 保留" : "查询失败 · 保留");
  } catch (error) {
    resultArea.hidden = true;
    setHasResult(false);
    setError(error instanceof Error
      ? `${error.message}。请确认已通过 npm start 打开本地服务页面。`
      : "查询失败。请确认本地服务正在运行。");
    renderInputTokenStatus(tokens, "查询失败 · 保留");
  } finally {
    runButton.disabled = false;
  }
}

function clearAll() {
  input.value = "";
  statusText.textContent = "";
  clearError();
  resultArea.hidden = true;
  resultArea.innerHTML = "";
  lastSubscriptionBatchTokens = [];
  lastSubscriptionBatchState = null;
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
  renderInputTokenStatus(extractAccessTokens(input.value).tokens);
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
