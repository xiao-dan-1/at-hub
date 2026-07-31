# AT Parser Minimal Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default result overview with a compact decision panel showing email, JWT plan, validity, and key permission summary while preserving full data in the advanced inspector and redacted JSON.

**Architecture:** Keep the parser output unchanged. Add small exported presentation helpers in `src/ui/app.js`, update the overview DOM renderer to consume those helpers, and adjust CSS for a quieter four-block overview. Existing tabs, reveal registry, permissions page, advanced inspector, and redacted copy flow remain in place.

**Tech Stack:** Vanilla JavaScript ES modules, semantic HTML, CSS custom properties, Node test runner, Vite single-file build.

---

### Task 1: Lock The Minimal Overview Model

**Files:**
- Modify: `tests/ui-v2.test.mjs`
- Modify later: `src/ui/app.js`

- [ ] **Step 1: Write failing tests for the desired overview model**

Add imports:

```js
import { analyzeToken } from "../src/core/analyze.js";
import { makeJwt } from "./helpers/make-jwt.mjs";
```

Add this helper:

```js
const modelNow = Date.UTC(2033, 4, 17, 3, 33, 20);

function makeOverviewAnalysis(overrides = {}) {
  const token = makeJwt(
    { alg: "RS256", kid: "synthetic-key", typ: "JWT" },
    {
      iss: "https://auth.openai.com",
      aud: ["https://api.openai.com/v1"],
      exp: Math.floor((modelNow + 24 * 60 * 60 * 1000) / 1000),
      nbf: Math.floor((modelNow - 60_000) / 1000),
      iat: Math.floor((modelNow - 120_000) / 1000),
      scp: ["openid", "email", "profile", "offline_access", "model.request", "organization.write"],
      "https://api.openai.com/auth": {
        email: "person@example.test",
        chatgpt_plan_type: "plus",
      },
      ...overrides,
    },
  );
  return analyzeToken(token, modelNow);
}
```

Add tests:

```js
test("minimal overview model keeps only the necessary first-screen facts", () => {
  const model = ui.buildMinimalOverviewModel?.(makeOverviewAnalysis(), modelNow);

  assert.equal(model?.email?.label, "账号邮箱");
  assert.equal(model?.email?.value, "••••••••");
  assert.equal(model?.email?.entry.value, "person@example.test");
  assert.equal(model?.plan.label, "JWT 声明的套餐");
  assert.equal(model?.plan.value, "plus");
  assert.equal(
    model?.validity.value,
    "在声明时间窗口内 · 2033-05-18 11:33:20 +08:00 · 剩余约 1 天",
  );
  assert.deepEqual(model?.permissionSummary.items, ["模型调用", "离线访问", "组织写入 1 个高风险"]);
  assert.equal(model?.quietNotice, "只完成本地解码，未验证签名、撤销状态或服务器可用性。");
});

test("minimal overview warnings stay quiet for normal technical facts", () => {
  const warnings = ui.selectOverviewWarnings?.(makeOverviewAnalysis().warnings);

  assert.deepEqual(warnings?.map(warning => warning.code), ["HIGH_RISK_PERMISSIONS"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
node --test tests/ui-v2.test.mjs
```

Expected: FAIL because `buildMinimalOverviewModel` is not exported and `selectOverviewWarnings` still includes `SIGNATURE_UNVERIFIED`.

- [ ] **Step 3: Implement the presentation helpers**

In `src/ui/app.js`, add helpers with this shape:

```js
const QUIET_WARNING_CODES = new Set(["SIGNATURE_UNVERIFIED", "UNKNOWN_ALG"]);
const INTERRUPTIVE_WARNING_ORDER = [
  "HIGH_RISK_PERMISSIONS",
  "TOKEN_EXPIRED",
  "TOKEN_NOT_YET_VALID",
  "ALG_NONE",
  "INVALID_TIME_CLAIM",
  "MISSING_TIME",
];

export function selectOverviewWarnings(warnings) {
  const interruptive = warnings.filter(warning => !QUIET_WARNING_CODES.has(warning.code));
  const order = new Map(INTERRUPTIVE_WARNING_ORDER.map((code, index) => [code, index]));
  return [...interruptive]
    .sort((left, right) => (order.get(left.code) ?? 99) - (order.get(right.code) ?? 99))
    .slice(0, 3);
}

export function formatValiditySummary(status, nowMilliseconds = Date.now()) {
  if (!status.claims.exp.valid) return `${status.label} · ${formatRemaining(status, nowMilliseconds)}`;
  return `${status.label} · ${formatExpiry(status)} · ${formatRemaining(status, nowMilliseconds)}`;
}

export function summarizeKeyPermissions(permissions) {
  const items = [];
  if (permissions.some(permission => permission.scope === "model.request")) items.push("模型调用");
  if (permissions.some(permission => permission.scope === "offline_access")) items.push("离线访问");
  const highRiskCount = permissions.filter(permission => permission.risk === "high").length;
  const organizationWriteCount = permissions.filter(permission => permission.scope === "organization.write").length;
  if (organizationWriteCount > 0) items.push(`组织写入 ${organizationWriteCount} 个高风险`);
  else if (highRiskCount > 0) items.push(`${highRiskCount} 个高风险权限`);
  return items.length > 0 ? items : ["未声明关键权限"];
}

export function buildMinimalOverviewModel(analysis, nowMilliseconds = Date.now()) {
  const email = findEntry(analysis, "email");
  const plan = analysis.account.plan;
  return {
    email: {
      label: "账号邮箱",
      value: formatOverviewEntryValue(email),
      entry: email,
    },
    plan: {
      label: "JWT 声明的套餐",
      value: plan?.value ?? "未提供",
    },
    validity: {
      label: "有效期",
      value: formatValiditySummary(analysis.status, nowMilliseconds),
      state: analysis.status.code,
    },
    permissionSummary: {
      label: "关键权限",
      items: summarizeKeyPermissions(analysis.permissions),
      state: analysis.permissions.some(permission => permission.risk === "high") ? "danger" : "safe",
    },
    quietNotice: "只完成本地解码，未验证签名、撤销状态或服务器可用性。",
  };
}
```

