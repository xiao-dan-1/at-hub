import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("page exposes the complete accessible application structure", () => {
  for (const id of [
    "tokenInput",
    "parseButton",
    "clearButton",
    "errorBox",
    "resultArea",
    "statusSummary",
    "warningList",
    "sections",
    "rawJson",
    "copyButton",
    "copyStatus",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`, "u"));
  }

  assert.match(html, /aria-live="polite"/u);
  assert.match(html, /aria-live="assertive"/u);
  assert.match(html, /所有解析均在本地完成/u);
  assert.match(html, /已解码但未验签/u);
});

test("page CSP blocks connections and external resources", () => {
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

  assert.doesNotMatch(html, /<script[^>]+src=/iu);
  assert.doesNotMatch(html, /<link[^>]+rel=["']stylesheet["']/iu);
  assert.doesNotMatch(html, /<(?:img|iframe)[^>]+src=["']https?:/iu);
  assert.doesNotMatch(html, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/u);
  assert.doesNotMatch(html, /\b(?:localStorage|sessionStorage|indexedDB|document\.cookie)\b/u);
});

test("page includes responsive light and dark styles", () => {
  assert.match(html, /name="viewport"/u);
  assert.match(html, /prefers-color-scheme:\s*dark/u);
  assert.match(html, /@media\s*\(max-width:\s*700px\)/u);
  assert.match(html, /:focus-visible/u);
});

test("time claims render through the Beijing-time formatter", () => {
  assert.match(html, /function\s+formatTimeClaimValue\s*\(/u);
  assert.match(html, /formatTimeClaimValue\(entry\.key,\s*entry\.value\)/u);
  assert.match(html, /北京时间：/u);
});

test("browser controller avoids HTML injection and implements clear controls", () => {
  assert.doesNotMatch(html, /\.innerHTML\s*=/u);
  assert.match(html, /textContent/u);
  assert.match(html, /event\.key\s*===\s*["']Escape["']/u);
  assert.match(html, /input\.value\s*=\s*["']["']/u);
  assert.match(html, /replaceChildren\(/u);
  assert.match(html, /selectNodeContents\(/u);
});
