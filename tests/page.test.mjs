import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/ui/app.js", import.meta.url), "utf8");

test("V2 source exposes the complete accessible application structure", () => {
  for (const id of [
    "tokenInput",
    "parseButton",
    "clearButton",
    "newParseButton",
    "copyButton",
    "errorBox",
    "resultArea",
    "overviewCards",
    "overviewNotice",
    "overviewPanel",
    "permissionsPanel",
    "inspectorPanel",
    "copyStatus",
    "revealStatus",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`, "u"));
  }

  assert.match(html, /role="tablist"/u);
  assert.match(html, /role="tabpanel"/u);
  assert.match(html, /role="alert"/u);
  assert.match(html, /aria-live="polite"/u);
  assert.match(html, /本地运行/u);
});

test("source CSP blocks connections, persistence, and external resources", () => {
  for (const directive of [
    "default-src 'none'",
    "connect-src 'none'",
    "font-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ]) {
    assert.ok(html.includes(directive), `missing CSP directive: ${directive}`);
  }

  assert.doesNotMatch(app, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/u);
  assert.doesNotMatch(app, /\b(?:localStorage|sessionStorage|indexedDB|document\.cookie)\b/u);
});

test("V2 source is a compact tool rather than a marketing hero", () => {
  assert.doesNotMatch(html, /class="[^"]*hero/u);
  assert.doesNotMatch(css, /font-size:\s*clamp\([^;]*4rem/iu);
  assert.match(html, /AT Inspector/u);
  assert.match(html, /概览/u);
  assert.match(html, /权限/u);
  assert.match(html, /高级检查器/u);
});

test("mobile result layouts keep the one-card overview and stack inspector detail", () => {
  assert.match(
    css,
    /@media \(max-width: 700px\)[\s\S]*\.at-summary-card\s*\{[^}]*padding:\s*22px;[^}]*\}/u,
  );
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.at-summary-metadata\s*\{[^}]*grid-template-columns:\s*1fr;[^}]*\}/u);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.inspector-layout\s*\{[^}]*display:\s*block;[^}]*\}/u);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.inspector-fields\s*\{[^}]*border-bottom:\s*1px solid var\(--line\);[^}]*\}/u);
});

test("dark primary actions use a dedicated contrasting foreground", () => {
  assert.match(css, /--on-primary:\s*#[0-9a-f]{6}/iu);
  assert.match(css, /\.button--primary\s*\{[^}]*color:\s*var\(--on-primary\)/u);
  assert.match(css, /@media \(prefers-color-scheme: dark\)[\s\S]*--on-primary:\s*#[0-9a-f]{6}/iu);
});

test("informational warnings have a distinct blue treatment", () => {
  assert.match(css, /\.warning-row\[data-level="info"\]\s*\{[^}]*color:\s*var\(--info\);[^}]*background:\s*var\(--info-soft\);[^}]*\}/u);
});

test("result styling supports stable sensitive values and open permission groups", () => {
  assert.match(css, /\.at-summary-card\s*\{/u);
  assert.match(css, /\.at-summary-card__identity\s*\{/u);
  assert.match(css, /\.at-summary-email\s*\{/u);
  assert.match(css, /\.at-summary-metadata\s*\{/u);
  assert.match(css, /\.at-summary-stat\s*\{/u);
  assert.match(css, /\.permission-group\s*\{/u);
  assert.match(css, /\.permission-group__heading\s*\{/u);
  assert.match(css, /\.permission-row__heading\s*\{/u);
  assert.match(css, /\.inspector-layout\s*\{[^}]*height:\s*clamp\(/u);
});

test("summary card avoids table-like decoration", () => {
  assert.match(css, /\.at-summary-card\s*\{[^}]*width:\s*min\(100%,\s*560px\);[^}]*background:\s*var\(--surface\);[^}]*border-radius:\s*16px;/u);
  assert.doesNotMatch(css, /\.at-summary-field\s*\{[^}]*border-top:/u);
  assert.doesNotMatch(css, /at-summary-card__badge/u);
  assert.doesNotMatch(css, /linear-gradient\(180deg,[^;]*at-summary-card/u);
});

test("controller avoids HTML injection and implements accessible error recovery", () => {
  assert.doesNotMatch(app, /\.innerHTML\s*=/u);
  assert.match(app, /textContent/u);
  assert.match(app, /aria-invalid/u);
  assert.match(app, /aria-describedby/u);
  assert.match(app, /input\.focus\(/u);
  assert.match(app, /resultArea\.focus\(\{\s*preventScroll:\s*true\s*\}\)/u);
});