- [ ] **Step 4: Run tests to verify the helpers pass**

Run:

```powershell
node --test tests/ui-v2.test.mjs
```

Expected: PASS for the new model tests. Existing tests that assert the old status strip may still fail until Task 2 updates them.

- [ ] **Step 5: Commit the model helpers**

Run:

```powershell
git add src/ui/app.js tests/ui-v2.test.mjs
git commit -m "feat: add minimal AT overview model"
```

---

### Task 2: Render The Compact Overview

**Files:**
- Modify: `src/index.html`
- Modify: `src/ui/app.js`
- Modify: `src/styles.css`
- Modify: `tests/page.test.mjs`
- Modify: `tests/ui-v2.test.mjs`

- [ ] **Step 1: Write failing structure tests for the compact overview**

Update the old overview structure tests so they expect:

```js
test("overview exposes a compact decision panel and keeps details out of the first screen", () => {
  for (const id of ["overviewCards", "warningList", "overviewNotice"]) {
    assert.match(html, new RegExp(`id="${id}"`, "u"));
  }
  for (const removedId of ["accountSummary", "authenticationSummary", "securitySummary"]) {
    assert.doesNotMatch(html, new RegExp(`id="${removedId}"`, "u"));
  }
});
```

Update source-string tests to expect:

```js
assert.match(app, /buildMinimalOverviewModel\(analysis\)/u);
assert.match(app, /minimal-card/u);
assert.doesNotMatch(app, /definitionRow\("签发方"/u);
assert.doesNotMatch(app, /definitionRow\("目标受众"/u);
assert.doesNotMatch(app, /definitionRow\("密钥标识"/u);
```

In `tests/page.test.mjs`, replace status-strip mobile expectations with:

```js
assert.match(
  css,
  /@media \(max-width: 700px\)[\s\S]*\.overview-cards\s*\{[^}]*grid-template-columns:\s*1fr;[^}]*\}/u,
);
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
node --test tests/ui-v2.test.mjs tests/page.test.mjs
```

Expected: FAIL because the HTML and CSS still use the old overview sections.

- [ ] **Step 3: Update the overview HTML shell**

In `src/index.html`, inside `#overviewPanel`, replace the old status strip and `overview-sections` block with:

```html
<div id="overviewCards" class="overview-cards" aria-live="polite"></div>
<div id="warningList" class="warning-list"></div>
<p id="overviewNotice" class="overview-notice"></p>
```

- [ ] **Step 4: Update the overview renderer**

In `src/ui/app.js`, change `renderOverview` to:

```js
function minimalCard(item, children, state = "neutral") {
  return el("article", { className: "minimal-card", dataset: { state } }, [
    el("span", { className: "minimal-card__label", text: item.label }),
    ...children,
  ]);
}

function renderOverview(analysis, nodes, revealRegistry) {
  const model = buildMinimalOverviewModel(analysis);
  const emailValue = el("span", { className: "sensitive-value masked", text: model.email.value });

  replace(nodes.overviewCards, [
    minimalCard(model.email, [
      model.email.entry?.sensitive
        ? el("div", { className: "minimal-card__sensitive" }, [
            emailValue,
            renderRevealButton(model.email.entry, emailValue, nodes, revealRegistry),
          ])
        : el("strong", { className: "minimal-card__value", text: model.email.value }),
    ]),
    minimalCard(model.plan, [
      el("strong", { className: "minimal-card__value", text: model.plan.value }),
      el("span", { className: "minimal-card__hint", text: "来自 JWT 声明，可能不是实时套餐" }),
    ]),
    minimalCard(model.validity, [
      el("strong", { className: "minimal-card__value", text: model.validity.value }),
    ], model.validity.state),
    minimalCard(model.permissionSummary, [
      el("strong", { className: "minimal-card__value", text: model.permissionSummary.items.join("、") }),
    ], model.permissionSummary.state),
  ]);

  replace(nodes.warningList, selectOverviewWarnings(analysis.warnings).map(warning => (
    el("div", { className: "warning-row", dataset: { level: warning.level } }, [
      el("span", { className: "warning-row__icon", attrs: { "aria-hidden": "true" } }, [
        icon(warning.level === "danger" ? CircleAlert : Info),
      ]),
      el("span", { text: warning.message }),
    ])
  )));
  nodes.overviewNotice.textContent = model.quietNotice;
}
```

