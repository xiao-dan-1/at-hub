import { analyzeToken } from "../core/analyze.js";
import { filterPermissions, PERMISSION_HEURISTIC_NOTICE } from "../core/permissions.js";
import { formatKnownTime } from "../core/time.js";
import { Eye, EyeOff, createElement as createLucideElement } from "lucide";
import { copyText, el, formatValue, replace, selectTextContent } from "./dom.js";
import { createRevealRegistry } from "./reveal.js";

const MASK = "••••••••";
const CATEGORY_LABELS = {
  all: "全部字段",
  account: "账号",
  authentication: "认证",
  permissions: "权限",
  time: "时间",
  security: "安全",
  other: "其他",
};
const PERMISSION_FILTERS = [
  ["all", "全部"],
  ["high", "高风险"],
  ["write", "写入"],
  ["identity", "身份"],
];
const AUTHENTICATION_METHOD_LABELS = {
  otp: "OTP",
  "urn:openai:amr:otp_email": "邮箱验证码",
};
const AUDIENCE_LABELS = {
  "https://api.openai.com/v1": "OpenAI API",
};
const PERMISSION_GROUP_ORDER = ["身份与会话", "模型", "组织", "其他"];

export function filterInspectorEntries(entries, { query = "", category = "all" } = {}) {
  const normalizedQuery = query.trim().toLowerCase();
  return entries.filter(entry => {
    if (category !== "all" && entry.category !== category) return false;
    if (!normalizedQuery) return true;
    const haystack = [entry.label, entry.key, entry.path, entry.namespace, entry.searchPreview]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export function formatRemaining(status, nowMilliseconds = Date.now()) {
  if (!status.claims.exp.valid) return "未声明到期时间";
  const difference = status.claims.exp.milliseconds - nowMilliseconds;
  if (difference <= 0) return "已到期";
  const totalMinutes = Math.ceil(difference / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `约 ${[`${days} 天`, hours > 0 ? `${hours} 小时` : ""].filter(Boolean).join(" ")}`;
  if (hours > 0) return `约 ${[`${hours} 小时`, minutes > 0 ? `${minutes} 分钟` : ""].filter(Boolean).join(" ")}`;
  return `约 ${minutes} 分钟`;
}

export function formatValiditySummary(status, nowMilliseconds = Date.now()) {
  if (!status.claims.exp.valid) return `${status.label} · ${formatRemaining(status, nowMilliseconds)}`;
  return `${status.label} · ${formatExpiry(status)} · 剩余${formatRemaining(status, nowMilliseconds)}`;
}

export function formatAuthenticationMethods(values) {
  const items = Array.isArray(values) ? values : values == null ? [] : [values];
  const labels = items
    .filter(value => typeof value === "string" && value.trim())
    .map(value => {
      const normalized = value.trim();
      return AUTHENTICATION_METHOD_LABELS[normalized]
        ?? normalized.replace(/^urn:openai:amr:/u, "").replaceAll("_", " ");
    });
  return [...new Set(labels)].join("、") || "未提供";
}

export function formatAudience(values) {
  const items = Array.isArray(values) ? values : values == null ? [] : [values];
  const labels = items
    .filter(value => typeof value === "string" && value.trim())
    .map(value => {
      const normalized = value.trim();
      return AUDIENCE_LABELS[normalized] ?? normalized;
    });
  return [...new Set(labels)].join("、") || "未提供";
}

export function groupPermissionsForDisplay(items) {
  return PERMISSION_GROUP_ORDER
    .map(label => ({ label, items: items.filter(item => item.displayGroup === label) }))
    .filter(group => group.items.length > 0);
}

export function formatExpiry(status) {
  return status.claims.exp.valid ? status.claims.exp.beijing : "未声明";
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

export function selectOverviewWarnings(warnings) {
  void warnings;
  return [];
}

export function buildMinimalOverviewModel(analysis, nowMilliseconds = Date.now()) {
  const email = findEntry(analysis, "email");
  const plan = analysis.account.plan;
  return {
    email: {
      label: "账号邮箱",
      value: email ? formatValue(email.value) : "未提供",
    },
    plan: {
      label: "chatgpt_plan_type",
      value: plan?.value ?? "未提供",
    },
    validity: {
      label: "剩余时间",
      value: formatRemaining(analysis.status, nowMilliseconds),
      state: analysis.status.code,
    },
    quietNotice: "只在当前页面读取 JWT 声明，未验证签名、撤销状态或服务器可用性。",
  };
}

function icon(iconNode, label = "") {
  const node = createLucideElement(iconNode);
  node.setAttribute("width", "16");
  node.setAttribute("height", "16");
  node.setAttribute("stroke-width", "2");
  if (label) node.setAttribute("aria-label", label);
  else node.setAttribute("aria-hidden", "true");
  return node;
}

function summaryStat(item) {
  return el("div", { className: "at-summary-stat", dataset: { state: item.state ?? "neutral" } }, [
    el("dt", { text: item.label }),
    el("dd", { text: item.value }),
  ]);
}

function definitionRow(label, value, { mono = false, sensitive = false } = {}) {
  return el("div", { className: "definition-row" }, [
    el("dt", { text: label }),
    el("dd", { className: `${mono ? "mono" : ""} ${sensitive ? "masked" : ""}`.trim(), text: value }),
  ]);
}

function renderOverview(analysis, nodes) {
  const model = buildMinimalOverviewModel(analysis);
  replace(nodes.overviewCards, [
    el("article", { className: "at-summary-card", attrs: { "aria-label": "AT 摘要" } }, [
      el("div", { className: "at-summary-card__identity" }, [
        el("span", { className: "at-summary-label", text: model.email.label }),
        el("strong", { className: "at-summary-email", text: model.email.value }),
      ]),
      el("dl", { className: "at-summary-metadata" }, [
        summaryStat(model.plan),
        summaryStat(model.validity),
      ]),
      el("p", { className: "at-summary-card__notice", text: model.quietNotice }),
    ]),
  ]);

  replace(nodes.warningList, []);
  nodes.overviewNotice.textContent = "";
}

function renderPermissions(analysis, nodes, state) {
  replace(nodes.permissionFilters, PERMISSION_FILTERS.map(([filter, label]) => (
    el("button", {
      className: "segment-button",
      text: label,
      attrs: { type: "button", "aria-pressed": String(state.permissionFilter === filter) },
      dataset: { filter },
    })
  )));
  for (const button of nodes.permissionFilters.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      state.permissionFilter = button.dataset.filter;
      renderPermissions(analysis, nodes, state);
    });
  }

  const visible = filterPermissions(analysis.permissions, state.permissionFilter);
  const groups = groupPermissionsForDisplay(visible);
  replace(nodes.permissionList, groups.length > 0 ? groups.map(group => (
    el("section", { className: "permission-group" }, [
      el("header", { className: "permission-group__heading" }, [
        el("h3", { text: group.label }),
        el("span", { text: `${group.items.length} 项` }),
      ]),
      el("div", { className: "permission-group__list" }, group.items.map(permission => (
        el("article", { className: "permission-row", dataset: { risk: permission.risk } }, [
          el("div", { className: "permission-row__main" }, [
            el("div", { className: "permission-row__heading" }, [
              el("strong", { text: permission.label }),
              el("span", { className: "risk-label", text: permission.riskLabel }),
            ]),
            el("code", { text: permission.scope }),
          ]),
          el("p", { text: permission.description }),
        ])
      ))),
    ])
  )) : [el("p", { className: "empty-state", text: "当前筛选下没有权限项目。" })]);
  nodes.permissionNotice.textContent = PERMISSION_HEURISTIC_NOTICE;
}

function entryType(value) {
  if (Array.isArray(value)) return "数组";
  if (value === null) return "null";
  if (typeof value === "object") return "对象";
  if (typeof value === "boolean") return "布尔值";
  if (typeof value === "number") return "数字";
  return "字符串";
}

function renderRevealButton(entry, valueNode, nodes, revealRegistry) {
  let revealed = false;
  const label = el("span", { text: "显示 10 秒" });
  const button = el("button", {
    className: "reveal-button",
    attrs: { type: "button", "aria-pressed": "false", "aria-label": `临时显示 ${entry.label}` },
  }, [icon(Eye), label]);

  function conceal() {
    revealed = false;
    valueNode.textContent = MASK;
    valueNode.classList.add("masked");
    button.setAttribute("aria-pressed", "false");
    replace(button, [icon(Eye), label]);
    label.textContent = "显示 10 秒";
    nodes.revealStatus.textContent = `${entry.label} 已重新隐藏`;
  }

  button.addEventListener("click", () => {
    if (revealed) {
      revealRegistry.hide(entry.path);
      return;
    }
    revealed = true;
    valueNode.textContent = formatKnownTime(entry.key, entry.value);
    valueNode.classList.remove("masked");
    button.setAttribute("aria-pressed", "true");
    replace(button, [icon(EyeOff), label]);
    revealRegistry.show(entry.path, {
      onTick(seconds) { label.textContent = seconds > 0 ? `${seconds} 秒` : "正在隐藏"; },
      onHide: conceal,
      onShow() { nodes.revealStatus.textContent = `${entry.label} 已临时显示`; },
    });
  });
  return button;
}

function renderInspectorDetail(entry, nodes, revealRegistry) {
  if (!entry) {
    replace(nodes.inspectorDetail, [el("p", { className: "empty-state", text: "没有匹配的字段。" })]);
    return;
  }

  const isComplex = Array.isArray(entry.value) || (entry.value !== null && typeof entry.value === "object");
  const valueNode = el("pre", {
    className: `detail-value${entry.sensitive ? " detail-value--masked" : ""}${isComplex ? " detail-value--code" : ""}`,
    text: entry.sensitive ? MASK : formatKnownTime(entry.key, entry.value),
  });
  const valueHeaderChildren = [el("h3", { text: "字段值" })];
  if (entry.sensitive) valueHeaderChildren.push(renderRevealButton(entry, valueNode, nodes, revealRegistry));

  replace(nodes.inspectorDetail, [
    el("header", { className: "detail-heading" }, [
      el("div", {}, [
        el("span", { className: "detail-namespace", text: entry.namespace }),
        el("h2", { text: entry.label }),
        el("p", { text: entry.description }),
      ]),
      entry.known ? null : el("span", { className: "unknown-label", text: "未解释字段" }),
    ]),
    el("dl", { className: "detail-metadata" }, [
      definitionRow("原始 key", entry.key, { mono: true }),
      definitionRow("完整路径", entry.path, { mono: true }),
      definitionRow("值类型", entryType(entry.value)),
      definitionRow("敏感状态", entry.sensitive ? "默认遮罩" : "公开声明"),
    ]),
    el("section", { className: "detail-value-section" }, [
      el("div", { className: "detail-value-heading" }, valueHeaderChildren),
      valueNode,
    ]),
  ]);
}

function renderInspector(analysis, nodes, state, revealRegistry) {
  const categories = ["all", ...new Set(analysis.entries.map(entry => entry.category))];
  replace(nodes.inspectorCategory, categories.map(category => (
    el("option", { text: CATEGORY_LABELS[category] ?? category, attrs: { value: category } })
  )));
  nodes.inspectorCategory.value = state.inspectorCategory;
  replace(nodes.inspectorCategories, categories.map(category => (
    el("button", {
      className: "category-button",
      attrs: { type: "button", "aria-pressed": String(state.inspectorCategory === category) },
      dataset: { category },
    }, [
      el("span", { text: CATEGORY_LABELS[category] ?? category }),
      el("span", { className: "category-count", text: category === "all" ? analysis.entries.length : analysis.entries.filter(entry => entry.category === category).length }),
    ])
  )));
  for (const button of nodes.inspectorCategories.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      revealRegistry.clear();
      state.inspectorCategory = button.dataset.category;
      state.selectedPath = null;
      renderInspector(analysis, nodes, state, revealRegistry);
    });
  }

  const visible = filterInspectorEntries(analysis.entries, {
    query: state.inspectorQuery,
    category: state.inspectorCategory,
  });
  if (!visible.some(entry => entry.path === state.selectedPath)) state.selectedPath = visible[0]?.path ?? null;

  replace(nodes.inspectorFields, visible.map(entry => (
    el("button", {
      className: "field-button",
      attrs: { type: "button", "aria-current": entry.path === state.selectedPath ? "true" : "false" },
      dataset: { path: entry.path },
    }, [
      el("span", { className: "field-button__namespace", text: entry.namespace }),
      el("strong", { text: entry.label }),
      el("span", { className: "field-button__meta" }, [
        el("span", { className: "mono", text: entry.key }),
        entry.sensitive ? el("span", { className: "sensitive-mark", text: "已遮罩" }) : null,
      ]),
    ])
  )));
  for (const button of nodes.inspectorFields.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      revealRegistry.clear();
      state.selectedPath = button.dataset.path;
      renderInspector(analysis, nodes, state, revealRegistry);
    });
  }
  nodes.inspectorCount.textContent = `${visible.length} / ${analysis.entries.length} 个字段`;
  renderInspectorDetail(visible.find(entry => entry.path === state.selectedPath) ?? null, nodes, revealRegistry);
  nodes.rawJson.textContent = JSON.stringify(analysis.redacted, null, 2);
}

