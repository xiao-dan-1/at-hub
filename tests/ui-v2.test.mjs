import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatOverviewEntryValue } from "../src/ui/app.js";

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
