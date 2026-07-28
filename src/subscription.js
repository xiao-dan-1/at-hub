import { Radar, ShieldCheck, Trash2, createIcons } from "lucide";
import "./styles.css";
import { extractAccessTokens } from "./core/token-extract.js";

createIcons({
  icons: {
    Radar,
    ShieldCheck,
    Trash2,
  },
});

const input = document.getElementById("subscriptionInput");
const runButton = document.getElementById("subscriptionRunButton");
const clearButton = document.getElementById("subscriptionClearButton");
const errorBox = document.getElementById("subscriptionError");
const resultArea = document.getElementById("subscriptionResult");
const statusText = document.getElementById("subscriptionStatus");

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

function formatPlan(data) {
  return titleCase(data?.plan_type ?? data?.subscription_plan);
}

function renderTagList(items, emptyText) {
  if (!Array.isArray(items) || items.length === 0) {
    return `<span class="subscription-muted">${escapeHtml(emptyText)}</span>`;
  }
  return items
    .map(item => `<span class="subscription-tag">${escapeHtml(typeof item === "string" ? item : item.id ?? item.title ?? item.promo_campaign_id ?? JSON.stringify(item))}</span>`)
    .join("");
}

function setError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.textContent = "";
  errorBox.hidden = true;
}

export function renderSubscriptionResult(data) {
  if (!data?.ok) {
    resultArea.hidden = true;
    setError(data?.message ?? "订阅查询失败。");
    return;
  }

  const active = data.has_active_subscription === true;
  const plan = formatPlan(data);
  const rawJson = escapeHtml(JSON.stringify(data.raw ?? {}, null, 2));
  resultArea.innerHTML = `
    <article class="subscription-card">
      <header class="subscription-card__top">
        <div class="subscription-card__identity">
          <p class="eyebrow">单个 AT</p>
          <h2>${escapeHtml(plan)}</h2>
          <p class="subscription-card__account">${escapeHtml(valueOrDash(data.email))}${data.account_id ? ` · ${escapeHtml(data.account_id)}` : ""}</p>
        </div>
        <span class="subscription-status-pill" data-active="${active ? "true" : "false"}">${active ? "有效订阅" : "无活跃订阅"}</span>
      </header>

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
            <div>${renderTagList(data.eligible_promos, "暂无")}</div>
          </div>
          <div class="subscription-list-block">
            <span>可购买套餐</span>
            <div>${renderTagList(data.eligible_offers, "未返回")}</div>
          </div>
        </div>
      </section>

      <details class="json-disclosure subscription-json">
        <summary>查看原始 JSON</summary>
        <pre tabindex="0">${rawJson}</pre>
      </details>
    </article>
  `;
  resultArea.hidden = false;
}

async function runSubscriptionQuery() {
  clearError();
  const extracted = extractAccessTokens(input.value);
  const token = extracted.tokens[0];
  if (!token) {
    setError("没有找到有效的三段式 AT。");
    return;
  }

  runButton.disabled = true;
  statusText.textContent = "查询中…";
  input.value = "";

  try {
    const response = await fetch("/api/subscription", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await response.json();
    if (!response.ok && !data?.message) {
      throw new Error(`本机服务返回 HTTP ${response.status}`);
    }
    renderSubscriptionResult(data);
    statusText.textContent = data?.ok ? "查询完成" : "查询失败";
  } catch (error) {
    resultArea.hidden = true;
    setError(error instanceof Error
      ? `${error.message}。请确认已通过 npm start 打开本地服务页面。`
      : "查询失败。请确认本地服务正在运行。");
    statusText.textContent = "查询失败";
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
  input.focus();
}

runButton.addEventListener("click", runSubscriptionQuery);
clearButton.addEventListener("click", clearAll);
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
