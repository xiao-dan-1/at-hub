import test from "node:test";
import assert from "node:assert/strict";
import {
  PERMISSION_HEURISTIC_NOTICE,
  filterPermissions,
  interpretScopes,
} from "../src/core/permissions.js";

test("interpretScopes assigns stable Chinese labels, groups, and local risks", () => {
  const items = interpretScopes([
    "organization.write",
    "organization.read",
    "model.request",
    "model.read",
    "offline_access",
    "openid",
  ]);
  const compact = items.map(({ scope, label, risk, group }) => [scope, label, risk, group]);

  assert.deepEqual(compact, [
    ["organization.write", "组织写入", "high", "write"],
    ["organization.read", "组织读取", "medium", "read"],
    ["model.request", "模型调用", "medium", "model"],
    ["model.read", "模型读取", "low", "read"],
    ["offline_access", "离线访问", "medium", "identity"],
    ["openid", "OpenID 身份", "low", "identity"],
  ]);
});

test("unknown scopes are preserved without inventing a high-risk verdict", () => {
  assert.deepEqual(interpretScopes(["synthetic.unknown"]), [{
    scope: "synthetic.unknown",
    label: "未解释权限",
    description: "本工具尚未提供该 scope 的语义解释。",
    risk: "unknown",
    group: "unknown",
  }]);
  assert.match(PERMISSION_HEURISTIC_NOTICE, /本地阅读提示/u);
  assert.match(PERMISSION_HEURISTIC_NOTICE, /不是 OpenAI 官方权限评级/u);
});

test("permission filters combine predictable categories and deduplicate scopes", () => {
  const items = interpretScopes([
    "organization.write",
    "organization.write",
    "organization.read",
    "openid",
    "offline_access",
  ]);

  assert.equal(items.length, 4);
  assert.deepEqual(filterPermissions(items, "high").map(item => item.scope), ["organization.write"]);
  assert.deepEqual(filterPermissions(items, "write").map(item => item.scope), ["organization.write"]);
  assert.deepEqual(filterPermissions(items, "identity").map(item => item.scope), ["openid", "offline_access"]);
  assert.deepEqual(filterPermissions(items, "all"), items);
});

test("non-array scopes produce an empty permission model", () => {
  assert.deepEqual(interpretScopes(undefined), []);
  assert.deepEqual(interpretScopes("openid"), []);
});
