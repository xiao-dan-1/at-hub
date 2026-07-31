import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeToken } from "../src/core/analyze.js";
import * as ui from "../src/ui/app.js";
import { formatExpiry, formatOverviewEntryValue, selectOverviewWarnings } from "../src/ui/app.js";
import { makeJwt } from "./helpers/make-jwt.mjs";

const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/ui/app.js", import.meta.url), "utf8");
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

test("result navigation defines three keyboard-addressable tabs", () => {
  for (const [id, panel, label] of [
    ["overviewTab", "overviewPanel", "概览"],
    ["permissionsTab", "permissionsPanel", "权限"],
    ["inspectorTab", "inspectorPanel", "高级检查器"],
  ]) {
    assert.match(html, new RegExp(`id="${id}"[\\s\\S]*aria-controls="${panel}"`, "u"));
    assert.match(html, new RegExp(`id="${id}"[\\s\\S]*${label}`, "u"));
  }
  assert.match(app, /ArrowLeft|ArrowRight/u);
});

test("overview exposes a compact decision panel and keeps details out of the first screen", () => {
  for (const id of ["overviewCards", "warningList", "overviewNotice"]) {
    assert.match(html, new RegExp(`id="${id}"`, "u"));
  }
  for (const removedId of ["accountSummary", "authenticationSummary", "securitySummary"]) {
    assert.doesNotMatch(html, new RegExp(`id="${removedId}"`, "u"));
  }
});

