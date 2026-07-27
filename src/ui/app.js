import { analyzeToken } from "../core/analyze.js";
import { PERMISSION_HEURISTIC_NOTICE } from "../core/permissions.js";
import { formatKnownTime } from "../core/time.js";
import { copyText, el, formatValue, replace } from "./dom.js";

const MASK = "••••••••";

function formatRemaining(status, nowMilliseconds = Date.now()) {
  if (!status.claims.exp.valid) return "未声明到期时间";
  const difference = status.claims.exp.milliseconds - nowMilliseconds;
  if (difference <= 0) return "已到期";
  const totalMinutes = Math.ceil(difference / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `约 ${days} 天 ${hours} 小时`;
  if (hours > 0) return `约 ${hours} 小时 ${minutes} 分钟`;
  return `约 ${minutes} 分钟`;
}

function findEntry(analysis, key) {
  return analysis.entries.find(entry => entry.key === key && entry.namespace === "OpenAI Auth")
    ?? analysis.entries.find(entry => entry.key === key && entry.source === "payload")
    ?? analysis.entries.find(entry => entry.key === key)
    ?? null;
}

export function formatOverviewEntryValue(entry) {
  if (!entry) return "未提供";
  if (entry.sensitive) return MASK;
  if (entry.format === "numeric-date" || entry.format === "known-time") {
    return formatKnownTime(entry.key, entry.value);
  }
  return formatValue(entry.value);
}

function statusItem(label, value, state = "neutral") {
  return el("div", { className: "status-item", dataset: { state } }, [
    el("span", { className: "status-item__label", text: label }),
    el("strong", { className: "status-item__value", text: value }),
  ]);
}

function definitionRow(label, value, { mono = false, sensitive = false } = {}) {
  return el("div", { className: "definition-row" }, [
    el("dt", { text: label }),
    el("dd", { className: `${mono ? "mono" : ""} ${sensitive ? "masked" : ""}`.trim(), text: value }),
  ]);
}

function renderOverview(analysis, nodes) {
  const algorithm = analysis.decoded.header.alg ?? "未提供";
  const highRiskCount = analysis.permissions.filter(item => item.risk === "high").length;
  replace(nodes.statusStrip, [
    statusItem("时间状态", analysis.status.label, analysis.status.code),
    statusItem("剩余时间", formatRemaining(analysis.status)),
    statusItem("签名", "未验证", "warning"),
    statusItem("算法", algorithm),
    statusItem("高风险权限", String(highRiskCount), highRiskCount ? "danger" : "safe"),
  ]);

  replace(nodes.warningList, analysis.warnings.slice(0, 3).map(warning => (
    el("div", { className: "warning-row", dataset: { level: warning.level } }, [
      el("span", { className: "warning-row__icon", attrs: { "aria-hidden": "true" }, text: warning.level === "danger" ? "!" : "i" }),
      el("span", { text: warning.message }),
    ])
  )));

  const plan = analysis.account.plan;
  const residency = analysis.account.residency;
  const email = findEntry(analysis, "email");
  const accountUser = findEntry(analysis, "chatgpt_account_user_id");
  replace(nodes.accountSummary, [
    definitionRow("套餐", plan?.value ?? "未提供"),
    definitionRow("计算驻留", residency?.value ?? "未提供", { mono: true }),
    definitionRow("邮箱", formatOverviewEntryValue(email), { sensitive: email?.sensitive }),
    definitionRow("账号成员", formatOverviewEntryValue(accountUser), { sensitive: accountUser?.sensitive }),
  ]);

  replace(nodes.authenticationSummary, [
    definitionRow("认证方式", formatOverviewEntryValue(findEntry(analysis, "amr")), { mono: true }),
    definitionRow("邮箱已验证", formatOverviewEntryValue(findEntry(analysis, "email_verified"))),
    definitionRow("注册流程", formatOverviewEntryValue(findEntry(analysis, "is_signup"))),
    definitionRow("密码认证时间", formatOverviewEntryValue(findEntry(analysis, "pwd_auth_time")), { mono: true }),
  ]);

  const client = findEntry(analysis, "client_id");
  replace(nodes.securitySummary, [
    definitionRow("签发方", formatOverviewEntryValue(findEntry(analysis, "iss")), { mono: true }),
    definitionRow("目标受众", formatOverviewEntryValue(findEntry(analysis, "aud")), { mono: true }),
    definitionRow("客户端", formatOverviewEntryValue(client), { sensitive: client?.sensitive }),
    definitionRow("密钥标识", formatOverviewEntryValue(findEntry(analysis, "kid")), { mono: true }),
  ]);
}

function renderPermissions(analysis, nodes) {
  replace(nodes.permissionList, analysis.permissions.map(permission => (
    el("article", { className: "permission-row", dataset: { risk: permission.risk } }, [
      el("div", { className: "permission-row__main" }, [
        el("strong", { text: permission.label }),
        el("code", { text: permission.scope }),
      ]),
      el("p", { text: permission.description }),
      el("span", { className: "risk-label", text: permission.risk === "high" ? "高风险" : permission.risk === "medium" ? "需留意" : permission.risk === "low" ? "低风险" : "未解释" }),
    ])
  )));
  nodes.permissionNotice.textContent = PERMISSION_HEURISTIC_NOTICE;
}

function renderInspectorPreview(analysis, nodes) {
  const categories = ["all", ...new Set(analysis.entries.map(entry => entry.category))];
  replace(nodes.inspectorCategory, categories.map(category => (
    el("option", { text: category === "all" ? "全部字段" : category, attrs: { value: category } })
  )));
  replace(nodes.inspectorCategories, categories.map(category => (
    el("button", { className: "category-button", text: category === "all" ? "全部字段" : category, attrs: { type: "button" }, dataset: { category } })
  )));
  replace(nodes.inspectorFields, analysis.entries.slice(0, 12).map(entry => (
    el("button", { className: "field-button", attrs: { type: "button" } }, [
      el("strong", { text: entry.label }),
      el("span", { className: "mono", text: entry.key }),
    ])
  )));
  nodes.inspectorCount.textContent = `${analysis.entries.length} 个字段`;
  nodes.inspectorDetail.textContent = "选择一个字段查看完整路径与详情。";
  nodes.rawJson.textContent = JSON.stringify(analysis.redacted, null, 2);
}

export function createApp(documentRef = document, navigatorRef = globalThis.navigator) {
  const input = documentRef.getElementById("tokenInput");
  const inputSurface = documentRef.getElementById("inputSurface");
  const resultArea = documentRef.getElementById("resultArea");
  const errorBox = documentRef.getElementById("errorBox");
  const nodes = Object.fromEntries([
    "statusStrip", "warningList", "accountSummary", "authenticationSummary", "securitySummary",
    "permissionList", "permissionNotice", "inspectorCategory", "inspectorCategories",
    "inspectorFields", "inspectorCount", "inspectorDetail", "rawJson",
  ].map(id => [id, documentRef.getElementById(id)]));
  const panels = {
    overview: documentRef.getElementById("overviewPanel"),
    permissions: documentRef.getElementById("permissionsPanel"),
    inspector: documentRef.getElementById("inspectorPanel"),
  };
  const tabs = [...documentRef.querySelectorAll('[role="tab"]')];
  const state = { analysis: null, activeTab: "overview" };

  function setError(message = "") {
    errorBox.textContent = message;
    errorBox.hidden = !message;
    if (message) {
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", "inputHelp errorBox");
    } else {
      input.removeAttribute("aria-invalid");
      input.setAttribute("aria-describedby", "inputHelp");
    }
  }

  function activateTab(name, { focus = false } = {}) {
    state.activeTab = name;
    for (const tab of tabs) {
      const selected = tab.dataset.tab === name;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    for (const [panelName, panel] of Object.entries(panels)) panel.hidden = panelName !== name;
  }

  function clearAll({ focus = true } = {}) {
    state.analysis = null;
    input.value = "";
    setError();
    inputSurface.hidden = false;
    resultArea.hidden = true;
    activateTab("overview");
    if (focus) input.focus();
  }

  function handleParse() {
    const rawInput = input.value;
    setError();
    try {
      const analysis = analyzeToken(rawInput);
      input.value = "";
      state.analysis = analysis;
      renderOverview(analysis, nodes);
      renderPermissions(analysis, nodes);
      renderInspectorPreview(analysis, nodes);
      inputSurface.hidden = true;
      resultArea.hidden = false;
      activateTab("overview");
      resultArea.focus();
    } catch (error) {
      clearAll({ focus: false });
      input.value = rawInput;
      setError(error?.message ?? "解析失败，请确认输入是完整的三段式 JWT。");
      input.focus();
    }
  }

  documentRef.getElementById("parseButton").addEventListener("click", handleParse);
  documentRef.getElementById("clearButton").addEventListener("click", () => clearAll());
  documentRef.getElementById("resultClearButton").addEventListener("click", () => clearAll());
  documentRef.getElementById("newParseButton").addEventListener("click", () => clearAll());
  documentRef.getElementById("copyButton").addEventListener("click", async () => {
    if (!state.analysis) return;
    const status = documentRef.getElementById("copyStatus");
    try {
      await copyText(JSON.stringify(state.analysis.redacted, null, 2), { navigatorRef, documentRef });
      status.textContent = "已复制脱敏 JSON";
    } catch (error) {
      status.textContent = error.message;
      nodes.rawJson.focus();
    }
  });
  input.addEventListener("input", () => setError());

  for (const tab of tabs) {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
    tab.addEventListener("keydown", event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const current = tabs.indexOf(tab);
      const direction = event.key === "ArrowRight" ? 1 : -1;
      activateTab(tabs[(current + direction + tabs.length) % tabs.length].dataset.tab, { focus: true });
    });
  }
  documentRef.addEventListener("keydown", event => {
    if (event.key === "Escape") clearAll();
  });

  return { activateTab, clearAll, handleParse, state };
}
