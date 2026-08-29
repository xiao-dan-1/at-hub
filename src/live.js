import { Activity, ShieldCheck, Trash2, createIcons } from "lucide";
import "./styles.css";
import { readLocalServiceJson } from "./core/local-response.js";
import { extractAccessTokens } from "./core/token-extract.js";
import { configureToolNavigation } from "./ui/tool-navigation.js";

createIcons({
  icons: {
    Activity,
    ShieldCheck,
    Trash2,
  },
});

const input = document.getElementById("liveInput");
const runButton = document.getElementById("liveRunButton");
const clearButton = document.getElementById("liveClearButton");
const errorBox = document.getElementById("liveError");
const resultArea = document.getElementById("liveResult");
const statusText = document.getElementById("liveStatus");
const countHint = document.getElementById("liveCountHint");

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

function setError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.textContent = "";
  errorBox.hidden = true;
}

function updateLiveCountHint() {
  const tokens = extractAccessTokens(input.value).tokens;
  const count = tokens.length;

  countHint.dataset.state = count > 0 ? "ready" : "empty";
  countHint.textContent = count === 0
    ? "等待粘贴 · 一行一个 AT"
    : `已识别 ${count} 个 AT · 一行一个 AT`;

  return tokens;
}

function setRunningLiveCountHint(count) {
  countHint.dataset.state = "running";
  countHint.textContent = `正在测活 ${count} 个 AT · 输入框已清空`;
}

function setLastLiveCountHint(count) {
  countHint.dataset.state = "done";
  countHint.textContent = `上次测活 ${count} 个 AT · 输入框已清空`;
}

function statusLabel(data) {
  if (data?.alive === true) return "AT 可用";
  if (data?.alive === false) return "AT 不可用";
  return "查询失败";
}

function renderLiveFact(label, value) {
  return `
    <div class="live-fact">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(valueOrDash(value))}</strong>
    </div>
  `;
}

function renderRawDisclosure(data, { className = "json-disclosure subscription-json live-json", label = "查看原始 JSON" } = {}) {
  const rawJson = escapeHtml(JSON.stringify(data?.raw ?? data ?? {}, null, 2));
  return `
    <details class="${className}">
      <summary>${escapeHtml(label)}</summary>
      <pre tabindex="0">${rawJson}</pre>
    </details>
  `;
}

function renderLiveCard(data, { indexLabel = "" } = {}) {
  const alive = data?.alive === true;
  const inactive = data?.alive === false;
  const state = alive ? "true" : inactive ? "false" : "unknown";
  const identity = data?.email ?? data?.token_hint ?? (inactive ? "AT 不可用" : "backend-api/me");
  const secondary = data?.user_id ?? data?.message ?? data?.reason ?? "backend-api/me";
  return `
    <article class="live-card${data?.ok ? "" : " live-card--error"}" data-alive="${state}">
      <header class="live-card__top">
        <div class="live-card__identity">
          ${indexLabel ? `<p class="subscription-card__index">${escapeHtml(indexLabel)}</p>` : ""}
          <p class="live-card__eyebrow">Live check</p>
          <h2>${escapeHtml(valueOrDash(identity))}</h2>
          <p>${escapeHtml(valueOrDash(secondary))}</p>
        </div>
        <span class="live-status-pill" data-alive="${state}">${escapeHtml(statusLabel(data))}</span>
      </header>

      <section class="live-card__facts" aria-label="测活结果">
        ${renderLiveFact("名称", data?.name)}
        ${renderLiveFact("上游", data?.upstream_status ?? data?.status)}
        ${renderLiveFact("结果", statusLabel(data))}
      </section>

      ${data?.message ? `<p class="live-message">${escapeHtml(data.message)}</p>` : ""}
      ${renderRawDisclosure(data)}
    </article>
  `;
}