test("successful parsing collapses input and renders semantic analysis", () => {
  assert.match(app, /analyzeToken\(/u);
  assert.match(app, /inputSurface\.hidden\s*=\s*true/u);
  assert.match(app, /resultArea\.hidden\s*=\s*false/u);
  assert.match(app, /resultArea\.focus\(/u);
});

test("result input dock replaces the current AT without discarding a good result on errors", () => {
  assert.match(app, /const dockInput = documentRef\.getElementById\("dockTokenInput"\)/u);
  assert.match(app, /function setDockOpen\(open/u);
  assert.match(app, /resultInputDock\.hidden\s*=\s*!open/u);
  assert.match(app, /newParseButton\.setAttribute\("aria-expanded", String\(open\)\)/u);
  assert.match(app, /parseFrom\(dockInput,\s*\{\s*preserveResultOnError:\s*true\s*\}\)/u);
  assert.match(app, /if \(preserveResultOnError && state\.analysis\) \{/u);
  assert.match(app, /setDockError\(error\?\.message/u);
  assert.doesNotMatch(app, /newParseButton"\)\.addEventListener\("click", \(\) => clearAll\(\)\)/u);
});

test("overview formats booleans for people while keeping sensitive values masked", () => {
  assert.equal(formatOverviewEntryValue(null), "未提供");
  assert.equal(formatOverviewEntryValue({ key: "email_verified", value: true, sensitive: false }), "是");
  assert.equal(formatOverviewEntryValue({ key: "email", value: "person@example.test", sensitive: true }), "••••••••");
});

test("overview summarizes authentication method arrays", () => {
  assert.equal(ui.formatAuthenticationMethods?.(["otp", "urn:openai:amr:otp_email"]), "OTP、邮箱验证码");
});

test("overview summarizes the OpenAI API audience", () => {
  assert.equal(ui.formatAudience?.(["https://api.openai.com/v1"]), "OpenAI API");
});

test("remaining time omits a zero hour unit", () => {
  const now = Date.UTC(2033, 4, 17, 3, 33, 20);
  const status = { claims: { exp: { valid: true, milliseconds: now + 24 * 60 * 60 * 1000 } } };

  assert.equal(ui.formatRemaining?.(status, now), "约 1 天");
});

test("AT summary model keeps one-card facts without masking email or surfacing risk", () => {
  const model = ui.buildMinimalOverviewModel?.(makeOverviewAnalysis(), modelNow);

  assert.equal(model?.email?.label, "账号邮箱");
  assert.equal(model?.email?.value, "person@example.test");
  assert.equal(model?.plan.label, "plan");
  assert.equal(model?.plan.value, "plus");
  assert.equal(model?.validity.label, "剩余时间");
  assert.equal(model?.validity.value, "约 1 天");
  assert.equal(model?.permissionSummary, undefined);
  assert.equal(model?.quietNotice, "只在当前页面读取 JWT 声明，未验证签名、撤销状态或服务器可用性。");
});

test("overview does not surface permission or risk warnings", () => {
  const warnings = ui.selectOverviewWarnings?.(makeOverviewAnalysis().warnings);

  assert.deepEqual(warnings?.map(warning => warning.code), []);
});

test("permissions are grouped into stable product-facing sections", () => {
  const groups = ui.groupPermissionsForDisplay?.([
    { scope: "organization.write", displayGroup: "组织" },
    { scope: "openid", displayGroup: "身份与会话" },
    { scope: "model.request", displayGroup: "模型" },
    { scope: "synthetic.unknown", displayGroup: "其他" },
  ]);

  assert.deepEqual(groups?.map(group => [group.label, group.items.map(item => item.scope)]), [
    ["身份与会话", ["openid"]],
    ["模型", ["model.request"]],
    ["组织", ["organization.write"]],
    ["其他", ["synthetic.unknown"]],
  ]);
});

test("permission rendering keeps risk beside the permission name", () => {
  assert.match(app, /permission-group/u);
  assert.match(app, /permission-row__heading[\s\S]*risk-label/u);
});

test("overview warnings stay empty even when analysis contains risk diagnostics", () => {
  const visible = selectOverviewWarnings([
    { code: "SIGNATURE_UNVERIFIED" },
    { code: "UNKNOWN_ALG" },
    { code: "TOKEN_EXPIRED" },
    { code: "HIGH_RISK_PERMISSIONS" },
    { code: "INVALID_TIME_CLAIM" },
  ]);

  assert.deepEqual(visible.map(warning => warning.code), []);
});

test("overview exposes only remaining time from the validity model", () => {
  assert.equal(formatExpiry({ claims: { exp: { valid: true, beijing: "2033-05-18 11:33:20 +08:00" } } }), "2033-05-18 11:33:20 +08:00");
  assert.equal(formatExpiry({ claims: { exp: { valid: false } } }), "未声明");
  assert.match(app, /buildMinimalOverviewModel\(analysis\)/u);
  assert.match(app, /at-summary-card/u);
  assert.match(app, /at-summary-main/u);
  assert.match(app, /at-summary-email/u);
  assert.match(app, /at-summary-meta/u);
  assert.match(app, /at-summary-meta-item/u);
  assert.match(app, /at-summary-expiry/u);
  assert.doesNotMatch(app, /at-summary-token/u);
  assert.doesNotMatch(app, /definitionRow\("签发方"/u);
  assert.doesNotMatch(app, /definitionRow\("目标受众"/u);
  assert.doesNotMatch(app, /definitionRow\("密钥标识"/u);
  assert.doesNotMatch(app, /model\.permissionSummary/u);
});

test("overview card removes decorative labels and badge copy", () => {
  assert.doesNotMatch(app, /AT 信息/u);
  assert.doesNotMatch(app, /单个 AT 摘要/u);
  assert.doesNotMatch(app, /本地解码/u);
  assert.doesNotMatch(app, /at-summary-token/u);
  assert.doesNotMatch(app, /at-summary-card__eyebrow/u);
  assert.doesNotMatch(app, /at-summary-card__badge/u);
  assert.doesNotMatch(app, /at-summary-card__notice/u);
  assert.doesNotMatch(app, /at-summary-card__identity/u);
  assert.doesNotMatch(app, /at-summary-stat/u);
  assert.doesNotMatch(app, /http=200/u);
  assert.doesNotMatch(app, /coupon/u);
  assert.doesNotMatch(app, /详情/u);
  assert.doesNotMatch(app, /chatgpt_plan_type=/u);
});

test("overview shows account email directly while deeper sensitive fields keep reveal controls", () => {
  assert.doesNotMatch(app, /model\.email\.entry/u);
  assert.doesNotMatch(app, /sensitiveDefinitionRow\("账号成员"/u);
  assert.doesNotMatch(app, /sensitiveDefinitionRow\("客户端"/u);
  assert.match(app, /renderRevealButton\(/u);
  assert.match(app, /label:\s*"plan"/u);
  assert.match(app, /classList\.remove\("masked"\)/u);
  assert.match(app, /classList\.add\("masked"\)/u);
});

test("inspector list rows include namespace context for duplicate short keys", () => {
  assert.match(app, /field-button__namespace/u);
  assert.match(app, /entry\.namespace/u);
});
