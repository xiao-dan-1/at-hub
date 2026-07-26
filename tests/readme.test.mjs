import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("README explains local operation, tests, and security limits", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

  assert.match(readme, /双击 `index\.html`/u);
  assert.match(readme, /node --test/u);
  assert.match(readme, /不验证签名/u);
  assert.match(readme, /不要.*真实 token/u);
});