export function createApp(documentRef = document, navigatorRef = globalThis.navigator) {
  const input = documentRef.getElementById("tokenInput");
  const inputSurface = documentRef.getElementById("inputSurface");
  const resultArea = documentRef.getElementById("resultArea");
  const errorBox = documentRef.getElementById("errorBox");
  const nodes = Object.fromEntries([
    "overviewCards", "warningList", "overviewNotice",
    "permissionFilters", "permissionList", "permissionNotice", "inspectorSearch", "inspectorCategory",
    "inspectorCategories", "inspectorFields", "inspectorCount", "inspectorDetail", "rawJson",
    "revealStatus",
  ].map(id => [id, documentRef.getElementById(id)]));
  const panels = {
    overview: documentRef.getElementById("overviewPanel"),
    permissions: documentRef.getElementById("permissionsPanel"),
    inspector: documentRef.getElementById("inspectorPanel"),
  };
  const tabs = [...documentRef.querySelectorAll('[role="tab"]')];
  const revealRegistry = createRevealRegistry();
  const state = {
    analysis: null,
    activeTab: "overview",
    permissionFilter: "all",
    inspectorCategory: "all",
    inspectorQuery: "",
    selectedPath: null,
  };

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
    revealRegistry.clear();
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
    revealRegistry.clear();
    state.analysis = null;
    state.permissionFilter = "all";
    state.inspectorCategory = "all";
    state.inspectorQuery = "";
    state.selectedPath = null;
    nodes.inspectorSearch.value = "";
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
      renderOverview(analysis, nodes, revealRegistry);
      renderPermissions(analysis, nodes, state);
      renderInspector(analysis, nodes, state, revealRegistry);
      inputSurface.hidden = true;
      resultArea.hidden = false;
      activateTab("overview");
      resultArea.focus({ preventScroll: true });
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
      activateTab("inspector");
      const rawDetails = nodes.rawJson.closest("details");
      if (rawDetails) rawDetails.open = true;
      selectTextContent(nodes.rawJson, documentRef);
    }
  });
  input.addEventListener("input", () => setError());
  nodes.inspectorSearch.addEventListener("input", () => {
    if (!state.analysis) return;
    revealRegistry.clear();
    state.inspectorQuery = nodes.inspectorSearch.value;
    state.selectedPath = null;
    renderInspector(state.analysis, nodes, state, revealRegistry);
  });
  nodes.inspectorCategory.addEventListener("change", () => {
    if (!state.analysis) return;
    revealRegistry.clear();
    state.inspectorCategory = nodes.inspectorCategory.value;
    state.selectedPath = null;
    renderInspector(state.analysis, nodes, state, revealRegistry);
  });

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