function renderLiveBatchRow(data) {
  const alive = data?.alive === true;
  const inactive = data?.alive === false;
  const state = alive ? "true" : inactive ? "false" : "unknown";
  const identity = data?.email ?? data?.token_hint ?? "—";
  const secondary = data?.user_id ?? data?.message ?? data?.reason ?? "backend-api/me";

  return `
    <article class="live-row" data-alive="${state}">
      <span class="live-row__index">#${escapeHtml(data?.index ?? "—")}</span>
      <div class="live-row__identity">
        <strong>${escapeHtml(valueOrDash(identity))}</strong>
        <span>${escapeHtml(valueOrDash(secondary))}</span>
      </div>
      <div class="live-row__meta">
        <span>名称</span>
        <strong>${escapeHtml(valueOrDash(data?.name))}</strong>
      </div>
      <div class="live-row__meta">
        <span>上游</span>
        <strong>${escapeHtml(valueOrDash(data?.upstream_status ?? data?.status))}</strong>
      </div>
      <span class="live-status-pill" data-alive="${state}">${escapeHtml(statusLabel(data))}</span>
      ${renderRawDisclosure(data, { className: "live-row__json", label: "JSON" })}
    </article>
  `;
}

function renderBatchSummary(data) {
  return `
    <section class="subscription-batch-summary live-batch-summary" aria-label="批量测活摘要">
      <strong>批量测活完成</strong>
      <span>共 ${escapeHtml(data?.count ?? 0)} 个 · 可用 ${escapeHtml(data?.alive_count ?? 0)} · 不可用 ${escapeHtml(data?.inactive_count ?? 0)} · 失败 ${escapeHtml(data?.failure_count ?? 0)}</span>
    </section>
  `;
}

export function renderLiveResult(data) {
  if (!data?.ok && data?.alive !== false) {
    resultArea.hidden = true;
    setError(data?.message ?? "AT 测活失败。");
    return;
  }

  resultArea.innerHTML = renderLiveCard(data);
  resultArea.hidden = false;
}

export function renderLiveBatchResult(data) {
  if (!data?.ok) {
    resultArea.hidden = true;
    setError(data?.message ?? "批量测活失败。");
    return;
  }

  const results = Array.isArray(data.results) ? data.results : [];
  resultArea.innerHTML = `
    ${renderBatchSummary(data)}
    <div class="live-table" role="list">
      ${results.map(item => renderLiveBatchRow(item)).join("")}
    </div>
  `;
  resultArea.hidden = false;
}

function postSingleLive(token) {
  return fetch("/api/at-live", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

function postBatchLive(tokens) {
  return fetch("/api/at-live/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tokens }),
  });
}

async function runLiveCheck() {
  clearError();
  const tokens = updateLiveCountHint();

  if (tokens.length === 0) {
    setError("没有找到有效的三段式 AT。");
    return;
  }
  runButton.disabled = true;
  statusText.textContent = tokens.length === 1 ? "测活中…" : `测活中 ${tokens.length} 个…`;
  input.value = "";
  setRunningLiveCountHint(tokens.length);

  try {
    const response = tokens.length === 1
      ? await postSingleLive(tokens[0])
      : await postBatchLive(tokens);
    const data = await readLocalServiceJson(response, { serviceName: "AT 测活接口" });
    if (!response.ok && !data?.message) {
      throw new Error(`本机服务返回 HTTP ${response.status}`);
    }

    if (tokens.length === 1) renderLiveResult(data);
    else renderLiveBatchResult(data);
    setLastLiveCountHint(tokens.length);
    statusText.textContent = data?.ok ? "" : "测活失败";
  } catch (error) {
    resultArea.hidden = true;
    setError(error instanceof Error
      ? `${error.message}。请确认已通过 npm start 或 npm run dev:service 打开本地服务页面。`
      : "测活失败。请确认本地服务正在运行。");
    statusText.textContent = "测活失败";
  } finally {
    runButton.disabled = false;
  }
}

function clearAll() {
  input.value = "";
  updateLiveCountHint();
  statusText.textContent = "";
  clearError();
  resultArea.hidden = true;
  resultArea.innerHTML = "";
  input.focus();
}

runButton.addEventListener("click", runLiveCheck);
clearButton.addEventListener("click", clearAll);
input.addEventListener("input", updateLiveCountHint);
input.addEventListener("keydown", event => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    runLiveCheck();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    clearAll();
  }
});
updateLiveCountHint();
