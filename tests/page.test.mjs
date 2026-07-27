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
    "statusStrip",
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

test("mobile status strip gives the unmatched fifth metric a deliberate full row", () => {
  assert.match(
    css,
    /@media \(max-width: 700px\)[\s\S]*\.status-item:last-child\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;[^}]*\}/u,
  );
});

test("controller avoids HTML injection and implements accessible error recovery", () => {
  assert.doesNotMatch(app, /\.innerHTML\s*=/u);
  assert.match(app, /textContent/u);
  assert.match(app, /aria-invalid/u);
  assert.match(app, /aria-describedby/u);
  assert.match(app, /input\.focus\(/u);
  assert.match(app, /resultArea\.focus\(\{\s*preventScroll:\s*true\s*\}\)/u);
});
