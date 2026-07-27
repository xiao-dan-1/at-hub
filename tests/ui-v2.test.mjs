import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatExpiry, formatOverviewEntryValue, selectOverviewWarnings } from "../src/ui/app.js";

const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/ui/app.js", import.meta.url), "utf8");

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

test("overview warnings keep the three product-critical messages in priority order", () => {
  const visible = selectOverviewWarnings([
    { code: "SIGNATURE_UNVERIFIED" },
    { code: "UNKNOWN_ALG" },
    { code: "TOKEN_EXPIRED" },
    { code: "HIGH_RISK_PERMISSIONS" },
    { code: "INVALID_TIME_CLAIM" },
  ]);

  assert.deepEqual(visible.map(warning => warning.code), [
    "SIGNATURE_UNVERIFIED",
    "HIGH_RISK_PERMISSIONS",
    "TOKEN_EXPIRED",
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
    "SIGNATURE_UNVERIFIED",
    "ALG_NONE",
    "INVALID_TIME_CLAIM",
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
});

test("inspector list rows include namespace context for duplicate short keys", () => {
  assert.match(app, /field-button__namespace/u);
  assert.match(app, /entry\.namespace/u);
});
