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

test("overview has dedicated regions for status, warnings, and semantic summaries", () => {
  for (const id of ["statusStrip", "warningList", "accountSummary", "authenticationSummary", "securitySummary"]) {
    assert.match(html, new RegExp(`id="${id}"`, "u"));
  }
});

test("successful parsing collapses input and renders semantic analysis", () => {
  assert.match(app, /analyzeToken\(/u);
  assert.match(app, /inputSurface\.hidden\s*=\s*true/u);
  assert.match(app, /resultArea\.hidden\s*=\s*false/u);
  assert.match(app, /resultArea\.focus\(/u);
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

test("overview warnings keep the three product-critical messages in priority order", () => {
  const visible = selectOverviewWarnings([
    { code: "SIGNATURE_UNVERIFIED" },
    { code: "UNKNOWN_ALG" },
    { code: "TOKEN_EXPIRED" },
    { code: "HIGH_RISK_PERMISSIONS" },
    { code: "INVALID_TIME_CLAIM" },
  ]);

  assert.deepEqual(visible.map(warning => warning.code), [
    "HIGH_RISK_PERMISSIONS",
    "TOKEN_EXPIRED",
    "INVALID_TIME_CLAIM",
  ]);
});

test("overview warnings fill unused slots with other actionable diagnostics", () => {
  const visible = selectOverviewWarnings([
    { code: "SIGNATURE_UNVERIFIED" },
    { code: "ALG_NONE" },
    { code: "INVALID_TIME_CLAIM" },
    { code: "MISSING_TIME" },
  ]);

  assert.deepEqual(visible.map(warning => warning.code), [
    "ALG_NONE",
    "INVALID_TIME_CLAIM",
    "MISSING_TIME",
  ]);
});

test("overview exposes an absolute Beijing expiry alongside remaining time", () => {
  assert.equal(formatExpiry({ claims: { exp: { valid: true, beijing: "2033-05-18 11:33:20 +08:00" } } }), "2033-05-18 11:33:20 +08:00");
  assert.equal(formatExpiry({ claims: { exp: { valid: false } } }), "未声明");
  assert.match(app, /statusItem\("到期时间",\s*formatExpiry\(analysis\.status\)\)/u);
  assert.match(app, /statusItem\("剩余时间",\s*formatRemaining\(analysis\.status\)\)/u);
});

test("overview sensitive values use the shared ten-second reveal control", () => {
  assert.match(app, /sensitiveDefinitionRow\("邮箱"/u);
  assert.match(app, /sensitiveDefinitionRow\("账号成员"/u);
  assert.match(app, /sensitiveDefinitionRow\("客户端"/u);
  assert.match(app, /renderRevealButton\(/u);
  assert.match(app, /JWT 声明的套餐/u);
  assert.match(app, /classList\.remove\("masked"\)/u);
  assert.match(app, /classList\.add\("masked"\)/u);
});

test("inspector list rows include namespace context for duplicate short keys", () => {
  assert.match(app, /field-button__namespace/u);
  assert.match(app, /entry\.namespace/u);
});
