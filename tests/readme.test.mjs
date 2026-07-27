import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("README explains local operation, V2 views, engineering workflow, and security limits", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

  assert.match(readme, /双击 `index\.html`/u);
  for (const command of ["npm install", "npm run dev", "npm run build", "npm run release", "npm test"]) {
    assert.ok(readme.includes(command), `missing documented command: ${command}`);
  }
  for (const view of ["概览", "权限", "高级检查器"]) {
    assert.match(readme, new RegExp(view, "u"));
  }
  assert.match(readme, /不验证签名/u);
  assert.match(readme, /本地规则|启发式/u);
  assert.match(readme, /过时|变化/u);
  assert.match(readme, /不要.*真实 token/u);
});
