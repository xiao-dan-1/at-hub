import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("build emits one self-contained offline HTML", () => {
  assert.match(html, /<style[\s>]/u);
  assert.match(html, /<script[^>]*>[\s\S]+<\/script>/u);
  assert.doesNotMatch(html, /<script[^>]+src=/iu);
  assert.doesNotMatch(html, /<link[^>]+rel=["']stylesheet["']/iu);
  assert.match(html, /connect-src 'none'/u);
  assert.doesNotMatch(html, /sourceMappingURL/u);
});

test("the standard test command rebuilds the generated artifact first", () => {
  assert.match(packageJson.scripts.test, /npm run build/u);
});