Update the node map to use:

```js
"overviewCards", "warningList", "overviewNotice",
```

and remove `accountSummary`, `authenticationSummary`, and `securitySummary`.

- [ ] **Step 5: Update CSS for the compact overview**

In `src/styles.css`, replace the old status-strip and overview section styling with:

```css
.overview-cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.minimal-card { min-width: 0; min-height: 118px; display: grid; align-content: space-between; gap: 14px; padding: 16px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.minimal-card__label { color: var(--muted); font-size: 0.72rem; font-weight: 740; }
.minimal-card__value { min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; font-size: 0.95rem; line-height: 1.45; }
.minimal-card__hint { color: var(--muted); font-size: 0.72rem; line-height: 1.4; }
.minimal-card__sensitive { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; }
.minimal-card[data-state="within_window"] .minimal-card__value,
.minimal-card[data-state="safe"] .minimal-card__value { color: var(--primary-strong); }
.minimal-card[data-state="danger"] .minimal-card__value,
.minimal-card[data-state="expired"] .minimal-card__value { color: var(--danger); }
.minimal-card[data-state="warning"] .minimal-card__value,
.minimal-card[data-state="not_yet_valid"] .minimal-card__value,
.minimal-card[data-state="missing_time"] .minimal-card__value { color: var(--warning); }
.overview-notice { color: var(--muted); border-top: 1px solid var(--line); margin: 18px 0 0; padding-top: 14px; font-size: 0.78rem; }
```

In the mobile media query, add:

```css
.overview-cards { grid-template-columns: 1fr; }
.minimal-card { min-height: 0; }
.minimal-card__sensitive { grid-template-columns: 1fr; }
```

- [ ] **Step 6: Run focused tests**

Run:

```powershell
node --test tests/ui-v2.test.mjs tests/page.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit the compact overview render**

Run:

```powershell
git add src/index.html src/ui/app.js src/styles.css tests/page.test.mjs tests/ui-v2.test.mjs
git commit -m "feat: simplify AT overview"
```

---

### Task 3: Release And Visual QA

**Files:**
- Modify: `index.html`
- Modify generated: `dist/index.html`
- Test with local browser or Playwright fallback

- [ ] **Step 1: Publish the single-file HTML**

Run:

```powershell
npm run release
```

Expected: root `index.html` is regenerated from `dist/index.html`.

- [ ] **Step 2: Verify the published artifact matches the build output**

Run:

```powershell
if ((Get-FileHash -Algorithm SHA256 .\index.html).Hash -ne (Get-FileHash -Algorithm SHA256 .\dist\index.html).Hash) { throw "root index.html differs from dist/index.html" }
```

Expected: command exits with code 0 and no error.

- [ ] **Step 3: Run the full test suite**

Run:

```powershell
npm test
```

Expected: all tests pass with 0 failures.

- [ ] **Step 4: Perform rendered QA**

Use the in-app Browser if the `node_repl js` tool is available. If unavailable, use local Playwright or Edge fallback and record the reason.

The flow under test is: published `file://` page opens -> synthetic JWT is parsed -> compact overview shows email, plan, validity, key permission summary, warning behavior, and full redacted JSON remains available.

Check desktop and mobile:

- first screen is compact and does not show issuer, audience, algorithm, key id, client id, or password auth time
- email is masked by default and reveal still lasts ten seconds
- high-risk permission warning appears when `organization.write` exists
- advanced inspector still contains all fields
- copy still uses redacted JSON
- no console errors
- no horizontal overflow

- [ ] **Step 5: Commit the released artifact**

Run:

```powershell
git add index.html dist/index.html
git commit -m "build: publish minimal AT overview"
```

If `dist/index.html` is ignored and cannot be staged, only stage root `index.html`.

## Self Review

Spec coverage is complete: the plan covers the primary overview fields, secondary-field removal from the first screen, warning behavior, data preservation, error handling preservation, testing, release, and rendered QA. No incomplete markers remain. Helper names and node ids are consistent across tasks.
